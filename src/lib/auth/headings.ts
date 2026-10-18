import type { InAppKind } from './inapp';
import type { PendingInput } from './pending';
import { ALL_PROVIDERS, type EnabledProviders } from './providers';

/** 內建瀏覽器說明的兩句（賣家卡沒有標題列，拆成橫幅標題＋內文用）。外開說法：LINE 在 iPhone 是 Safari，其他是瀏覽器 */
export function inAppLines(inApp: InAppKind, ios: boolean) {
  const lead = inApp === 'line' ? 'LINE 裡無法使用 Google 登入。' : 'Facebook、Instagram 裡無法使用 Google 登入。';
  const browser = inApp === 'line' && ios ? ' Safari ' : '瀏覽器';
  return { lead, rest: `你可以直接用手機號碼登入，或改用${browser}開啟後再用 Google 或 Apple 登入。` };
}

/** 登入面板、登入閘門、賣家中心共用的標題與說明（S-1、S-3、S-5） */
export function headingFor(a: { trigger: PendingInput | null; expired: boolean; inApp: InAppKind | null; ios: boolean; providers?: EnabledProviders }) {
  const p = a.providers ?? ALL_PROVIDERS;
  if (a.inApp) {
    // 手機號碼為主（P12）：標題改「用手機號碼登入」，不再叫人先離開。手機登入被後台關掉時才維持原本叫人換瀏覽器的說法
    if (p.phone) {
      const { lead, rest } = inAppLines(a.inApp, a.ios);
      return { title: '用手機號碼登入', description: `${lead}${rest}` };
    }
    if (a.inApp === 'line') return { title: a.ios ? '請改用 Safari 登入' : '請改用瀏覽器登入', description: 'LINE 內建的瀏覽器無法使用 Google 登入。' };
    return { title: '請改用瀏覽器開啟', description: 'Facebook、Instagram 內建的瀏覽器無法使用 Google 登入。' };
  }
  // 說明文字跟著「實際顯示的按鈕」走：沒啟用的方式不能還寫在說明裡（R-13）
  const named = [p.google && 'Google', p.apple && 'Apple'].filter(Boolean) as string[];
  const description = p.phone
    ? `${named.length === 0 ? '用手機號碼登入' : `用 ${named.join('、')} 或手機號碼登入`}，不用設密碼。`
    : p.google && p.apple ? '用 Google 或 Apple 一鍵登入，不用設密碼。'
    : p.google ? '用 Google 一鍵登入，不用設密碼。'
    : p.apple ? '用 Apple 一鍵登入，不用設密碼。'
    : '登入功能暫時無法使用，請稍後再試。';
  if (a.expired) {
    // 只有結帳會還原收件資料、付款方式與商品；個人檔案、地址表單過期時只保留剛才填的內容
    const description = a.trigger?.kind === 'checkout'
      ? '請重新登入。你填的收件資料、付款方式和商品都還在。'
      : '請重新登入。你剛才填的內容都還在。';
    return { title: '登入已過期', description };
  }
  if (a.trigger?.kind === 'add_to_cart') return { title: '登入後才能加入購物車', description };
  if (a.trigger?.kind === 'buy_now') return { title: '登入後才能購買', description };
  return { title: '登入好物集', description };
}
