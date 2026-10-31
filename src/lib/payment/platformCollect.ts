// 平台收款（PR-乙）在隱私政策上的呈現：句子與日期跟 get_payment_config 的 platformCollectEnabled／platformCollectEnabledAt 走
// （spec §7、design.md §3；AC-58）。純函式，畫面只負責排版。

/** 第 2 節「怎麼使用」付款那一顆，平台收款開關開時取代「款項由綠界科技處理並撥給賣家」那句（甲 spec §7.2 原句；**待律師定稿**） */
export const PLATFORM_COLLECT_USE_SENTENCE = '你按下付款時，向綠界科技請求用你選的卡付款；款項先付給好物集，由好物集撥給賣家。';
/** 修訂紀錄新的一筆（日期＝開關打開日；design.md §3.4；**待律師定稿**） */
export const PLATFORM_COLLECT_REVISION = '線上付款改由好物集代收：你付的款項先付給好物集，再由好物集撥給賣家。';

/** ISO 時間 → 台灣日期 'YYYY/MM/DD'；null、空值、壞字串 → null（design.md §3.7：無效一律當沒有） */
export function taipeiDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms).replaceAll('-', '/');
}

/** 生效日：開關打開日晚於（或等於）常數時顯示打開日，否則維持常數；'YYYY/MM/DD' 可直接比字串大小 */
export const privacyEffectiveDate = (base: string, platformOnDate: string | null): string =>
  platformOnDate && platformOnDate > base ? platformOnDate : base;
