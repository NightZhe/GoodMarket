import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CartItem, Order, OrderStatus, Product, Shop } from '../types';
import { SEED_ORDERS, SEED_PRODUCTS, SEED_SHOPS } from '../data/seed';
import { uid } from '../lib/format';

// 目前是純前端示範版：資料存在瀏覽器 localStorage。
// 所有寫入都集中在這支檔案的 action，之後換成呼叫後端 API 時只需改這裡。

const KEY = 'goodmarket_v1';

interface DB {
  shops: Shop[];
  products: Product[];
  orders: Order[];
  cart: CartItem[];
  sellerShopId: string | null; // 目前登入賣家中心的商店
}

const seedDB = (): DB => ({
  shops: SEED_SHOPS,
  products: SEED_PRODUCTS,
  orders: SEED_ORDERS,
  cart: [],
  sellerShopId: null,
});

const load = (): DB => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...seedDB(), ...JSON.parse(raw) } : seedDB();
  } catch {
    return seedDB();
  }
};

export interface CheckoutInput {
  items: CartItem[];
  buyer: Order['buyer'];
  payment: Order['payment'];
  fromCart: boolean; // 「直接購買」不經過購物車，結帳後就不該動到購物車
}

interface Store extends DB {
  // 查詢
  getProduct: (id: string) => Product | undefined;
  getShop: (id: string) => Shop | undefined;
  cartCount: number;
  // 買家
  addToCart: (item: CartItem) => void;
  setCartQty: (productId: string, variantId: string, qty: number) => void;
  removeFromCart: (items: Pick<CartItem, 'productId' | 'variantId'>[]) => void;
  checkout: (input: CheckoutInput) => Order[];
  // 賣家
  loginSeller: (shopId: string) => void;
  logoutSeller: () => void;
  createShop: (shop: Omit<Shop, 'id' | 'rating' | 'joinedAt'>) => Shop;
  saveProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;
  updateOrderStatus: (id: string, status: OrderStatus) => void;
  resetDemo: () => void;
}

const Ctx = createContext<Store | null>(null);

export const SHIPPING_FEE = 60;
export const FREE_SHIPPING_THRESHOLD = 499;

/** 同一家店滿額免運；或該店這批商品全部標示免運 */
export const shippingFor = (subtotal: number, products: (Product | undefined)[]) =>
  subtotal >= FREE_SHIPPING_THRESHOLD || products.every(p => p?.freeShipping) ? 0 : SHIPPING_FEE;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(load);
  const dbRef = useRef(db);
  dbRef.current = db;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      // 容量滿（多半是上傳太多大圖）時不中斷操作
      console.warn('localStorage 寫入失敗');
    }
  }, [db]);

  const addToCart = useCallback((item: CartItem) => {
    setDb(d => {
      const exist = d.cart.find(c => c.productId === item.productId && c.variantId === item.variantId);
      const cart = exist
        ? d.cart.map(c => (c === exist ? { ...c, qty: c.qty + item.qty } : c))
        : [...d.cart, item];
      return { ...d, cart };
    });
  }, []);

  const setCartQty = useCallback((productId: string, variantId: string, qty: number) => {
    setDb(d => ({
      ...d,
      cart: d.cart.map(c => (c.productId === productId && c.variantId === variantId ? { ...c, qty: Math.max(1, qty) } : c)),
    }));
  }, []);

  const removeFromCart = useCallback((items: Pick<CartItem, 'productId' | 'variantId'>[]) => {
    setDb(d => ({
      ...d,
      cart: d.cart.filter(c => !items.some(i => i.productId === c.productId && i.variantId === c.variantId)),
    }));
  }, []);

  // 訂單在 updater 外計算：updater 可能被 StrictMode 重跑，不能在裡面產生 id
  const checkout = useCallback((input: CheckoutInput): Order[] => {
    const d = dbRef.current;
    const byShop = new Map<string, Order['lines']>();
    for (const item of input.items) {
      const p = d.products.find(x => x.id === item.productId);
      const variant = p?.variants.find(x => x.id === item.variantId);
      if (!p || !variant) continue;
      const lines = byShop.get(p.shopId) ?? [];
      lines.push({
        productId: p.id, variantId: variant.id, title: p.title, variantName: variant.name,
        image: p.images[0], price: variant.price, qty: item.qty,
      });
      byShop.set(p.shopId, lines);
    }
    const created: Order[] = [...byShop.entries()].map(([shopId, lines]) => {
      const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
      const shippingFee = shippingFor(subtotal, lines.map(l => d.products.find(p => p.id === l.productId)));
      return {
        id: uid('ord'), shopId, lines, shippingFee, total: subtotal + shippingFee,
        status: 'to_ship', buyer: input.buyer, payment: input.payment, createdAt: new Date().toISOString(),
      };
    });
    const bought = (id: string) => input.items.filter(i => i.productId === id);
    setDb(cur => ({
      ...cur,
      // 扣庫存、加銷量
      products: cur.products.map(p => {
        const b = bought(p.id);
        if (!b.length) return p;
        return {
          ...p,
          sold: p.sold + b.reduce((s, i) => s + i.qty, 0),
          variants: p.variants.map(v => {
            const hit = b.find(i => i.variantId === v.id);
            return hit ? { ...v, stock: Math.max(0, v.stock - hit.qty) } : v;
          }),
        };
      }),
      cart: !input.fromCart ? cur.cart : cur.cart.filter(c => !input.items.some(i => i.productId === c.productId && i.variantId === c.variantId)),
      orders: [...created, ...cur.orders],
    }));
    return created;
  }, []);

  const createShop = useCallback((shop: Omit<Shop, 'id' | 'rating' | 'joinedAt'>) => {
    const full: Shop = { ...shop, id: uid('shop'), rating: 5, joinedAt: new Date().toISOString() };
    setDb(d => ({ ...d, shops: [...d.shops, full], sellerShopId: full.id }));
    return full;
  }, []);

  const saveProduct = useCallback((product: Product) => {
    setDb(d => {
      const exists = d.products.some(p => p.id === product.id);
      return {
        ...d,
        products: exists ? d.products.map(p => (p.id === product.id ? product : p)) : [product, ...d.products],
      };
    });
  }, []);

  const value = useMemo<Store>(() => ({
    ...db,
    getProduct: id => db.products.find(p => p.id === id),
    getShop: id => db.shops.find(s => s.id === id),
    cartCount: db.cart.reduce((s, c) => s + c.qty, 0),
    addToCart, setCartQty, removeFromCart, checkout, createShop, saveProduct,
    loginSeller: shopId => setDb(d => ({ ...d, sellerShopId: shopId })),
    logoutSeller: () => setDb(d => ({ ...d, sellerShopId: null })),
    deleteProduct: id => setDb(d => ({ ...d, products: d.products.filter(p => p.id !== id) })),
    updateOrderStatus: (id, status) =>
      setDb(d => ({ ...d, orders: d.orders.map(o => (o.id === id ? { ...o, status } : o)) })),
    resetDemo: () => setDb(seedDB()),
  }), [db, addToCart, setCartQty, removeFromCart, checkout, createShop, saveProduct]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore 必須在 StoreProvider 內使用');
  return s;
}
