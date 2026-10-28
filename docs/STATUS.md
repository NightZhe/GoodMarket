# GoodMarket 目前狀態（給新 session 的交接）

從 `CLAUDE.md` 搬來（2026-10-25）。新功能上線後更新本檔，不要寫回 `CLAUDE.md`。
各功能的決策、規格、驗收報告、上線紀錄都在 `.work/<功能>/`（不進版控）。

## 目前狀態（2026-10-19 更新）

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
**線上付款（綠界特約合作平台商，`account-payment-methods/`）**：前後端程式已合併並推上線（2026-10-20）。**2026-10-28 正式站已套** `20261019200000_ecpay_payments`、`20261020120000_account_delete_cards`、`20261020130000_refunds`、`20261020140000_payout_reconcile`（verify 皆 all_ok），**付款開關已開**（使用者指示，金流商確認綠界；紀錄 `prod-apply-log.md`）；對帳開關仍關。**尚未設 secrets、尚未部署** `supabase/functions/payment-*`／`payout-reconcile`、無綠界平台商資格：買家「新增信用卡」會失敗；沒有任何店 active，結帳仍只有貨到付款；賣家可在收款帳戶頁送出特約商店編號（pending_review）。設計：買家平台層綁卡（卡號只在綠界 SDK，本站存 BindCardID 於 service-role 專用表）、多店一次付款＝每店各授權一筆、全部成功才請款、任一失敗放棄已授權；賣家在綠界成為本站底下的特約商店，本站只存編號與狀態；LINE Pay 本版不做；本站不經手錢（D3＝B）。
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

**賣家物流設定（退貨地址）**（`seller-logistics/`，2026-10-25 上線；PR #6，分支 `claude/seller-logistics-41bfa8`）：賣家中心第六頁「物流設定」`#/seller/logistics` 存退貨收件資料——
超商退貨門市 ≤ 5（唯一預設、品牌 7-ELEVEN／全家／萊爾富／OKmart）、宅配退貨個人地址 1 筆、退貨說明 ≤ 200 字；新增／編輯表單是獨立頁（N5）；手機底欄維持 5 格、從賣場總覽的常駐入口列或「尚未設定退貨地址」提示卡進（N4＝B）。
買家只在自己「運送中／已完成」的訂單展開「退貨資訊」時經 `get_order_return_info(p_order)` 讀到（展開才讀；別人的／不存在的訂單同碼 `ORDER_NOT_FOUND`）；資料庫未升級時展開才顯示「暫時無法使用」（N6）。
資料表 `return_stores`／`return_personal_addresses`／`return_notes` 都掛在 `shops`（cascade，不指向 `auth.users`），對 anon／authenticated 零權限，只走八個 RPC；正式站已套 `20261023150000_seller_return_addresses.sql`（紀錄 `prod-apply-log.md`，既有物件指紋前後相同）。
刪店工具 `.work/phone-otp-auth/tools/` 21～23／`seller-lib.mjs` 已認得三張新表（已知外鍵 24 條），**2026-10-23 之前的刪店預覽檔作廢**；刪帳號工具不用改。隱私政策第 3 節加一句、生效日改 2026/10/25。
規格、決策（D1～D19、N1～N8）、設計、介面契約、驗收報告、`prod-runbook.md`、`tools/metrics/l-m1～l-m5.sql`、還原 `tools/rollback-logistics.sql` 都在 `.work/seller-logistics/`。
不做（另開規格）：物流方式與運費、退貨申請狀態機、超商 API。待辦：隱私政策簡訊服務商仍寫「三竹」但正式站是 MAAC Go（N3，另開一張盡快修）。

