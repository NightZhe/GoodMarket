# 好物集 GoodMarket

人人都能開店的購物平台（C2C / B2C 混合市集）。買家在前台逛商品、下單；賣家在「賣家中心」自己開店、上架商品、處理訂單。

**線上示範：** https://nightzhe.github.io/GoodMarket/

資料存在 **Supabase**：賣家登入後上架的商品，**全站買家都看得到**。
除了網頁，還有同一套程式碼包成的 iOS／Android App 殼（Capacitor，見下方「App 殼」）。

## 功能

### 帳號與權限

| 角色 | 要不要帳號 | 能做什麼 |
|------|-----------|---------|
| 遊客 | 不用 | 逛、搜尋、看商品與賣場 |
| 買家 | 要（Google／Apple／台灣手機號碼＋簡訊驗證碼） | 加購物車、下單、查訂單、評價、聊聊、地址簿、刪除帳號申請 |
| 賣家 | 同一個帳號 | 開一家店 → 上架商品、改價改庫存、上下架、處理訂單、物流設定、銀行帳號、Shopee 匯入 |

權限規則寫在資料庫層（Row Level Security 與資料庫函式，來源真相是 `supabase/migrations/`），不是靠前端隱藏按鈕：
商品與商店任何人可讀、只有店主能改；**訂單含收件人個資，只有買家本人與該店店主讀得到**。
下單走資料庫函式，在同一個交易裡比對結帳頁顯示的價格與運費、檢查並扣庫存，避免兩個人同時買到最後一件。

### 買家前台（`/#/`）

| 頁面 | 路由 | 說明 |
|------|------|------|
| 首頁 | `/` | 主視覺、分類、限時特賣（倒數）、每日新發現 |
| 搜尋 / 分類 | `/search?q=&cat=&sort=` | 關鍵字、分類、免運篩選；綜合／最新／熱銷／價格排序 |
| 商品頁 | `/product/:id` | 多圖、規格選擇、庫存、加入購物車／直接購買（手機為底部抽屜） |
| 賣場 | `/shop/:id` | 商店資訊與全部商品 |
| 購物車 | `/cart` | 依商店分組、勾選結帳、改數量；`lg` 以上為右側訂單摘要卡，以下為底部固定列 |
| 結帳 | `/checkout` | 收件資訊驗證、付款方式、**依商店拆單**、同店滿 $499 免運 |
| 我的訂單 | `/orders` | 狀態分頁、取消／完成訂單、聯絡賣家 |
| 聊聊 | `/chat` | 買家與店家一對一訊息（文字、商品卡／訂單卡、相簿照片） |
| 我的 | `/account` | 個人檔案、地址簿、銀行帳號／信用卡、綁手機、刪除帳號、隱私政策 |

### 賣家中心（`/#/seller`）

| 頁面 | 路由 | 說明 |
|------|------|------|
| 登入 / 開店 | `/seller` | 用買家同一個帳號登入 → 建立自己的商店 |
| 賣場總覽 | `/seller` | 待辦、營收、近 7 天營收圖、熱銷商品、庫存提醒 |
| 我的商品 | `/seller/products` | 分頁（架上／售完／下架）、搜尋、上下架、刪除 |
| 新增 / 編輯商品 | `/seller/products/new`、`/:id/edit` | 上傳照片（瀏覽器端壓縮）或貼網址、多規格價格庫存、原價、免運 |
| 訂單管理 | `/seller/orders` | 安排出貨、取消訂單、聯絡買家 |
| 物流設定 | `/seller/logistics` | 退貨門市與退貨地址 |
| 匯入 | `/seller/import` | 從 Shopee 匯出的 xlsx 批次建商品 |

## 設計系統

