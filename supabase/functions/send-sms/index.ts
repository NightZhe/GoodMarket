// Supabase Auth「Send SMS hook」端點：把 GoTrue 產生的 OTP 用三竹簡訊（Mitake）寄出。
// 部署：supabase functions deploy send-sms --no-verify-jwt（hook 來自 GoTrue，沒有使用者 JWT；驗證靠 standard-webhooks 簽章）。
// 環境變數（Supabase secrets，不進版控、不進日誌）：
//   SEND_SMS_HOOK_SECRET  後台 Hooks 頁產生的 `v1,whsec_…`（輪替時以「|」分隔多把）
//   MITAKE_HOST           三竹 API 主機名（只放主機名，程式補 https://）
//   MITAKE_USERNAME / MITAKE_PASSWORD
//   MITAKE_TIMEOUT_MS     選填，預設 3000（GoTrue 的 hook 總時限是 5 秒）
//   MITAKE_LOW_POINT      選填，剩餘點數低於此值時多記一行 warn，預設 100
// 邏輯在 handler.ts（可在 Node 下以 vitest 測試）；這裡只負責接上 Deno。
import { createHandler } from './handler.ts';

Deno.serve(createHandler({
  env: (k) => Deno.env.get(k),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
}));
