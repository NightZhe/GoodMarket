// 開店（建立商店）失敗的錯誤文字。登入的錯誤不在這裡（lib/auth/phoneErrors.ts）。
// 絕不顯示英文原文：認得的翻成中文，其他一律「沒有完成，請再試一次。」

export function shopErrorText(message: string): string {
  if (/duplicate key value.*shops_owner_unique/i.test(message)) return '這個帳號已經有一家店了';
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return '連不上伺服器，請檢查網路後再試。';
  return '沒有完成，請再試一次。';
}
