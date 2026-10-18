import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { toOrderActionError } from '../lib/orders/errors';
import { toOrder } from '../lib/orders/map';
import { placeCheckedOrder } from '../lib/account/api';
import { toAccountError } from '../lib/account/errors';
import { validCartCount } from '../lib/account/cart';
import { cleanLegacyStorage } from '../lib/account/legacy';
import { browserStores, clearPending } from '../lib/auth/pending';
import { BUYER_KEY } from '../lib/site';
import { supabase, SHOP_ORDER_COLUMNS, type ProductRow, type ShopOrderRow, type ShopRow } from '../lib/supabase';
import type {
  CartItem, CheckoutRejection, ImportBatchResult, ImportIndex, Order, OrderStatus, Product, Shop, ShippingMilestone,
} from '../types';
import { useAccountCart, type CartState } from './useAccountCart';
import { settleReload } from './reloadPolicy';
import { useAccountOrders, type OrdersState } from './useAccountOrders';
import type { AccountErrorKind } from '../lib/account/errors';
import { ImportCallError, toCallError } from '../lib/import/errors';
import { UPLOAD_TIMEOUT_MS, abortError, withTimeout } from '../lib/import/images';
import type { ImportApi } from '../lib/import/runner';
import { withAbortTimeout } from '../lib/rpcTimeout';
import {
  QuickEditError, failureText, settleConflict, toQuickEditFailure, type QuickChange, type QuickEditFailureKind, type QuickEditResult,
} from '../lib/products/quickEdit';

// 資料都存在 Supabase：商品所有人看得到；購物車、訂單屬於登入的帳號（買家用 Google、Apple 或手機號碼登入）。
// 瀏覽器裡只剩「結帳頁記住的收件資料」（登出時才清）與登入流程的暫存（見 lib/auth/pending.ts）。

/** 寫入節點後重讀該筆訂單的逾時 */
const ORDER_REREAD_TIMEOUT_MS = 3000;

export const SHIPPING_FEE = 60;
export const FREE_SHIPPING_THRESHOLD = 499;

/** 同一家店滿額免運；或該店這批商品全部標示免運（與 place_order() 的規則一致） */
export const shippingFor = (subtotal: number, products: (Product | undefined)[]) =>
  subtotal >= FREE_SHIPPING_THRESHOLD || products.every(p => p?.freeShipping) ? 0 : SHIPPING_FEE;

const toShop = (r: ShopRow): Shop => ({
  id: r.id, name: r.name, avatar: r.avatar, description: r.description,
  location: r.location, rating: Number(r.rating), joinedAt: r.created_at,
});

const toProduct = (r: ProductRow): Product => ({
  id: r.id, shopId: r.shop_id, title: r.title, description: r.description,
  categoryId: r.category_id as Product['categoryId'], images: r.images, variants: r.variants,
  sold: r.sold, rating: Number(r.rating),
  location: r.location, freeShipping: r.free_shipping, status: r.status, createdAt: r.created_at,
});

export interface CheckoutInput {
  /** price＝結帳頁該列顯示的單價（看到的價格）；只放結帳頁列得出來的品項 */
  items: (CartItem & { price: number })[];
  /** 結帳頁每家店顯示的運費（看到的運費），鍵＝shopId */
  seenShipping: Record<string, number>;
  buyer: Order['buyer'];
  payment: Order['payment'];
  fromCart: boolean; // 「直接購買」不經過購物車，結帳後就不該動到購物車
}

/** ok＝訂單成立；rejected＝價格、庫存或運費跟結帳頁看到的不同，整次不成立（沒有建單、沒有扣庫存、購物車不動） */
export type CheckoutResult = { outcome: 'ok'; orders: Order[] } | { outcome: 'rejected'; changes: CheckoutRejection[] };

export interface ShopDraft {
  name: string;
  avatar: string;
  description: string;
  location: string;
}

