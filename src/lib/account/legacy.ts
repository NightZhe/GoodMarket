import type { StorageLike } from '../auth/pending';

// 買家帳號上線前，裝置上留下的舊資料（D16、D17＝B）：
//   goodmarket_cart        遊客購物車，不併入帳號、直接丟掉
//   goodmarket_order_keys  訂單憑證，整套淘汰
//   goodmarket_review_draft:*（sessionStorage）舊訂單的評價草稿；那些訂單上線時已刪除
// 前兩個沒有任何程式會再寫，每次載入都清是無害的。草稿只清一次：評價草稿要撐過 Safari 回收頁面，
// 每次載入都清會讓這個功能失效，所以用一個旗標記住「已經清過」。

const LEGACY_KEYS = ['goodmarket_cart', 'goodmarket_order_keys'];
const DRAFT_PREFIX = 'goodmarket_review_draft:';
export const LEGACY_CLEANED_KEY = 'goodmarket_legacy_cleaned_v1';

interface Enumerable extends StorageLike { readonly length: number; key(i: number): string | null }

export function cleanLegacyStorage(local: StorageLike, session: Enumerable): void {
  for (const k of LEGACY_KEYS) {
    try { local.removeItem(k); } catch { /* 無痕模式可能不能寫；沒有舊資料可清 */ }
  }
  try {
    if (local.getItem(LEGACY_CLEANED_KEY)) return;
    const drafts: string[] = [];
    for (let i = 0; i < session.length; i++) {
      const k = session.key(i);
      if (k?.startsWith(DRAFT_PREFIX)) drafts.push(k);
    }
    drafts.forEach(k => session.removeItem(k));
    local.setItem(LEGACY_CLEANED_KEY, '1');
  } catch { /* 儲存空間被擋就算了，下次載入再試 */ }
}