**買家端 App Store 風改版**（2026-10-25 上線，PR #7，`.work/ui-redesign/`：決策 `decisions.md` D1～D6／R1～R6、定稿 `design-final.md`、mock `mock-appstore.html`、小q 五輪驗收 `qa-report-round1～5.md`）：
白底、大標題（首頁「好物集」、其他分頁用分頁名）、系統字、膠囊、`.material` 毛玻璃 tab bar（第 5 格改「我的」，未登入有頁面）、
故事卡規則自動挑（`src/lib/home/pickStory.ts`：近 7 天上新最多的分類、≥3 件才顯示）、單色線條分類圖示（`src/data/categoryIcons.tsx`）、
商品卡價格緊貼圖下＋「已售 N」同列（`cardLabel.ts` 組 aria-label；原價依剩餘空間顯示，優先序 價格 > 已售 > 原價，門檻在 `ProductCard.tsx` 的 `origShowAt`）。
主色改 `#BF4419`（`brand`），原橘只留 `brand-logo`；token 與字級在 `src/index.css` `@theme`。賣家中心只換色未重排。
待使用者實機驗：AC-7 登入後導頁、AC-15 VoiceOver、AC-20 加入主畫面；待小p 定故事卡副標的關鍵字規則（目前副標不顯示）。
`src/pages/buyer/ReviewForm.tsx`／`ReviewsOverview.tsx`／`Orders.tsx` 仍有 emoji（不在改版工單範圍）。

