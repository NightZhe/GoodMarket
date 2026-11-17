# Android（Google Play）上架：Play Console 要填的東西

從程式碼整理出來的答案（2026-11-17，Android 殼第三批讀碼）。Play 政策條文在那次 session 的網路限制下沒能直接讀官方頁，
標「待核對」的請在填表時對照 Play Console 當下的說明；程式碼事實（路由、資料表、權限）都查過。
不含任何帳密與店家資料；審查用示範帳號的帳密只放 Play Console 的審查備註。

## 兩個網址

| 用途 | 網址 | 狀態 |
|------|------|------|
| 隱私政策 | `https://nightzhe.github.io/GoodMarket/#/privacy` | 已上線（`src/pages/buyer/Privacy.tsx`，有付款／平台收款開關時多幾段） |
| 刪除帳號（Data safety 的 account deletion URL） | `https://nightzhe.github.io/GoodMarket/#/account/delete` | 已上線；登出狀態會顯示說明＋「登入後申請」，Play 允許刪除頁要登入（待核對） |
| 審查員登入入口（App access 用） | `https://nightzhe.github.io/GoodMarket/review-login.html` | 本分支新增（`public/review-login.html`）：Android 用 intent:// 連結、iOS 用 scheme 連結、另附 adb 指令 |

兩個 hash 路由都是 JS 渲染（靜態 HTML 只有空殼）。審查員用瀏覽器看沒問題；若 Play 自動檢查說連結無效，再補 `public/privacy.html`／`delete-account.html` 做靜態轉址。
上傳前請用無痕視窗開一次刪帳號網址，確認看得到「登入後申請」。

## App access（功能受限的登入方式）

選「全部或部分功能需要登入」，提供：
1. 示範賣家帳號（Email＋密碼，由 `scripts/seed-review-account.mts` 建；帳密不進 repo）。
2. 怎麼到登入頁：在裝置上先裝好 App，用 Chrome 開 `https://nightzhe.github.io/GoodMarket/review-login.html` 點「打開 App 的審查員登入頁」；
   或 `adb shell am start -a android.intent.action.VIEW -d io.github.nightzhe.goodmarket://review-login io.github.nightzhe.goodmarket`。
   App 內沒有任何連結能到這一頁（`#/review-login`）。
3. 一般買家功能也可以用審查員自己的 Google 帳號登入。
4. 審查員登入頁同樣要過 Cloudflare Turnstile：模擬器曾回 600010（疑似機器人）。**先在真機驗過**；若模擬器仍過不了，備註請審查員用實體裝置，或審查期間暫時把這把 sitekey 的模式放寬（Cloudflare 後台，使用者決定）。

## Data safety

WebView 載的是我們自己的網頁，網頁送出去的資料在 Play 的定義下都算「App 收集」。從程式碼整理：

| 類別 | 項目 | 收集 | 分享 | 必要／選填 | 用途 |
|------|------|------|------|-----------|------|
| 個人資料 | 姓名（收件人、Google 顯示名）、Email（Google／Apple 登入）、使用者 ID、地址（地址簿與訂單）、電話（簡訊登入、收件人）、其他（顯示名稱） | 是 | 否（處理者） | 登入與下單必要；顯示名稱選填 | App 功能、帳號管理 |
| 財務資料 | 使用者付款資料（卡號在 App 內的綠界站內付欄位輸入、送綠界；本站只存末四碼等）、購買紀錄（訂單）、其他財務資料（賣家銀行帳號，加密存放） | 是 | 綠界是支付處理者：是否算「分享」看 Play 的服務供應商例外（待核對） | 綁卡與銀行帳號選填 | App 功能 |
| 照片 | 評價照片（公開）、聊聊照片（私有）、商品圖 | 是 | 否 | 選填 | App 功能 |
| 訊息 | 聊聊訊息（文字＋照片） | 是 | 否 | 選填 | App 功能 |
| App 活動 | 其他使用者產生內容（評價、商品、賣場、檢舉）、其他動作（伺服器端購物車） | 是 | 否 | — | App 功能 |
| 裝置或其他 ID | Cloudflare Turnstile 收 IP／瀏覽器特徵做防機器人 | 二選一：不另填（服務供應商、僅安全用途）或填「裝置或其他 ID／防詐欺與安全」（待核對） | 否 | — | 防詐欺、安全 |

