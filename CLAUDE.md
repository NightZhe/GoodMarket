# GoodMarket（好物集）專案規則

通用規則見 `~/harryaiagent/CLAUDE.md` 與 `.claude/handbook/`。以下是本專案的例外。

## 規格與工單：用本地檔案，不走 Linear（2026-10-15 使用者決定）

團隊流程預設把規格與工單發到 Linear（`/to-spec`、`/to-tickets`）。本專案不走 Linear，
改用本地檔案，每個功能一個資料夾：

```
.work/<功能名>/
  research-report.html   調研報告（若有）
  decisions.md           使用者拍板的決策，下游不得推翻
  spec.md                規格、驗收條件、工單拆分
  fixtures/              真實測試資料
```

**`.work/` 不進版控**：本 repo 是公開的，而 fixtures 常含真實店家資料（店家 ID、商品、價格）。
要讓下游角色讀的東西放這裡；要公開的文件另外整理後放 `docs/`。

## 部署

推 `main` 由 GitHub Actions 自動部署到 GitHub Pages，不用 `/deploy` skill（那是 Railway 用的）。

## 資料庫（2026-10-16 起）

- **來源真相是 `supabase/migrations/`**：基準檔是正式站唯讀匯出，之後每次異動新增一個 migration。
  `supabase/schema.sql` 已落後正式站，不要拿它重建資料庫。
- **本機開發**：Docker ＋ `npx supabase start`；`.env.local` 指向 `http://127.0.0.1:54321`（Vite 會蓋過指向正式站的 `.env`）。
  重置：`npx supabase db reset --local`（會載入 `supabase/seed.sql`，由 `scripts/gen-seed-sql.mts` 產生）。
- **套用正式站**（`hvecvwzpummmlsakxqbw`，已 link）：只套新的 migration 檔，
  `npx supabase db query --linked -f supabase/migrations/<檔名>.sql`。不要用 `db push`
  （正式站沒有基準檔的 migration 紀錄，會重跑基準檔）。
- **順序**：先套資料庫（只做相容的新增）→ 再推前端。反過來新前端會找不到新結構。
  **例外：migration 會「收回」權限時，反過來做**（2026-10-16 使用者拍板，商品評價那次）。
  例如收回 orders 的欄位權限：舊前端的 `select('*')` 一碰到就 403。這時先推「不依賴新權限、
  缺新 RPC 也能降級」的前端，再套 migration。推之前要在本機驗過「新前端＋舊資料庫」不會壞。
- `db query --local -f` 不支援一個檔多個指令；本機整檔請用
  `docker exec -i supabase_db_GoodMarket psql -U postgres -d postgres < 檔案`。
- `db query --linked` 的 stdout 開頭有一行 `Initialising login role...`，不是純 JSON；解析時先切到第一個 `{`。
  正式站步驟**一次一個指令**、每步檢查 exit 與輸出大小，不要用長串 `&&` 串接（2026-10-18 曾因此預覽檔寫成 0 bytes）。
- `supabase/.env`（已 gitignore）放使用者本機 Google OAuth 用戶端的密鑰，**agent 不得建立、修改、刪除**，只能讀 sha256 證明沒動。
- 本機假 OAuth 驗證法：暫改 `supabase/config.toml` 加 keycloak／github 區塊指向本機假伺服器，跑真實 GoTrue PKCE；測完必須還原並附 sha256。做法見 `.work/buyer-auth/t3-ac46.md`。

## 目前狀態（2026-10-19 更新，給新 session 的交接）