**App 殼（iOS／Android App，Capacitor 8）**（2026-10-25 合併 PR #5，`.work/app-shell/`：選型與決策 `decisions.md`、上架門檻一手條文 `store-requirements.md`、使用者前置清單 `prereqs-user.md`、
tracer 結果 `tracer-report.md`、小q 驗收 `qa-report-tracer.md`、正式站設定紀錄 `prod-apply-log.md`）：一套程式碼三平台，`ios/`、`android/` 原生專案進版控，
bundle id／application id `io.github.nightzhe.goodmarket`。App 的更新流程：`npm run build` → `npx cap sync` → Xcode（`ios/App/App.xcodeproj`，SPM）或 Gradle（`android/`，**需 JDK 21**，
`export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`；Gradle 會自動補 SDK，不需 Android Studio）。
App 內 Google／Apple 登入走系統瀏覽器視圖＋自訂 scheme 回跳（`src/lib/native/`；Supabase Redirect URLs 已加 `io.github.nightzhe.goodmarket://auth`），原生外掛只在 App 內動態載入，網頁 bundle 不受影響。
殼專用樣式 `src/native.css` 只在 `html.native` 生效：買家前台改版後自己處理安全區，殼只補賣家中心（`header.sticky.top-0`）與賣家登入頁。
**審查員登入深連結**（PR #11，2026-10-26 合併）：`io.github.nightzhe.goodmarket://review-login` 冷啟動直達 `#/review-login`（`src/lib/native/deeplink.ts`，一般 `://<路由>` 都接、`://auth` 留給登入回跳）。
**WebView hostname 是 `nightzhe.github.io`**（`capacitor.config.ts` `server.hostname`）：Capacitor 預設 localhost 不在 Cloudflare Turnstile 允許網域（110200），改成正式站網域後 App 內簡訊登入與審查員登入的安全驗證才載得起來；Android 模擬器 Turnstile 回 600010（疑似機器人）要真機驗。
**App 內 Turnstile 不能直接畫在 WebView 裡**（2026-10-26，PR #14＋#15，決策 D-12）：Cloudflare 只接受 http／https 來源，iOS 的 `capacitor://` 一律拿到無效 token（真機「驗證失敗」），所以 widget 改畫在正式站的靜態頁 `public/captcha-frame.html`（https 來源；`public/captcha.js` 用 postMessage 回報事件與高度，**只送給 `capacitor://nightzhe.github.io` 這個 parent 來源**，別的網站嵌入拿不到 token），`useTurnstile` 只在原生 iOS 切成 iframe 模式、只收 `https://nightzhe.github.io` 來源的訊息；網頁與 Android 原路不變。真機 iPhone 13 Pro Max 已驗登入面板與 `://review-login` 都通過。本機 dev server 的 hostname 不在 Turnstile 允許清單（110200），模擬器要驗管線用 Cloudflare 測試 key＋`VITE_TURNSTILE_FRAME_URL`；備案（系統瀏覽器視圖＋scheme 回跳）在 commit 63f889d。
審查備註草稿 `.work/app-shell/review-notes.md`。
**TestFlight build 1 已上傳**（2026-10-26 01:25，PR #13：橘底白購物袋 icon／白底啟動畫面，來源 `assets/`，重產指令見該 PR；Info.plist `ITSAppUsesNonExemptEncryption=false`）。
**TestFlight build 2 已上傳**（2026-10-26 03:59，main `55622d1`，含 PR #15 App 內 Turnstile iframe、#16 原生 SIWA／分享／觸覺／狀態列、#17 安全區；ASC 自動配號；上傳指令被 agent 環境的分類器擋，由使用者在自己終端機跑 `-exportArchive`）。待真機 TestFlight 驗：登入面板簡訊登入、Apple 實登、分享到 LINE、震動。
**TestFlight build 5 已上傳**（2026-10-29 00:28，封存自 PR #22 分支 `fix/keep-signed-in-secure-store-thenable` 5ac7203＝main 67fbfe3＋thenable 修正；使用者在自己終端機跑 `-exportArchive`，ASC 自動配號 5；上傳前已驗：網頁資源只內嵌正式站網域與 Turnstile 正式 sitekey、無本機位址、載入函式已包成普通物件）。**小q 真機驗 AC-8～AC-14 用 build 5**；AC-9 先用 build 2 登入再升級到 5。
**TestFlight build 4 壞掉、不可用**（2026-10-29 使用者真機回報「連商品都出不來」，模擬器重現：首頁永遠骨架。根因：`src/lib/native/sessionStore.ts` 的載入函式直接 `return SecureStorage`，Capacitor 外掛物件是 Proxy、任何屬性名（含 `then`）都回原生方法包裝，async 函式 resolve 時把它當 thenable 呼叫 `then` → 永遠 pending → supabase-js 第一次讀 session 卡住、所有請求跟著卡。修正：包成只有 getItem／setItem／removeItem 的普通物件，`src/lib/native/sessionStore.test.ts` 用 thenable Proxy 鎖住；模擬器驗過商品正常、有 `SecureStorage internalGetItem` 原生呼叫。**教訓：任何 Capacitor 外掛物件都不要當 Promise 的 resolve 值或 await 它本身。**）
**TestFlight build 4 已上傳**（2026-10-28 23:43，封存自 PR #20 分支 `claude/keep-signed-in-t1-77e8b9` 52697d7＝main f6b49dc＋keep-signed-in **T1**，**PR 尚未合併**；worktree 內 `npm run build && npx cap sync` → `xcodebuild archive` → 使用者在自己終端機跑 `-exportArchive`，ASC 自動配號 4；上傳前已拆開驗：網頁資源只內嵌正式站 `hvecvwzpummmlsakxqbw.supabase.co`、Turnstile 正式 sitekey、無 `127.0.0.1`，原生含 SecureStoragePlugin）。**build 3（23:06）不可用**：從主 checkout `.work/app-shell/build3/` 封存，不含 T1，且網頁資源內嵌 `127.0.0.1:54321`、沒有 Turnstile 正式 sitekey——主 checkout 同時有 `.env`（正式）與 `.env.local`（本機 Supabase），Vite 以 `.env.local` 為準；真機別拿它驗收。T1 內容：`.work/keep-signed-in/`（決策 `decisions.md` D1～D14、規格 `spec.md` v0.2）。supabase-js 的 `auth.storage` 在 App 內換成轉接器 `src/lib/auth/sessionStore.ts`（安全儲存＝`@aparajita/capacitor-secure-storage` 8.0.1 走 iOS Keychain／Android KeyStore、備援＝WebView localStorage、舊 session 第一次讀自動搬移、外掛失效降級回 localStorage），網頁版設定不變（`src/lib/auth/clientOptions.ts` 有測試鎖住）。待小q 真機驗 AC-8～AC-14（PR #20 描述有清單；AC-9 要先用舊 build 登入再升級才驗得到搬移）。封存注意：worktree 要有正式站 `.env`、**不能留指向本機的 `.env.local`**（Vite 會蓋過 `.env`；這次差點把接本機 Supabase 的 build 上傳）；worktree 用 symlink node_modules 時 `cap sync` 會把 Package.swift／settings.gradle 的相對路徑解析到 worktree 外，要改回 `../../../node_modules`／`../node_modules`。
封存／上傳流程：worktree 切最新 main → `npm run build && npx cap sync` → `xcodebuild archive`（Release、Team F7WL42HXND、`-allowProvisioningUpdates`）→ `-exportArchive`（method app-store-connect、destination upload、`manageAppVersionAndBuildNumber=true`）。
Xcode 的 Apple ID 階段過期時上傳會回 DVTPortalServiceErrorDomain 1100，使用者在 Xcode Settings → Apple Accounts 重新登入即可。夥伴測試由使用者在 App Store Connect 加內部測試者。
**原生整合第一批**（2026-10-26，分支 `claude/app-native-batch1`，`decisions.md` 末節「2026-10-26 原生整合第一批」）：iOS 的 Apple 登入改走原生 Sign in with Apple（`@capacitor-community/apple-sign-in` 7.1.0 → `signInWithIdToken`，`src/lib/native/auth.ts`／`appleSignIn.ts`；Xcode 專案加 `App.entitlements`；Google 與 Android 仍走瀏覽器視圖）、
商品頁＋店家頁分享鈕在 App 內走 `@capacitor/share`（分享正式站網址，`src/lib/share/publicUrl.ts`）、觸覺回饋 `@capacitor/haptics`（加入購物車／快改儲存成功、下單失敗）、狀態列深色文字 `@capacitor/status-bar`（`capacitor.config.ts` `style:'LIGHT'`）。外掛只在 App 內動態載入。
**尚未上架**，第一版還要做（見 `decisions.md` D-7～D-11）：原生 Sign in with Apple 真機實登（程式已在上述分支）、App icon／啟動畫面（PR #13 已做）、
**帳號刪除 App 內入口（Apple 5.1.1(v) 硬門檻，10/18 拿掉的區塊要加回，可人工處理但不能只叫人寄信）**、檢舉／封鎖（Apple 1.2，待拍板）、審查用賣家示範帳號（待拍板）、App Privacy／Data safety 填寫。
使用者側前置（Google Play 帳號、App ID、Play 簽章、商店圖文）見 `prereqs-user.md`。