設計檔：[Figma — GoodShop](https://www.figma.com/design/mZQGGpGnwijMNRP2rkYr2S/GoodShop)

`src/index.css` 的 `@theme` token 與 Figma 的 Variables 一一對應，名稱相同：

| 類別 | token | 用途 |
|------|-------|------|
| brand | `brand` / `brand-dark` / `brand-soft` | 主色、hover、淺底 |
| 文字與表面 | `ink` / `muted` / `disabled` / `line` / `canvas` / `subtle` | 文字階層、分隔線、底色 |
| success | `success` / `success-soft` / `success-text` | 免運、已完成 |
| warning | `warning` / `warning-bg` / `warning-border` / `warning-text` | 折扣角標、庫存提醒 |
| error | `error` / `error-bg` / `error-border` / `error-text` | 表單錯誤、售完、刪除 |
| info | `info` / `info-bg` / `info-text` | 運送中 |
| 陰影 | `shadow-card-hover` / `shadow-sheet` / `shadow-popover` / `shadow-bar-top` | 卡片浮起、抽屜、對話框、固定底欄 |

改色請兩邊一起改，不要在元件裡直接寫色碼或 Tailwind 原色（`text-red-500` 這類）。

## 技術棧

架構參考 [CarSocialMedia](https://github.com/NightZhe/CarSocialMedia)（前台 / 商家後台分離），升級為：

- React 19 + TypeScript + Vite
- Supabase（Postgres + Auth + Storage），權限靠 Row Level Security
- react-router（`HashRouter`：GitHub Pages 沒有 SPA fallback）
- Tailwind CSS v4（建置期編譯，不用 CDN）
- lucide-react 圖示
- GitHub Pages（推 `main` 由 GitHub Actions 自動建置部署）
- Capacitor 8：同一份 `dist/` 包進 `ios/`、`android/` 原生殼（原生外掛只在 App 內動態載入，網頁 bundle 不帶）

## 專案結構

```
src/
├── App.tsx                  # 路由：買家前台 / 賣家中心
├── types.ts                 # 領域模型（Product、Variant、Shop、Order…）＝未來 API 契約起點
├── data/seed.ts             # 分類、4 家示範商店、24 件示範商品
├── store/StoreContext.tsx   # 資料層：所有讀寫集中在這裡（換後端時只改這支）
├── lib/format.ts            # 金額、日期格式
├── components/              # ProductCard、ProductImage、QtyStepper、Toast…
└── pages/
    ├── buyer/               # BuyerLayout、Home、Search、ProductDetail、Cart、Checkout、Orders、ShopPage
    └── seller/              # SellerGate、SellerLayout、SellerDashboard、SellerProducts、ProductForm、SellerOrders
```

## 本機開發

```bash
npm install
cp .env.example .env   # 填入 Supabase 的 URL 與 anon key
npm run dev            # http://localhost:5173
npm run build          # 型別檢查 + 打包到 dist/
```

資料庫：來源真相是 `supabase/migrations/`（基準檔＋之後每次異動一個檔）。本機開發用 Docker ＋ `npx supabase start`，
`.env.local` 指向 `http://127.0.0.1:54321`；`npx supabase db reset --local` 會重建並載入 `supabase/seed.sql`（由 `scripts/gen-seed-sql.mts` 產生，請勿手改）。
`supabase/schema.sql` 已落後正式站，不要拿它重建。

部署用的金鑰放在 GitHub repo 的 Secrets（`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`），
由 Actions 在建置時帶入。anon key 可公開，資料安全靠 RLS。

部署：**推到 `main` 分支就會自動部署**（`.github/workflows/deploy.yml`，GitHub Actions 建置後發佈到 GitHub Pages）。
不需要手動跑任何部署指令；部署狀態看 repo 的 Actions 分頁。

## App 殼（iOS／Android）

同一份網頁包成 App（Capacitor 8，bundle id／application id `io.github.nightzhe.goodmarket`）。App 內的網頁資源是封存當下打包進去的，
不會跟著網頁自動更新；網頁與 App 的落差怎麼查、各版 build 的來源 commit 都記在 `docs/STATUS.md`。

- **iOS**：`scripts/archive-ios.sh`（要 Mac 與 Xcode；`--upload` 直接送 TestFlight）。
- **Android**：`scripts/archive-android.sh`（macOS／Linux，要 JDK 21 與 Android SDK，不需要 Android Studio；預設出簽章的 AAB＋APK，`--debug` 出測試用 APK）。
  CI（`.github/workflows/android.yml`）每個 PR 都會建 debug APK 當 artifact，沒有本機 SDK 也拿得到可裝的 APK；上傳金鑰與密碼只在本機與 repo secrets，絕不進版控。
  Play Console 要填的宣告整理在 `docs/android-play-console.md`。

兩個腳本都會擋 `.env.local`、檢查 bundle 只內嵌正式站網域與 Turnstile sitekey（曾經把接本機資料庫的 build 送上 TestFlight）。

## 下一步

- 線上付款上線前置（綠界平台商資格、secrets、函式部署、實刷）與撥款對帳
- 物流方式與運費、超商取貨 API
- 優惠券、平台管理後台（審核商品、抽成）
- App 上架（TestFlight 已到 build 6；Android 待第一次上傳 Play）