/**
 * 載入全部商品。API 單次最多回 1000 筆，超過會被靜默截斷；
 * 一次匯入就可能上百件，全站商品很容易超過，所以要分頁抓到底（排序加 id 讓分頁穩定）。
 */
const PRODUCT_PAGE = 1000;
async function fetchAllProducts(): Promise<{ data: ProductRow[] | null; error: { message: string } | null }> {
  const rows: ProductRow[] = [];
  for (let from = 0; ; from += PRODUCT_PAGE) {
    const { data, error } = await supabase.from('products').select('*')
      .order('created_at', { ascending: false }).order('id')
      .range(from, from + PRODUCT_PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data as ProductRow[]));
    if (data.length < PRODUCT_PAGE) return { data: rows, error: null };
  }
}

/** 列表快改送出後最久等多久（5.8）；逾時保留輸入，不自動重送 */
const QUICK_EDIT_TIMEOUT_MS = 15_000;

/** 匯入相關的 RPC 呼叫逾時；網路卡住時要能轉成「可重新嘗試」，不能無限等 */
const IMPORT_CALL_TIMEOUT_MS = 60_000;

/**
 * 呼叫匯入用的 RPC（規格 6.0）。錯誤一律轉成 ImportCallError：
 * 後端的呼叫層錯誤碼在 error.hint（不可重試），其餘（網路、逾時）可重送。
 * 使用者離開頁面（signal 被取消）丟 AbortError；逾時是可重試的暫時性錯誤。
 */