**聊聊（買家↔店家一對一訊息）**（`.work/chat/`，PR #23 分支 `feat/chat`，2026-10-29 開 PR；**正式站尚未套 migration、PR 尚未 merge**）：
買家從商品頁／店家頁「聊聊」、我的訂單「聯絡賣家」進入；賣家只從賣家中心訂單卡片「聯絡買家」發起。文字（≤1000 字）＋商品卡／訂單卡（快照）＋相簿圖片（一則 ≤5 張、壓縮後 ≤5MB、私有 bucket `chat-images`、簽名網址只給雙方）；
Supabase Realtime **Broadcast from Database** 私有頻道 `conversation:<id>`／`user:<uid>` 只推事件，表零直接權限、11 支 RPC（`chat_*`）、錯誤碼走 hint；每分鐘 20 則；對話與訊息不隨刪帳號／刪店 cascade（對方顯示「已刪除的帳號」／「已關閉的賣場」）。
買家 tab 第 4 格「我要賣」換成「聊聊」（入口改為「我的」頁既有「賣家中心」列）；賣家底欄改五格「總覽／聊聊／商品／新增／訂單」（評價管理退出底欄，從總覽與桌機側欄進）；總覽「你有 N 則未讀訊息」卡。
伺服器端雙向封鎖（被封鎖方只看到「無法傳送」、拿不到封鎖狀態）、買家隱藏對話；**不做**檢舉、站外聯絡方式過濾、推播、Email、已讀回條、回覆率、相機（使用者決策 D20／D27，Apple 1.2 風險已知）。新前端對未升級資料庫降級（聊聊頁「暫時無法使用」、入口鈕隱藏）。
新增 `@capacitor/camera`（App 內相簿選擇器、`NSPhotoLibraryUsageDescription`），`ios/`／`android/` 有變更，下一個 TestFlight build 才帶入。隱私政策新增「7. 聊聊」、第 5 節補句、生效日常數 `PRIVACY_EFFECTIVE` 寫死 2026/10/29（**merge 當天若不是這天要先改**）。
規格 `spec.md` v0.4、決策 `decisions.md` D1～D30＋N1～N3、介面 `interface-chat.md`、設計 `design-chat.md`、隔離實例整合測試 `t-local-tests.*`（345 PASS）、小q `qa-report.md`（47 項 43 PASS、擋上線 0）、`prod-runbook.md`（30 步＋回滾，第 13 節 10 項要使用者在後台確認）、`tools/metrics/ch-m1～m3.sql`＋`ops-check.sql`。
上線順序：使用者看 runbook 前置檢查（正式站 `realtime.messages`／`storage.objects` 既有 policy、探針）→ 套 `20261028231648_chat.sql` → verify → merge PR（部署前端）→ 下一個 TestFlight。
已知待辦：刪帳號／刪店工具不認綠界 migration 的外鍵（既有，與聊聊無關，另開工單，要在有人送刪帳號申請前修好）；遊客登入回來自動進對話（AC-M1）本機無法驗，待真機；真機 VoiceOver／兩支真機對聊待使用者。

