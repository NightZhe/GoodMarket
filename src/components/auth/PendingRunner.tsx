import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { checkAutoAction, reasonFromDbCode, autoModeOf, type AutoReason } from '../../lib/auth/autoAction';
import { browserStores, takePending, type PendingAction } from '../../lib/auth/pending';
import { toAccountError } from '../../lib/account/errors';
import { useAuth } from '../../store/AuthContext';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../Toast';

type ProductAction = Extract<PendingAction, { kind: 'add_to_cart' | 'buy_now' }>;

/**
 * 登入回來之後自動完成原本的動作（D14）。放在路由內（要導頁）。
 *   - 只有「剛登入回來」才取用這個瀏覽器自己存下的待辦動作；平常載入、網址帶參數的連結都不會碰它（B-2：連結不能自動替人加購物車）。
 *   - 取用就是刪除：重新整理、上一頁、StrictMode 重跑 effect 都不會做第二次（AC-15）。
 *   - 不能執行時（過期、下架、規格沒了、庫存不夠、自己的商店）停在商品頁說明原因，選擇保留。
 */
export default function PendingRunner() {
  const { authReady, user, loading, shopReady, myShop, getProduct, getShop, addToCart } = useStore();
  const { runPendingOnLoad, setAutoNotice, clearHandoff } = useAuth();
  const { pathname } = useLocation();
  const firstPath = useRef(pathname);
  const navigate = useNavigate();
  const toast = useToast();
  const ran = useRef(false);

  // 網址帶來的預填只對「打開連結的那一頁」有效：離開之後就不再詢問
  useEffect(() => { if (pathname !== firstPath.current) clearHandoff(); }, [pathname, clearHandoff]);

  useEffect(() => {
    if (ran.current || !runPendingOnLoad || !authReady || loading || !user || !shopReady) return;
    ran.current = true;
    const rec = takePending(browserStores(), Date.now());
    if (!rec) return;
    const { action, expired } = rec;

    const addOnce = async (a: ProductAction) => {
      const product = getProduct(a.productId);
      try {
        await addToCart({ productId: a.productId, variantId: a.variantId, qty: a.qty });
        setAutoNotice(null);
        toast('登入成功，已加入購物車');
      } catch (e) {
        const err = toAccountError(e);
        // 前端預檢沒擋到、資料庫擋下的（例如剛好被搶購）走同一套說明
        const reason: AutoReason = reasonFromDbCode(err.code) ?? 'failed';
        setAutoNotice({
          mode: 'cart', productId: a.productId, reason,
          detail: { shopName: product ? getShop(product.shopId)?.name : undefined },
          retry: reason === 'failed' ? () => { void addOnce(a); } : undefined,
        });
      }
    };

    if (action.kind === 'goto') {
      navigate(action.returnTo, { replace: true });
      return;
    }
    if (action.kind === 'checkout') {
      // 結帳過期後重新登入：還原品項、付款方式、收件資料。不自動下單，按一次「下訂單」即可（AC-13）
      if (expired) {
        navigate('/cart', { replace: true });
        toast('登入花了比較久，請確認要結帳的商品後再結帳', 'info');
        return;
      }
      navigate('/checkout', {
        replace: true,
        state: { items: action.items, fromCart: action.fromCart, payment: action.payment, buyer: action.buyer, reauth: true },
      });
      return;
    }

    navigate(action.returnTo, { replace: true });
    const product = getProduct(action.productId);
    const mode = autoModeOf(action);
    const check = checkAutoAction({
      action, now: Date.now(), product, myShopId: myShop?.id ?? null,
      shopName: product ? getShop(product.shopId)?.name : undefined,
    });
    if (!check.ok) {
      const { reason, ...detail } = check;
      setAutoNotice({ mode, productId: action.productId, reason, detail });
      return;
    }
    if (action.kind === 'add_to_cart') {
      void addOnce(action);
    } else {
      navigate('/checkout', { state: { items: [{ productId: action.productId, variantId: action.variantId, qty: action.qty }], fromCart: false } });
    }
  }, [runPendingOnLoad, authReady, loading, user, shopReady, myShop, getProduct, getShop, addToCart, navigate, toast, setAutoNotice]);

  return null;
}