async function callImportRpc<T>(
  fn: string, args: Record<string, unknown>, signal?: AbortSignal,
): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctl.abort();
  if (signal?.aborted) throw abortError();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, IMPORT_CALL_TIMEOUT_MS);
  try {
    const { data, error } = await supabase.rpc(fn, args).abortSignal(ctl.signal);
    if (error) {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new ImportCallError('連線逾時', null);
      throw toCallError(error);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ImportCallError || (e instanceof DOMException && e.name === 'AbortError' && signal?.aborted)) throw e;
    if (timedOut) throw new ImportCallError('連線逾時', null);
    if (signal?.aborted) throw abortError();
    throw new ImportCallError(e instanceof Error ? e.message : String(e), null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

interface Store {
  // 公開資料
  shops: Shop[];
  products: Product[];
  loading: boolean;
  loadError: string | null;
  getProduct: (id: string) => Product | undefined;
  getShop: (id: string) => Shop | undefined;
  /** silent＝背景重讀：失敗時不換成「載入商品失敗」頁、畫面保留現有資料（進購物車、下單被擋後） */
  reload: (opts?: { silent?: boolean }) => Promise<void>;

  // 購物車（帳號版，D15）。沒登入時是空的，也不會呼叫資料庫
  cart: CartItem[];
  /** 圖示上的數字：只算還買得到的（上架中、規格還在） */
  cartCount: number;
  cartState: CartState;
  /** 載入失敗的原因：backend_missing＝資料庫還沒升級（AC-62 降級） */
  cartIssue: AccountErrorKind | null;
  /** 有修改還沒寫進帳號（斷線）；畫面要顯示「購物車暫時無法同步」與重試 */
  cartSyncFailed: boolean;
  /** 背景重讀發現內容變了（別台裝置改的）的次數 */
  cartUpdateTick: number;
  refreshCart: (silent?: boolean) => Promise<boolean>;
  /** 失敗丟 AccountError（OWN_SHOP、OUT_OF_STOCK…，hint 在 code） */
  addToCart: (item: CartItem) => Promise<void>;
  setCartQty: (productId: string, variantId: string, qty: number) => Promise<void>;
  removeFromCart: (items: Pick<CartItem, 'productId' | 'variantId'>[]) => Promise<void>;
  retryCartSync: () => Promise<void>;

  // 買家訂單（帳號版，D16）
  checkout: (input: CheckoutInput) => Promise<CheckoutResult>;
  myOrders: Order[];
  myOrdersState: OrdersState;
  myOrdersIssue: AccountErrorKind | null;
  refreshMyOrders: (silent?: boolean) => Promise<boolean>;
  cancelMyOrder: (id: string) => Promise<void>;
  completeMyOrder: (id: string) => Promise<void>;

  // 登入狀態（買家與賣家共用同一個 session）
  user: User | null;
  authReady: boolean;
  /** 登入「過期」（不是主動登出）：只要求重新登入，收件資料保留 */
  sessionExpired: boolean;
  /** 自己的商店資料已確定（沒登入、或已讀完）；判斷「賣家不能買自己商店的商品」前要等它 */
  shopReady: boolean;
  myShop: Shop | null;
  /** 賣家中心的「換帳號」：登出所有裝置（A-8，維持現況） */
  signOut: () => Promise<void>;
  /** 買家登出：只登出這台裝置，並清掉這台裝置記住的收件資料（A-7）。失敗會丟錯誤，仍維持登入 */
  signOutBuyer: () => Promise<void>;
  createShop: (draft: ShopDraft) => Promise<Shop>;

  // 賣家商品與訂單
  saveProduct: (product: Product) => Promise<void>;
  /** 只改上下架狀態（不碰規格）：列表的上下架鈕用它，才不會把畫面上舊的庫存蓋回資料庫 */
  setProductStatus: (id: string, status: Product['status']) => Promise<void>;
  /**
   * 列表快改（資料庫函式 quick_edit_product）。成功時只更新這一件商品的規格與狀態，不重抓全部。
   * conflict／invalid 以回傳值交給呼叫端處理（資料庫沒有寫入、本機資料也不動）；呼叫失敗丟 QuickEditError。
   */
  quickEditProduct: (productId: string, changes: QuickChange[]) => Promise<QuickEditResult>;
  /** 把資料庫目前的規格與狀態（快改衝突時回傳的）寫回這件商品，列表才不會停在舊值 */
  syncProductSnapshot: (productId: string, variants: Product['variants'], status: Product['status']) => void;
  deleteProduct: (id: string) => Promise<void>;
  shopOrders: Order[];
  refreshShopOrders: () => Promise<void>;
  updateOrderStatus: (id: string, status: OrderStatus, shipping?: { carrier: string; trackingNo: string }) => Promise<void>;
  /** 賣家手動更新物流節點。「買家已取貨」會讓資料庫把運送中的訂單轉成已完成，所以完成後以資料庫重讀的整張訂單為準 */
  addOrderEvent: (id: string, code: ShippingMilestone) => Promise<void>;

  // 蝦皮匯入（所有寫入都走資料庫的四個 RPC，不直接寫 products 表）
  /** 本店既有的匯入商品、已轉存圖片與最近一次匯入紀錄；預覽用它判斷「新增／更新」 */
  getImportIndex: (signal?: AbortSignal) => Promise<ImportIndex>;
  /** 匯入執行器用的 start／batch／finish 三個呼叫 */
  importApi: ImportApi;
  /** 上傳一張已壓縮的圖片到自己店的資料夾，回傳公開網址 */
  uploadImportImage: (blob: Blob) => Promise<string>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [myShop, setMyShop] = useState<Shop | null>(null);
  const [shopLoadedFor, setShopLoadedFor] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // 主動登出時為 true：SIGNED_OUT 事件才知道是「使用者要登出」還是「登入過期」
  const explicitSignOut = useRef(false);
  const [shopOrders, setShopOrders] = useState<Order[]>([]);

  // 上線前遺留在裝置上的舊購物車、訂單憑證、評價草稿（D16、D17＝B）：載入時清掉
  useEffect(() => {
    try { cleanLegacyStorage(localStorage, sessionStorage); } catch { /* 儲存空間被擋：沒有舊資料可清 */ }
  }, []);

  // 商店與商品：公開資料，任何人都讀得到；賣家登入後還會多看到自己下架的商品（RLS）。
  // 同時可能有好幾次載入在飛（進站、登入、下單後），只採用最後發出的那一次，舊的回來不能蓋掉新的。
  const loadSeq = useRef(0);
  // 有一般（非 silent）重讀還沒回來：被較新的 silent 重讀蓋掉時，由那次 silent 重讀代為報錯／結束轉圈
  const loudPending = useRef(false);
  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    const seq = ++loadSeq.current;
    if (!silent) {
      loudPending.current = true;
      setLoadError(null);
    }
    const [shopRes, productRes] = await Promise.all([
      supabase.from('shops').select('*').order('created_at'),
      fetchAllProducts(),
    ]);
    if (seq !== loadSeq.current) return;
    const outcome = settleReload({ ok: !shopRes.error && !productRes.error, silent, loudPending: loudPending.current });
    if (outcome === 'ignore') return;
    loudPending.current = false;
    if (outcome === 'report') {
      setLoadError(shopRes.error?.message ?? productRes.error?.message ?? '載入失敗');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setShops((shopRes.data as ShopRow[]).map(toShop));
    setProducts((productRes.data as ProductRow[]).map(toProduct));
    setLoading(false);
  }, []);

  // 登入狀態
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_IN') setSessionExpired(false);
      // 沒有人按登出卻被登出（token 失效、別的分頁登出）＝過期：只要求重新登入，資料保留
      if (event === 'SIGNED_OUT' && !explicitSignOut.current) setSessionExpired(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 登入狀態確定後載入商品，之後登入、登出、換帳號都要重載：
  // 未登入時 RLS 只回上架商品，不重載的話賣家看不到自己下架的商品（登出後也會殘留）。
  // 用 user.id 當依賴：token 更新會換 user 物件，但不需要重載。
  // loading 在重載期間回到 true，讓使用商品數量的畫面（例如分頁）知道現在的資料還不可信。
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    void reload();
  }, [authReady, userId, reload]);

  // 登入後載入自己的商店；登出就清掉
  const user = session?.user ?? null;
  useEffect(() => {
    if (!userId) {
      setMyShop(null);
      setShopOrders([]);
      setShopLoadedFor(null);
      return;
    }
    let cancelled = false;
    supabase.from('shops').select('*').eq('owner_id', userId).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      setMyShop(data ? toShop(data as ShopRow) : null);
      setShopLoadedFor(userId);
    });
    return () => { cancelled = true; };
  }, [userId]);
  const shopReady = authReady && (!userId || shopLoadedFor === userId);

  // 伺服器說「沒登入」但畫面上還有人登入著：登入已經失效。當作過期，不是登出（資料保留）
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;
  const handleAuthLost = useCallback(() => {
    if (!userIdRef.current) return;
    setSessionExpired(true);
    setSession(null);
    void supabase.auth.signOut({ scope: 'local' });
  }, []);

  const { cart, cartState, cartIssue, cartSyncFailed, cartUpdateTick, refreshCart, addToCart, setCartQty, removeFromCart, retryCartSync } =
    useAccountCart(userId, handleAuthLost);
  const { myOrders, myOrdersState, myOrdersIssue, refreshMyOrders, cancelMyOrder, completeMyOrder } =
    useAccountOrders(userId, handleAuthLost);

  // 清單重讀與單筆寫入可能交錯：寫入完成時遞增序號，在它之前發出的清單重讀回來就丟掉，
  // 否則較舊的快照會蓋掉剛寫入的結果（例如剛按完的物流節點又消失）。
  const shopOrdersSeq = useRef(0);
  const refreshShopOrders = useCallback(async () => {
    if (!myShop) return;
    const seq = shopOrdersSeq.current;
    const { data, error } = await supabase.from('orders').select(SHOP_ORDER_COLUMNS)
      .eq('shop_id', myShop.id).order('created_at', { ascending: false });
    if (error || !data || seq !== shopOrdersSeq.current) return;
    const next = (data as unknown as ShopOrderRow[]).map(toOrder);
    // 內容沒變就保留原本的陣列，回到前景的靜默重讀不會觸發任何重繪
    setShopOrders(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [myShop]);

  useEffect(() => { void refreshShopOrders(); }, [refreshShopOrders]);

  // ── 下單 ─────────────────────────────────────────────────
  // 比對、扣庫存與建單都在資料庫的 place_checked_order() 裡完成，避免兩個人同時買到同一件庫存。
  // 從購物車結帳時，資料庫在同一個交易裡把已下單的品項從帳號購物車移除（所有裝置）。
  // 下單被擋時什麼都沒寫入，但記憶體裡的價格、庫存、免運已經過時：重讀商品，購物車來的也重讀購物車（spec 4.1）。
  const checkout = useCallback(async (input: CheckoutInput): Promise<CheckoutResult> => {
    let result;
    try {
      result = await placeCheckedOrder(input);
    } catch (e) {
      const err = toAccountError(e);
      if (err.kind === 'auth') handleAuthLost();
      throw err;
    }
    if (input.fromCart) void refreshCart(true);
    if (result.outcome === 'rejected') {
      // silent：重讀失敗時不能把失敗畫面換成「載入商品失敗」（買家會看不到哪裡變了）；沒讀到新資料的代價只是
      // 回商品頁看到舊價、再送一次又被擋，伺服器仍會比對
      await reload({ silent: true });
      return result;
    }
    void refreshMyOrders(true);
    await reload(); // 庫存與銷量已變動
    return { outcome: 'ok', orders: result.orders.map(toOrder) };
  }, [reload, refreshCart, refreshMyOrders, handleAuthLost]);

  // ── 賣家 ─────────────────────────────────────────────────
  const doSignOut = useCallback(async (scope: 'global' | 'local') => {
    explicitSignOut.current = true;
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error) throw new Error(error.message);
      // 只有使用者主動登出才清收件資料與登入暫存；登入過期不清（A-7）
      try { localStorage.removeItem(BUYER_KEY); } catch { /* 儲存空間被擋：沒有東西可清 */ }
      clearPending(browserStores());
      setSessionExpired(false);
    } finally {
      explicitSignOut.current = false;
    }
  }, []);

  const signOut = useCallback(() => doSignOut('global'), [doSignOut]);
  const signOutBuyer = useCallback(() => doSignOut('local'), [doSignOut]);

  const createShop = useCallback(async (draft: ShopDraft): Promise<Shop> => {
    if (!user) throw new Error('請先登入');
    const { data, error } = await supabase.from('shops')
      .insert({ ...draft, owner_id: user.id }).select().single();
    if (error) throw new Error(error.message);
    const shop = toShop(data as ShopRow);
    setMyShop(shop);
    setShops(prev => [...prev, shop]);
    return shop;
  }, [user]);

  const saveProduct = useCallback(async (product: Product) => {
    if (!myShop) throw new Error('請先建立商店');
    const row = {
      shop_id: myShop.id, title: product.title, description: product.description,
      category_id: product.categoryId, images: product.images, variants: product.variants,
      free_shipping: product.freeShipping,
      location: myShop.location, status: product.status,
    };
    // 新商品的 id 是前端暫時產生的，交給資料庫發 uuid
    const isNew = !products.some(p => p.id === product.id);
    const { error } = isNew
      ? await supabase.from('products').insert(row)
      : await supabase.from('products').update(row).eq('id', product.id);
    if (error) throw new Error(error.message);
    await reload();
  }, [myShop, products, reload]);

  const setProductStatus = useCallback(async (id: string, status: Product['status']) => {
    const { error } = await supabase.from('products').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, status } : p)));
  }, []);

  const syncProductSnapshot = useCallback((productId: string, variants: Product['variants'], status: Product['status']) => {
    setProducts(prev => prev.map(p => (p.id === productId ? { ...p, variants, status } : p)));
  }, []);

  const productsRef = useRef(products);
  productsRef.current = products;
  const quickEditProduct = useCallback(async (productId: string, changes: QuickChange[]): Promise<QuickEditResult> => {
    const fail = (kind: QuickEditFailureKind) => {
      // 伺服器說沒登入：登入已失效，走既有的登入過期處理（跟結帳同一條）
      if (kind === 'auth') handleAuthLost();
      return new QuickEditError(kind, failureText(kind));
    };
    let outcome;
    try {
      outcome = await withAbortTimeout(QUICK_EDIT_TIMEOUT_MS, signal =>
        supabase.rpc('quick_edit_product', { p_product_id: productId, p_changes: changes }).abortSignal(signal));
    } catch (e) {
      throw fail(toQuickEditFailure({ message: e instanceof Error ? e.message : String(e) }, false));
    }
    if (outcome.timedOut || !outcome.value) throw fail('timeout');
    const { data, error } = outcome.value;
    if (error) throw fail(toQuickEditFailure(error, false));
    let result = data as QuickEditResult;
    // 前一次逾時但其實已寫入：重試看到的「衝突」是自己的值，當成功
    if (result.outcome === 'conflict') {
      const wasActive = productsRef.current.find(p => p.id === productId)?.status === 'active';
      result = settleConflict(result, changes, wasActive) ?? result;
    }
    if (result.outcome === 'ok') {
      const ok = result;
      setProducts(prev => prev.map(p => (p.id === productId ? { ...p, variants: ok.variants, status: ok.status } : p)));
    }
    return result;
  }, [handleAuthLost]);

  const deleteProduct = useCallback(async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw new Error(error.message);
    setProducts(prev => prev.filter(p => p.id !== id));
  }, []);

  const updateOrderStatus = useCallback(async (
    id: string, status: OrderStatus, shipping?: { carrier: string; trackingNo: string },
  ) => {
    const patch: Record<string, unknown> = { status };
    if (shipping) {
      patch.carrier = shipping.carrier;
      patch.tracking_no = shipping.trackingNo || null;
    }
    const { data, error } = await supabase.from('orders').update(patch).eq('id', id).select(SHOP_ORDER_COLUMNS).single();
    if (error) throw toOrderActionError(error);
    // 歷程是資料庫的 trigger 寫的，用回傳的資料覆蓋才拿得到最新事件
    shopOrdersSeq.current++;
    setShopOrders(prev => prev.map(o => (o.id === id ? toOrder(data as unknown as ShopOrderRow) : o)));
  }, []);

  const addOrderEvent = useCallback(async (id: string, code: ShippingMilestone) => {
    const { data: rpcData, error } = await supabase.rpc('add_order_event', { p_id: id, p_code: code });
    if (error) throw toOrderActionError(error);
    const events = rpcData as Order['events'];
    // 資料庫可能順便改了訂單狀態（買家已取貨 → 已完成），RPC 只回傳 events，所以整筆重讀，status 以資料庫為準。
    // 欄位用 SHOP_ORDER_COLUMNS：訂單憑證欄位的讀取權限已收回，select('*') 會 403。
    // 重讀要有逾時，也不能自動重試（supabase-js 對 GET 預設會退避重試，斷線時會多轉好幾秒）：節點已經寫入，不能讓按鈕為了一次重讀卡住。
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ORDER_REREAD_TIMEOUT_MS);
    let reread;
    try {
      reread = await supabase.from('orders').select(SHOP_ORDER_COLUMNS).eq('id', id).retry(false).abortSignal(ctl.signal).single();
    } finally {
      clearTimeout(timer);
    }
    const { data, error: readError } = reread;
    shopOrdersSeq.current++;
    if (readError || !data) {
      // 節點已經寫入成功，不能對使用者回報失敗（重按會重複追加）。重讀失敗時用 RPC 回傳的歷程推算：
      // 資料庫的 trigger 在狀態變成已完成時會附加 completed，所以最後一筆是 completed 就代表訂單已完成。
      setShopOrders(prev => prev.map(o => (o.id !== id ? o : {
        ...o, events, status: events[events.length - 1]?.status === 'completed' ? 'completed' : o.status,
      })));
      return;
    }
    setShopOrders(prev => prev.map(o => (o.id === id ? toOrder(data as unknown as ShopOrderRow) : o)));
  }, []);

  // ── 蝦皮匯入 ─────────────────────────────────────────────
  const getImportIndex = useCallback(
    (signal?: AbortSignal) => callImportRpc<ImportIndex>('get_import_index', { p_source: 'shopee' }, signal),
    [],
  );

  const importApi = useMemo<ImportApi>(() => ({
    // 讀一筆最小的資料：有沒有拿到 HTTP 回應才是重點（status 0＝網路層就失敗），不在乎內容
    reachable: async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      try {
        const { status } = await supabase.from('shops').select('id', { head: true }).abortSignal(ctl.signal);
        return status !== 0;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    start: (meta, signal) => callImportRpc('start_product_import', { p_source: 'shopee', p_meta: meta }, signal),
    batch: async (importId, items, signal) => {
      const data = await callImportRpc<{ results: ImportBatchResult[] }>(
        'import_products_batch', { p_import_id: importId, p_items: items }, signal);
      return data.results;
    },
    finish: (importId, failures, skippedImages, signal) => callImportRpc('finish_product_import', {
      p_import_id: importId, p_client_failures: failures, p_skipped_images: skippedImages,
    }, signal),
  }), []);

  const uploadImportImage = useCallback(async (blob: Blob): Promise<string> => {
    if (!myShop) throw new Error('請先建立商店');
    const path = `${myShop.id}/${crypto.randomUUID()}.jpg`;
    const bucket = supabase.storage.from('product-images');
    const { error } = await withTimeout(
      bucket.upload(path, blob, { contentType: 'image/jpeg', upsert: false }),
      UPLOAD_TIMEOUT_MS, '上傳逾時',
    );
    if (error) throw new Error(error.message);
    return bucket.getPublicUrl(path).data.publicUrl;
  }, [myShop]);

  const value = useMemo<Store>(() => ({
    shops, products, loading, loadError, reload,
    getProduct: id => products.find(p => p.id === id),
    getShop: id => shops.find(s => s.id === id),
    cart,
    cartCount: validCartCount(cart, id => products.find(p => p.id === id)),
    cartState, cartIssue, cartSyncFailed, cartUpdateTick, refreshCart, addToCart, setCartQty, removeFromCart, retryCartSync,
    checkout, myOrders, myOrdersState, myOrdersIssue, refreshMyOrders, cancelMyOrder, completeMyOrder,
    user, authReady, sessionExpired, shopReady, myShop, signOut, signOutBuyer, createShop,
    saveProduct, setProductStatus, quickEditProduct, syncProductSnapshot, deleteProduct, shopOrders, refreshShopOrders, updateOrderStatus, addOrderEvent,
    getImportIndex, importApi, uploadImportImage,
  }), [
    shops, products, loading, loadError, reload, cart, cartState, cartIssue, cartSyncFailed, cartUpdateTick, refreshCart,
    addToCart, setCartQty, removeFromCart, retryCartSync,
    checkout, myOrders, myOrdersState, myOrdersIssue, refreshMyOrders, cancelMyOrder, completeMyOrder,
    user, authReady, sessionExpired, shopReady, myShop, signOut, signOutBuyer, createShop,
    saveProduct, setProductStatus, quickEditProduct, syncProductSnapshot, deleteProduct, shopOrders, refreshShopOrders, updateOrderStatus, addOrderEvent,
    getImportIndex, importApi, uploadImportImage,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore 必須在 StoreProvider 內使用');
  return s;
}