下一個該做的：付款上線收尾（金流商＝綠界；等綠界平台商資格與金鑰 → `prod-runbook-pb.md` §5 secrets → §6 部署函式與排程 → 實刷）。

維運提醒：
- **Apple 登入 client secret 2027-04-15 到期**，2027-04-01 前用 Supabase 文件頁工具＋原 `.p8` 重做並更新後台。
- 刪帳號走人工流程：工具改為 `.work/phone-otp-auth/tools/account-tool-phone.mjs`（用法 `runbook-account-tool-notes.md`；取代 `buyer-auth` 舊工具，原因是外鍵集合變了）；有開店的帳號工具會擋，另外處理。
- 寄信用 Gmail SMTP（寄件人「好物集」），目前沒有任何流程會寄信；Confirm email 使用者決定**不開**（理由與風險評估在 `.work/buyer-auth/decisions.md`，本檔進公開 repo，不展開）。
- 正式站 Storage 刪檔需要 service role key：由使用者在自己終端機以 `read -rs` 輸入後跑 `tools/delete-review-paths.mjs`，不經過 agent。
- 手機登入上線後：Supabase **Confirm phone 不得關閉**（關了簡訊額度不生效、門號可被改綁到他人帳號）；緊急止血要同時關 Phone provider **並**把 Rate Limits 的 SMS 每小時調低（只關 provider 止不住綁手機那條路）。MAAC Go 餘額（函式 log 的 `balance_cents`，低於 `SMS_LOW_BALANCE_CENTS` 預設 NT$10 會記 `maacgo_low_balance`）與 Cloudflare Turnstile 統計每週看；Turnstile Secret 與 MAAC Go key 只在後台，不進 repo。刪帳號改用 `.work/phone-otp-auth/tools/account-tool-phone.mjs`（認得 phone 身分），`buyer-auth` 舊工具作廢。
- 正式站 runbook 的指令用函式 `Q()` 包 `npx supabase db query --linked`；舊 `buyer-auth/prod-runbook.md` 的字串變數寫法在 zsh 會 command not found。

已知小問題（不急）：160px 寬（320 寬機型開 200% 字）物流設定頁與既有 `AddressFields` 的 `min-w-40` 讓主內容橫向溢出 28px（188px 正常）；物流設定頁回到前景的靜默重讀在離線時也會發請求；退貨資訊的 iPhone 實機（VoiceOver、200%、複製、離線）待使用者；下單成功路徑小計仍是 integer，單張訂單超過 21 億元會 `integer out of range`（舊函式也一樣，不會建錯單）；失敗畫面 VoiceOver 實聽未驗（無障礙樹已對）；登入方式設定讀取超過 5 秒會先顯示兩顆按鈕；平板寬度賣家首頁與商品頁有橫向捲軸；
購物車兩次更新間隔 3 秒內讀屏可能不重念；賣家中心頂欄在 188px 寬（手機 200%）橫向溢出，快改面板的關閉鈕會被擠出；
快改與帳號頁地址簿的 iPhone Safari／LINE 實機驗收待使用者；離線按登出時「登出失敗」訊息與實際已登出矛盾（既有）；「我的訂單」不顯示收件地址（既有）；隱私頁與結帳底欄在 188px 寬有幾 px 橫向溢出（既有）。
