// Supabase Auth「Send SMS hook」端點：把 GoTrue 產生的 OTP 用簡訊寄出：三竹（Mitake，預設）或 MAAC Go，由 SMS_PROVIDER 切換。
// 部署：supabase functions deploy send-sms --no-verify-jwt（hook 來自 GoTrue，沒有使用者 JWT；驗證靠 standard-webhooks 簽章）。
// 環境變數（Supabase secrets，不進版控、不進日誌）：
//   SEND_SMS_HOOK_SECRET  後台 Hooks 頁產生的 `v1,whsec_…`（輪替時以「|」分隔多把）
//   SMS_PROVIDER          選填：mitake（預設）｜maacgo；其他值 → 500。每次請求重讀，改 secret 即切換
//  ── 三竹（SMS_PROVIDER 未設或 mitake）──
//   MITAKE_HOST           三竹 API 主機名（只放主機名，程式補 https://）
//   MITAKE_USERNAME / MITAKE_PASSWORD
//   MITAKE_TIMEOUT_MS     選填，預設 3000（GoTrue 的 hook 總時限是 5 秒）
//   MITAKE_LOW_POINT      選填，剩餘點數低於此值時多記一行 warn，預設 100
//  ── MAAC Go（SMS_PROVIDER=maacgo）──
//   MAACGO_API_KEY        sk_live_…（只放 secret，不進程式、不進日誌）
//   MAACGO_API_BASE       選填，預設 https://sms.cresclab.com；http 只准 localhost／127.0.0.1／host.docker.internal（本機假伺服器）
//   MAACGO_TIMEOUT_MS     選填，預設 3000
//   SMS_LOW_BALANCE_CENTS 選填，餘額（NT 分，78＝NT$0.78）低於此值多記一行 warn，預設 1000
// 邏輯在 handler.ts（可在 Node 下以 vitest 測試）；這裡只負責接上 Deno。
import { createHandler } from './handler.ts';

Deno.serve(createHandler({
  env: (k) => Deno.env.get(k),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
}));
