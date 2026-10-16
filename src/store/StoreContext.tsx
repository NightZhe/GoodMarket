import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type OrderRow, type ProductRow, type ShopRow } from '../lib/supabase';
import type {
  CartItem, ImportBatchResult, ImportIndex, Order, OrderStatus, Product, Shop, ShippingMilestone,
} from '../types';
import { ImportCallError, toCallError } from '../lib/import/errors';
import { UPLOAD_TIMEOUT_MS, abortError, withTimeout } from '../lib/import/images';
import type { ImportApi } from '../lib/import/runner';

// 資料存在 Supabase：賣家登入後上架的商品，所有人都看得到。
// 唯一還留在瀏覽器的是「購物車」與「買家的訂單憑證」——前者本來就該跟著裝置，
// 後者是因為買家不需要帳號，用下單時拿到的 token 回來查自己的訂單。

const CART_KEY = 'goodmarket_cart';
const ORDER_KEYS = 'goodmarket_order_keys';

export const SHIPPING_FEE = 60;
export const FREE_SHIPPING_THRESHOLD = 499;

/** 同一家店滿額免運；或該店這批商品全部標示免運（與 place_order() 的規則一致） */
export const shippingFor = (subtotal: number, products: (Product | undefined)[]) =>
  subtotal >= FREE_SHIPPING_THRESHOLD || products.every(p => p?.freeShipping) ? 0 : SHIPPING_FEE;

const readLocal = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.warn('localStorage 寫入失敗');
  }
};

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

const toOrder = (r: OrderRow): Order => ({
  id: r.id, orderNo: r.order_no, shopId: r.shop_id, lines: r.lines,
  shippingFee: r.shipping_fee, total: r.total,
  status: r.status, payment: r.payment, createdAt: r.created_at,
  carrier: r.carrier, trackingNo: r.tracking_no,
  events: (r.events ?? []) as Order['events'],
  buyer: { name: r.buyer_name ?? '', phone: r.buyer_phone ?? '', address: r.buyer_address ?? '' },
});

/** 買家手上的訂單憑證：沒有帳號，靠這組 (id, token) 回來查自己的單 */
interface OrderKey { id: string; token: string }