不收集：位置（商品的「所在地」是賣家手打文字，沒有定位權限）、聯絡人、行事曆、健康、音訊、檔案、瀏覽紀錄、已安裝 App、廣告 ID（manifest 沒有 AD_ID，沒有廣告／分析 SDK）。
安全：傳輸全程 https＝是；提供刪除要求機制＝是（上面的網址）；帳號刪除後保留部分資料＝是（訂單依法規期間、刪除申請紀錄、去識別化的檢舉紀錄——隱私政策第 5 節已寫）。
第三方處理者：Supabase（資料庫／登入／儲存）、Google／Apple（登入）、MAAC Go／三竹（簡訊，伺服器端）、Cloudflare Turnstile、綠界（付款）。付款開關在正式站是開的，綠界相關項目要填（即使函式尚未部署）。

## 其他 App content 宣告

- **廣告**：沒有廣告、不使用廣告 ID。
- **內容分級（IARC）**：有使用者產生內容且他人看得到（商品、評價含照片、賣場），有檢舉與人工處理；有使用者間即時訊息（聊聊）；以真實貨幣購買實體商品（綠界，不是 Play 結帳、沒有數位商品）；不分享位置；沒有成人／暴力／賭博內容。
- **目標對象**：18+（能開店、綁卡、綁銀行帳號；選未滿 18 會拉進家庭政策）。
- **金融功能**：購物結帳一般選「沒有金融功能」，但本站是**平台代收再撥款給賣家**（`.work/platform-collect/` spec §9 P-1 律師意見未完成）——律師說不是支付服務才選「沒有」，否則依類別附文件。使用者決定。
- **政府／健康／新聞 App**：否。
- **權限宣告**：merged manifest 只有 INTERNET、ACCESS_NETWORK_STATE、VIBRATE；沒有 CAMERA／READ_MEDIA_*（相簿用系統 Photo Picker），不觸發照片影片權限宣告。日後若加相機拍照要加 CAMERA 並更新 Data safety。

## 刪帳號能力要跟宣告一致

申請送出只是寫一筆 `account_deletion_requests`，執行是人工（`.work/phone-otp-auth/tools/account-tool-phone.mjs`）。STATUS 記錄該工具**不認綠界 migration 的外鍵**、銀行帳號白名單的 SQL 未演練，
而隱私政策承諾「刪帳號時先請綠界刪卡」、文案承諾完成會寄信（目前沒有流程寄信）。上架前要：(1) 修工具認 `payment_methods`／`payment_auths`／`bank_accounts` 外鍵並在本機重置的資料庫演練；
(2) 決定完成通知是人工寄信（寫進 runbook）還是把 `src/lib/deletion/copy.ts` 那句拿掉；(3) 7 個工作天的 SLA 寫進 runbook。

## 第一次上傳前的檢查

1. Play 帳號類型與建立日期（個人帳號 2023-11-13 後建立：12 位測試者連續 14 天封閉測試才能申請正式發布；內部測試軌可立即給團隊用）。
2. 上傳金鑰在 Mac 產好、離線備份；建 App 時選 Google 產生的 App signing key。**不要上傳容器裡用拋棄式金鑰簽的任何 AAB**（第一次上傳的簽章會變成註冊的上傳金鑰）。
3. 從 main 的乾淨 worktree 跑 `scripts/archive-android.sh`（或 CI release artifact），確認輸出的 `source-commit.txt` 是 main、`gradle.log` 乾淨、`aapt2 dump badging` 的 versionCode 大於 Play 上一次。
4. 把 versionCode、時間、來源 commit 記進 `docs/STATUS.md`。
5. 商店圖文：512×512 icon（從 `assets/icon-only.png` 縮，RGB 無透明）、1024×500 feature graphic、≥2 張手機截圖（從 debug APK 截）。
