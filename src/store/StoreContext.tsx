import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type OrderRow, type ProductRow, type ShopRow } from '../lib/supabase';
import type { CartItem, Order, OrderStatus, Product, Shop } from '../types';

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
  originalPrice: r.original_price ?? undefined, sold: r.sold, rating: Number(r.rating),
  location: r.location, freeShipping: r.free_shipping, status: r.status, createdAt: r.created_at,
});

const toOrder = (r: OrderRow): Order => ({
  id: r.id, shopId: r.shop_id, lines: r.lines, shippingFee: r.shipping_fee, total: r.total,
  status: r.status, payment: r.payment, createdAt: r.created_at,
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
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  createShop: (draft: ShopDraft) => Promise<Shop>;

  // 賣家商品與訂單
  saveProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  shopOrders: Order[];
  refreshShopOrders: () => Promise<void>;
  updateOrderStatus: (id: string, status: OrderStatus) => Promise<void>;
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
      supabase.from('products').select('*').order('created_at', { ascending: false }),
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
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
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
      original_price: product.originalPrice ?? null, free_shipping: product.freeShipping,
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

  const updateOrderStatus = useCallback(async (id: string, status: OrderStatus) => {
    const { error } = await supabase.from('orders').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);
    setShopOrders(prev => prev.map(o => (o.id === id ? { ...o, status } : o)));
  }, []);

  const value = useMemo<Store>(() => ({
    shops, products, loading, loadError, reload,
    getProduct: id => products.find(p => p.id === id),
    getShop: id => shops.find(s => s.id === id),
    cart,
    cartCount: cart.reduce((s, c) => s + c.qty, 0),
    addToCart, setCartQty, removeFromCart,
    checkout, myOrders, refreshMyOrders, cancelMyOrder, completeMyOrder,
    user, authReady, myShop, signUp, signIn, signOut, createShop,
    saveProduct, deleteProduct, shopOrders, refreshShopOrders, updateOrderStatus,
  }), [
    shops, products, loading, loadError, reload, cart, addToCart, setCartQty, removeFromCart,
    checkout, myOrders, refreshMyOrders, cancelMyOrder, completeMyOrder,
    user, authReady, myShop, signUp, signIn, signOut, createShop,
    saveProduct, deleteProduct, shopOrders, refreshShopOrders, updateOrderStatus,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore 必須在 StoreProvider 內使用');
  return s;
}