已上線：商品評價（含照片、賣家回覆）；買家已取貨自動完成＋訂單狀態鎖定；**買家帳號**（遊客只能瀏覽，
加購物車／下單／訂單／評價都要 Google 或 Apple 登入；購物車與訂單綁帳號；舊訂單憑證機制已移除）；
**商品表單上限**（售價／原價 499,999、庫存 999,999，`src/lib/products/variants.ts`）；帳號頁拿掉「刪除帳號」區塊（申請方式只在隱私政策頁）；
**我的商品列表快改**（點價格／庫存格就地改、多規格展開、手機底部面板；走資料庫函式 `quick_edit_product`：只寫被改的值、比對舊值回衝突、
庫存全 0 自動下架、留 `product_change_log` 異動紀錄；列表斷點改 1024；上下架改只寫 status）。
**快改補貨自動上架**（2026-10-23，`list-quick-edit/spec-auto-relist.md`、D-5 修訂與 D-11～D-14）：只有被快改自動下架（`products.auto_hidden=true`，由觸發器維護，status 經任何途徑變動就清掉）的商品，快改把任一規格從 0 改成 > 0 時同交易自動上架，回傳 `autoRelisted`，提示「已更新，已重新上架」；手動下架補貨不上架；編輯頁「儲存但不上架」不清旗標（D-14）。
正式站**已套** `20261023130000_quick_edit_auto_relist.sql`（2026-10-23，precheck／v1／v2 all_ok，`prod-apply-log.md` 第 9～12 步）；前端在 PR #4，merge 後部署。runbook `prod-runbook-auto-relist.md`，驗收 `qa-report-auto-relist.md`。
每個功能的決策、規格、驗收報告、上線紀錄都在 `.work/<功能>/`（不進版控）：
`product-reviews/`、`picked-up-complete/`、`buyer-auth/`、`list-quick-edit/`（含 `prod-runbook.md`、`prod-apply-log.md`、`tools/metrics/` 成功指標查詢）。
**帳號頁「我的帳戶」＋個人檔案（暱稱，預填評價）＋地址簿**（2026-10-18 晚間上線，`account-payment-methods/`：縣市／鄉鎮市區下拉＋郵遞區號自動帶出、每帳號最多 10 筆、唯一預設；
結帳改從地址簿選，地址簿空時填表並預設「存到我的地址」；裝置上的舊收件資料 `goodmarket_buyer` 新前端啟動時清掉；資料表 `profiles`／`addresses`／`tw_districts` 寫入只走 RPC，
行政區清單由 `scripts/gen-tw-districts.mts` 從中華郵政 3 碼檔產生，`src/data/tw-districts.json` 與資料庫同源）。隱私政策生效日改為 2026/10/18。
**刪帳號工具已更新**（會一併刪地址與個人檔案；舊版備份在 `account-payment-methods/tools/pre-A-T4-account-tool/`）。
**線上付款（綠界特約合作平台商，`account-payment-methods/`）**：前後端程式已合併並推上線（2026-10-20），但**功能開關預設關**、正式站**尚未套** `20261019200000_ecpay_payments.sql`、**尚未部署** `supabase/functions/payment-*`，買家看不到任何付款入口（前端對缺少 `get_payment_config` 的資料庫一律視為關）。設計：買家平台層綁卡（卡號只在綠界 SDK，本站存 BindCardID 於 service-role 專用表）、多店一次付款＝每店各授權一筆、全部成功才請款、任一失敗放棄已授權；賣家在綠界成為本站底下的特約商店，本站只存編號與狀態；LINE Pay 本版不做；本站不經手錢（D3＝B）。
上線前置（使用者）：以公司申請綠界平台商與綁卡白名單、拿 HashKey／IV、確認綁卡用特店與最低金額；之後照 `prod-runbook-pb.md`：套 migration → 設 Edge Function secrets → 部署函式 → 後台啟用 pg_cron／pg_net 排程 → 開開關 → 實刷。待補規格：退款、刪帳號同步向綠界刪卡、撥款對帳。
→ 這三份已由另一 session 做成 **PR #2**（分支 `feat/payment-go-live-prereqs`，2026-10-21，待使用者確認文案後合併；merge 只部署前端、開關仍關）。
個人中心／金流線的完整交接在 `.work/account-payment-methods/handoff-2026-10-23.md`。
**手機號碼簡訊登入**（`phone-otp-auth/`，**2026-10-23 上線完成**；前端 2026-10-19 fba774c）：買家與賣家改用 Apple／Google／台灣手機號碼＋簡訊驗證碼，
Email＋密碼登入已從畫面移除（規格 `.work/email-password-auth/` 作廢）；帳號頁可綁手機（`#/account/phone`）。正式站 Phone provider 開、Confirm phone 開、OTP 6 碼／300 秒、Rate Limits SMS 每小時 20、
Cloudflare Turnstile Captcha 開（sitekey 由 GitHub secret `VITE_TURNSTILE_SITEKEY` 注入，前端已重建帶入；不帶 token 的 `/auth/v1/otp` 回 `captcha_failed` 已驗）。
**簡訊供應商：MAAC Go（漸強實驗室，自有帳號，NT$0.78／則；決策 P18）**，三竹（Mitake，借用帳號）為備援：Supabase 沒有原生整合，走 Auth Send SMS hook → Edge Function `supabase/functions/send-sms/`
（雙供應商，secret `SMS_PROVIDER`＝`maacgo`｜`mitake`，切換只改 secret 不重部署；簽章驗證、只寄 +886、3 秒逾時不重試、失敗回 200＋`{"error":{"http_code":502}}`、log 遮罩）→ 供應商 API。
規格附錄 `spec-mitake.md`、`t8-maacgo-tests.md`；上線紀錄 `prod-apply-log.md`。正式站 secrets：`SMS_PROVIDER`、`MAACGO_API_KEY`、**`MAACGO_FROM`（寄件長碼，必設：不設時 MAAC Go 走共用短碼 1990，電信端收不到，10/23 六封實測全掉）**、`SEND_SMS_HOOK_SECRET`（三竹 `MITAKE_*` **未設**，要用備援前得先設）。
**使用者 10/23 拍板（P19）暫不做的兩項**：(1) 步驟 5「刪只有 Email 身分的開店帳號」：預覽唯一會刪的是當天新建的店，決定保留；刪除工具已認得 `checkout_rejection_log` 外鍵（`t9-fk-rehearsal.md`），日後要清從 runbook 5a 重跑。
(2) 步驟 6 **Email provider 維持開啟**（上述帳號只有 Email 身分）。這兩項不是待辦，除非使用者再提。
（掉信問題 10/23 已解：函式 8835d40 加選填 secret `MAACGO_FROM`，設長碼後兩支門號皆收到。）
已知問題（不擋上線，P15）：驗證請求逾時後才成功時待辦動作不執行（L-1）；Safari 桌機外接鍵盤 Tab 第一下落到背景（S-3）。
多 session 並行同一 repo 的做法（2026-10-18 起）：各自用 git worktree 分支與隔離的本機 Supabase 實例（複製 `supabase/` 到暫存區換 project_id／port），不改 repo `config.toml`；合併前互相知會。