export interface CheckoutInput {
  items: CartItem[];
  buyer: Order['buyer'];
  payment: Order['payment'];
  fromCart: boolean; // 「直接購買」不經過購物車，結帳後就不該動到購物車
}

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
  reload: () => Promise<void>;

  // 購物車（本機）
  cart: CartItem[];
  cartCount: number;
  addToCart: (item: CartItem) => void;
  setCartQty: (productId: string, variantId: string, qty: number) => void;
  removeFromCart: (items: Pick<CartItem, 'productId' | 'variantId'>[]) => void;

  // 買家訂單
  checkout: (input: CheckoutInput) => Promise<Order[]>;
  myOrders: Order[];
  refreshMyOrders: () => Promise<void>;
  cancelMyOrder: (id: string) => Promise<void>;
  completeMyOrder: (id: string) => Promise<void>;

  // 賣家帳號
  user: User | null;
  authReady: boolean;
  myShop: Shop | null;
  /** 回傳 true 表示已直接登入；false 表示還要收信確認（專案有開 email 驗證時） */
  signUp: (email: string, password: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  createShop: (draft: ShopDraft) => Promise<Shop>;

  // 賣家商品與訂單
  saveProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  shopOrders: Order[];
  refreshShopOrders: () => Promise<void>;
  updateOrderStatus: (id: string, status: OrderStatus, shipping?: { carrier: string; trackingNo: string }) => Promise<void>;
  /** 賣家手動更新物流節點（不改訂單狀態） */
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

  const [cart, setCart] = useState<CartItem[]>(() => readLocal<CartItem[]>(CART_KEY, []));
  const [orderKeys, setOrderKeys] = useState<OrderKey[]>(() => readLocal<OrderKey[]>(ORDER_KEYS, []));
  const [myOrders, setMyOrders] = useState<Order[]>([]);

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [myShop, setMyShop] = useState<Shop | null>(null);
  const [shopOrders, setShopOrders] = useState<Order[]>([]);

  useEffect(() => writeLocal(CART_KEY, cart), [cart]);
  useEffect(() => writeLocal(ORDER_KEYS, orderKeys), [orderKeys]);

  // 商店與商品：公開資料，任何人都讀得到
  const reload = useCallback(async () => {
    setLoadError(null);
    const [shopRes, productRes] = await Promise.all([
      supabase.from('shops').select('*').order('created_at'),
      fetchAllProducts(),
    ]);
    if (shopRes.error || productRes.error) {
      setLoadError(shopRes.error?.message ?? productRes.error?.message ?? '載入失敗');
      setLoading(false);
      return;
    }
    setShops((shopRes.data as ShopRow[]).map(toShop));
    setProducts((productRes.data as ProductRow[]).map(toProduct));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 登入狀態
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 登入後載入自己的商店；登出就清掉
  const user = session?.user ?? null;
  useEffect(() => {
    if (!user) {
      setMyShop(null);
      setShopOrders([]);
      return;
    }
    let cancelled = false;
    supabase.from('shops').select('*').eq('owner_id', user.id).maybeSingle().then(({ data }) => {
      if (!cancelled) setMyShop(data ? toShop(data as ShopRow) : null);
    });
    return () => { cancelled = true; };
  }, [user]);

  const refreshShopOrders = useCallback(async () => {
    if (!myShop) return;
    const { data, error } = await supabase.from('orders').select('*')
      .eq('shop_id', myShop.id).order('created_at', { ascending: false });
    if (!error && data) setShopOrders((data as OrderRow[]).map(toOrder));
  }, [myShop]);

  useEffect(() => { void refreshShopOrders(); }, [refreshShopOrders]);

  const refreshMyOrders = useCallback(async () => {
    if (orderKeys.length === 0) {
      setMyOrders([]);
      return;
    }
    const { data, error } = await supabase.rpc('get_my_orders', { p_keys: orderKeys });
    if (!error && data) setMyOrders((data as OrderRow[]).map(toOrder));
  }, [orderKeys]);

  useEffect(() => { void refreshMyOrders(); }, [refreshMyOrders]);

  // ── 購物車 ───────────────────────────────────────────────
  const addToCart = useCallback((item: CartItem) => {
    setCart(prev => {
      const exist = prev.find(c => c.productId === item.productId && c.variantId === item.variantId);
      return exist
        ? prev.map(c => (c === exist ? { ...c, qty: c.qty + item.qty } : c))
        : [...prev, item];
    });
  }, []);

  const setCartQty = useCallback((productId: string, variantId: string, qty: number) => {
    setCart(prev => prev.map(c =>
      c.productId === productId && c.variantId === variantId ? { ...c, qty: Math.max(1, qty) } : c));
  }, []);

  const removeFromCart = useCallback((items: Pick<CartItem, 'productId' | 'variantId'>[]) => {
    setCart(prev => prev.filter(c =>
      !items.some(i => i.productId === c.productId && i.variantId === c.variantId)));
  }, []);

  // ── 下單 ─────────────────────────────────────────────────
  // 扣庫存與建單都在資料庫的 place_order() 裡完成，避免兩個人同時買到同一件庫存
  const checkout = useCallback(async (input: CheckoutInput): Promise<Order[]> => {
    const { data, error } = await supabase.rpc('place_order', {
      p_items: input.items.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })),
      p_buyer: input.buyer,
      p_payment: input.payment,
    });
    if (error) throw new Error(error.message);

    const rows = data as OrderRow[];
    setOrderKeys(prev => [...rows.map(r => ({ id: r.id, token: r.access_token! })), ...prev]);
    if (input.fromCart) removeFromCart(input.items);
    await reload(); // 庫存與銷量已變動
    return rows.map(toOrder);
  }, [reload, removeFromCart]);

  const cancelMyOrder = useCallback(async (id: string) => {
    const key = orderKeys.find(k => k.id === id);
    if (!key) return;
    await supabase.rpc('cancel_my_order', { p_id: id, p_token: key.token });
    await refreshMyOrders();
  }, [orderKeys, refreshMyOrders]);

  const completeMyOrder = useCallback(async (id: string) => {
    const key = orderKeys.find(k => k.id === id);
    if (!key) return;
    await supabase.rpc('complete_my_order', { p_id: id, p_token: key.token });
    await refreshMyOrders();
  }, [orderKeys, refreshMyOrders]);

  // ── 賣家 ─────────────────────────────────────────────────
  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return Boolean(data.session);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

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
    const { data, error } = await supabase.from('orders').update(patch).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    // 歷程是資料庫的 trigger 寫的，用回傳的資料覆蓋才拿得到最新事件
    setShopOrders(prev => prev.map(o => (o.id === id ? toOrder(data as OrderRow) : o)));
  }, []);

  const addOrderEvent = useCallback(async (id: string, code: ShippingMilestone) => {
    const { data, error } = await supabase.rpc('add_order_event', { p_id: id, p_code: code });
    if (error) throw new Error(error.message);
    setShopOrders(prev => prev.map(o => (o.id === id ? { ...o, events: data as Order['events'] } : o)));
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
    cartCount: cart.reduce((s, c) => s + c.qty, 0),
    addToCart, setCartQty, removeFromCart,
    checkout, myOrders, refreshMyOrders, cancelMyOrder, completeMyOrder,
    user, authReady, myShop, signUp, signIn, signOut, createShop,
    saveProduct, deleteProduct, shopOrders, refreshShopOrders, updateOrderStatus, addOrderEvent,
    getImportIndex, importApi, uploadImportImage,
  }), [
    shops, products, loading, loadError, reload, cart, addToCart, setCartQty, removeFromCart,
    checkout, myOrders, refreshMyOrders, cancelMyOrder, completeMyOrder,
    user, authReady, myShop, signUp, signIn, signOut, createShop,
    saveProduct, deleteProduct, shopOrders, refreshShopOrders, updateOrderStatus, addOrderEvent,
    getImportIndex, importApi, uploadImportImage,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore 必須在 StoreProvider 內使用');
  return s;
}
