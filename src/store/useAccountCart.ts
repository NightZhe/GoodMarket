import { useCallback, useEffect, useRef, useState } from 'react';
import { addToCartRpc, deleteCartRow, fetchCart, updateCartQty } from '../lib/account/api';
import { clampQty, overlayOps, queueOp, sameCart, withQty, withoutItems, type CartOp } from '../lib/account/cart';
import { toAccountError, type AccountErrorKind } from '../lib/account/errors';
import type { CartItem } from '../types';

// 帳號版購物車（D15）：資料在資料庫，換裝置也看得到。
//   讀、改數量、刪除走 PostgREST；加入走 add_to_cart RPC（原子累加，並驗商品、規格、庫存、自購）。
//   改數量、刪除先改畫面（樂觀更新）再寫資料庫：
//     - 斷線：留在待寫佇列、顯示「購物車暫時無法同步」，可以重試；畫面維持使用者剛改的值。
//     - 資料庫拒絕：把畫面還原成伺服器的樣子，並把錯誤往上丟讓畫面 toast。
//   所有寫入排隊一個接一個送，連點數量步進器不會讓較舊的修改蓋掉較新的。

export type CartState = 'idle' | 'loading' | 'ready' | 'error';

export function useAccountCart(userId: string | null, onAuthLost: () => void) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartState, setCartState] = useState<CartState>('idle');
  const [cartIssue, setCartIssue] = useState<AccountErrorKind | null>(null);
  const [cartSyncFailed, setCartSyncFailed] = useState(false);
  /** 別台裝置改了內容、這裡背景重讀後有變化的次數；畫面據此宣告「購物車已更新」（讀屏用） */
  const [cartUpdateTick, setCartUpdateTick] = useState(0);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const seq = useRef(0);
  const ops = useRef<CartOp[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const send = (op: CartOp) => (op.type === 'qty' ? updateCartQty(op.productId, op.variantId, op.qty) : deleteCartRow(op.productId, op.variantId));

  /** 把斷線期間暫存的修改依序寫進去；回傳 true＝全部寫完 */
  const flush = useCallback(async (): Promise<boolean> => {
    while (ops.current.length > 0) {
      const op = ops.current[0];
      try {
        await send(op);
        ops.current = ops.current.slice(1);
      } catch (e) {
        const err = toAccountError(e);
        if (err.kind === 'auth') onAuthLost();
        if (err.kind === 'network') return false;
        ops.current = ops.current.slice(1); // 資料庫明確拒絕的修改不會因為重試變好，丟掉，之後重讀會回到伺服器的樣子
      }
    }
    setCartSyncFailed(false);
    return true;
  }, [onAuthLost]);

  /** silent：背景重讀；announce：內容有變時通知畫面（自己加入購物車之後的重讀不宣告，那已經有 toast） */
  const refreshCart = useCallback(async (silent = false, announce = silent): Promise<boolean> => {
    if (!userId) {
      seq.current++;
      ops.current = [];
      setCart([]);
      setCartState('idle');
      setCartSyncFailed(false);
      return true;
    }
    const s = ++seq.current;
    if (!silent) setCartState(p => (p === 'ready' ? 'ready' : 'loading'));
    try {
      if (ops.current.length > 0 && !(await flush())) return false; // 還有寫不進去的修改：不要用舊資料蓋掉它們
      const rows = await fetchCart();
      if (s !== seq.current) return true;
      const next = overlayOps(rows, ops.current);
      if (announce && cartRef.current.length + next.length > 0 && !sameCart(cartRef.current, next)) setCartUpdateTick(t => t + 1);
      setCart(next);
      setCartState('ready');
      setCartIssue(null);
      return true;
    } catch (e) {
      const err = toAccountError(e);
      if (err.kind === 'auth') onAuthLost();
      if (s !== seq.current) return false;
      setCartIssue(err.kind);
      setCartState(p => (silent && p === 'ready' ? 'ready' : 'error'));
      return false;
    }
  }, [userId, flush, onAuthLost]);

  useEffect(() => { void refreshCart(); }, [refreshCart]);

  // 切回分頁時重讀（R-6）：別台裝置改的內容要看得到。桌面只切視窗不會觸發 visibilitychange，所以也聽 focus
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshCart(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [userId, refreshCart]);

  /** 加入購物車。成功後重讀整份（累加後的數量以資料庫為準，也避免跟剛載入中的舊快照打架） */
  const addToCart = useCallback(async (item: CartItem) => {
    try {
      await enqueue(() => addToCartRpc({ ...item, qty: clampQty(item.qty) }));
    } catch (e) {
      const err = toAccountError(e);
      if (err.kind === 'auth') onAuthLost();
      throw err;
    }
    await refreshCart(true, false);
  }, [enqueue, refreshCart, onAuthLost]);

  const write = useCallback(async (op: CartOp, optimistic: (c: CartItem[]) => CartItem[]) => {
    seq.current++; // 讓還在飛的重讀作廢，不要蓋掉剛改的畫面
    setCart(optimistic);
    try {
      await enqueue(async () => {
        if (ops.current.length > 0 && !(await flush())) { ops.current = queueOp(ops.current, op); return; }
        await send(op);
      });
    } catch (e) {
      const err = toAccountError(e);
      if (err.kind === 'network') {
        ops.current = queueOp(ops.current, op);
        setCartSyncFailed(true);
        return;
      }
      if (err.kind === 'auth') onAuthLost();
      await refreshCart(true, false);
      throw err;
    }
    if (ops.current.length > 0) setCartSyncFailed(true);
  }, [enqueue, flush, refreshCart, onAuthLost]);

  const setCartQty = useCallback((productId: string, variantId: string, qty: number) => {
    const q = clampQty(qty);
    return write({ type: 'qty', productId, variantId, qty: q }, c => withQty(c, { productId, variantId }, q));
  }, [write]);

  const removeFromCart = useCallback(async (items: Pick<CartItem, 'productId' | 'variantId'>[]) => {
    // 一列一列刪（主鍵是三欄複合，PostgREST 沒辦法一次刪多個複合條件）
    let firstError: unknown = null;
    for (const i of items) {
      try {
        await write({ type: 'delete', productId: i.productId, variantId: i.variantId }, c => withoutItems(c, [i]));
      } catch (e) { firstError ??= e; }
    }
    if (firstError) throw firstError;
  }, [write]);

  const retryCartSync = useCallback(async () => {
    await refreshCart(true);
  }, [refreshCart]);

  return { cart, cartState, cartIssue, cartSyncFailed, cartUpdateTick, refreshCart, addToCart, setCartQty, removeFromCart, retryCartSync };
}