**結帳比價**（`checkout-price-check/`，2026-10-19 上線）：新前端下單改走資料庫函式 `place_checked_order`，帶結帳頁顯示的單價與每店運費；
伺服器鎖列後逐件比單價、庫存、逐店比運費，任一不一致就**不建單、不扣庫存、不動購物車**，只寫 `checkout_rejection_log`（不記買家身分，前端讀不到）並回
`{outcome:'rejected', changes}`；前端整頁換成「下單失敗，請重新購買」失敗畫面，直接購買導回商品頁、購物車結帳導回購物車並標出問題品項（只勾被擋那批）；
成功訂單 `lines[].seenPrice` 標記經過比對；購物車進頁靜默重讀商品（`reload({silent:true})`）。規格 v0.2、決策、介面、設計、驗收報告、`prod-runbook.md`、
`tools/metrics/m1～m6.sql`（成功指標）都在 `.work/checkout-price-check/`。
**收緊舊函式已完成**（2026-10-19，使用者實機驗 AC-51／AC-52 後另給清單確認才套）：正式站已套 `20261018180100_checkout_price_check_tighten.sql`，
舊 `place_account_order` 一律回 CLIENT_OUTDATED「網站已更新，請重新整理頁面後再下單」（簽名、權限不變）；v1／v2 驗證 all_ok、匿名冒煙 HTTP 400 相符，紀錄在 `prod-apply-log.md` 第 7～8 步。
之後 `tools/metrics/m2.sql` 的 `unchecked_orders` 應維持 0；還原用 `tools/rollback-tighten.sql`（runbook 第 9 節 A）。
本機 `db reset --local` 會連收緊一起套，驗「舊前端＋新資料庫」要先跑 `tools/rollback-tighten.sql`（`interface.md` §7）。

下一個該做的：付款（P-B／P-C，等 PAYUNi 拍板）。

維運提醒：
- **Apple 登入 client secret 2027-04-15 到期**，2027-04-01 前用 Supabase 文件頁工具＋原 `.p8` 重做並更新後台。
- 刪帳號走人工流程：工具改為 `.work/phone-otp-auth/tools/account-tool-phone.mjs`（用法 `runbook-account-tool-notes.md`；取代 `buyer-auth` 舊工具，原因是外鍵集合變了）；有開店的帳號工具會擋，另外處理。
- 寄信用 Gmail SMTP（寄件人「好物集」），目前沒有任何流程會寄信；Confirm email 使用者決定**不開**（理由與風險評估在 `.work/buyer-auth/decisions.md`，本檔進公開 repo，不展開）。
- 正式站 Storage 刪檔需要 service role key：由使用者在自己終端機以 `read -rs` 輸入後跑 `tools/delete-review-paths.mjs`，不經過 agent。
- 手機登入上線後：Supabase **Confirm phone 不得關閉**（關了簡訊額度不生效、門號可被改綁到他人帳號）；緊急止血要同時關 Phone provider **並**把 Rate Limits 的 SMS 每小時調低（只關 provider 止不住綁手機那條路）。MAAC Go 餘額（函式 log 的 `balance_cents`，低於 `SMS_LOW_BALANCE_CENTS` 預設 NT$10 會記 `maacgo_low_balance`）與 Cloudflare Turnstile 統計每週看；Turnstile Secret 與 MAAC Go key 只在後台，不進 repo。刪帳號改用 `.work/phone-otp-auth/tools/account-tool-phone.mjs`（認得 phone 身分），`buyer-auth` 舊工具作廢。
- 正式站 runbook 的指令用函式 `Q()` 包 `npx supabase db query --linked`；舊 `buyer-auth/prod-runbook.md` 的字串變數寫法在 zsh 會 command not found。

已知小問題（不急）：下單成功路徑小計仍是 integer，單張訂單超過 21 億元會 `integer out of range`（舊函式也一樣，不會建錯單）；失敗畫面 VoiceOver 實聽未驗（無障礙樹已對）；登入方式設定讀取超過 5 秒會先顯示兩顆按鈕；平板寬度賣家首頁與商品頁有橫向捲軸；
購物車兩次更新間隔 3 秒內讀屏可能不重念；賣家中心頂欄在 188px 寬（手機 200%）橫向溢出，快改面板的關閉鈕會被擠出；
`.claude/agents/qa.md` 沒有「交件前必跑關卡」表（其他四個角色都有）；快改與帳號頁地址簿的 iPhone Safari／LINE 實機驗收待使用者；離線按登出時「登出失敗」訊息與實際已登出矛盾（既有）；「我的訂單」不顯示收件地址（既有）；隱私頁與結帳底欄在 188px 寬有幾 px 橫向溢出（既有）。
