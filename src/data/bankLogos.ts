// 銀行 logo 網址（介面契約 v2.1 §6.3；Q25、N8、T3）。
// 兩道閘：①伺服器端開關（資料庫 bank_ui_settings.logos_enabled，由 RPC get_bank_ui_config() 讀出；
// 改資料庫即生效，App 不必重送審）②這份「有來源紀錄」的檔案表（沒有紀錄的 logo 上不了；測試會核對 sources.json 與檔案雜湊）。
// 本檔不碰網路：開關的值由呼叫端（前端 hook）讀 RPC 後傳進來；讀不到（舊資料庫、網路錯誤）就傳 false → 純文字。

/** 有來源紀錄、檔案在 public/bank-logos/ 的銀行（代碼 → 檔名）。新增時必須同步補 scripts/data/bank-logos/sources.json。 */
export const BANK_LOGO_FILES: Readonly<Record<string, string>> = {
  '822': '822.png',
  '013': '013.svg',
  '808': '808.png',
  '012': '012.png',
  '700': '700.png',
  '017': '017.png',
};

/** 開關關著、或該銀行沒有 logo 紀錄 → null（畫面只顯示文字，AC-48）。 */
export function bankLogoUrl(code: string, enabled: boolean): string | null {
  if (!enabled) return null;
  const f = Object.hasOwn(BANK_LOGO_FILES, code) ? BANK_LOGO_FILES[code] : undefined;
  return f ? `${import.meta.env.BASE_URL}bank-logos/${f}` : null;
}

/** 解析 get_bank_ui_config() 的回應；任何不是明確 { logos_enabled: true } 的東西都當作關閉。 */
export function parseLogosEnabled(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { logos_enabled?: unknown }).logos_enabled === true;
}
