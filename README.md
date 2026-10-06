# 好物集 GoodMarket

人人都能開店的購物平台（C2C / B2C 混合市集）。買家在前台逛商品、下單；賣家在「賣家中心」自己開店、上架商品、處理訂單。

**線上示範：** https://nightzhe.github.io/GoodMarket/

資料存在 **Supabase**：賣家註冊登入後上架的商品，**全站買家都看得到**。
只有購物車與買家的訂單憑證留在瀏覽器（購物車本來就該跟著裝置，買家則刻意不需要帳號）。

## 功能

### 帳號與權限

| 角色 | 要不要帳號 | 能做什麼 |
|------|-----------|---------|
| 買家 | 不用 | 逛、搜尋、加購物車、下單；下單後憑瀏覽器裡的憑證查自己的訂單、取消或確認收貨 |
| 賣家 | 要（Email + 密碼） | 註冊 → 開一家店 → 上架商品、改價改庫存、上下架、處理自己店的訂單 |

權限規則寫在資料庫層（`supabase/schema.sql` 的 RLS），不是靠前端隱藏按鈕：
商品與商店任何人可讀、只有店主能改；**訂單含收件人個資，只有該店店主讀得到**，
買家則透過下單時取得的一次性 token 查自己那筆。下單走 `place_order()` 函式，
在同一個交易裡檢查並扣庫存，避免兩個人同時買到最後一件。

### 買家前台（`/#/`）

| 頁面 | 路由 | 說明 |
|------|------|------|
| 首頁 | `/` | 主視覺、分類、限時特賣（倒數）、每日新發現 |
| 搜尋 / 分類 | `/search?q=&cat=&sort=` | 關鍵字、分類、免運篩選；綜合／最新／熱銷／價格排序 |
| 商品頁 | `/product/:id` | 多圖、規格選擇、庫存、加入購物車／直接購買（手機為底部抽屜） |
| 賣場 | `/shop/:id` | 商店資訊與全部商品 |
| 購物車 | `/cart` | 依商店分組、勾選結帳、改數量；`lg` 以上為右側訂單摘要卡，以下為底部固定列 |
| 結帳 | `/checkout` | 收件資訊驗證、付款方式、**依商店拆單**、同店滿 $499 免運 |
| 我的訂單 | `/orders` | 狀態分頁、取消／完成訂單 |

### 賣家中心（`/#/seller`）

| 頁面 | 路由 | 說明 |
|------|------|------|
| 註冊 / 登入 / 開店 | `/seller` | Email 註冊（需收信啟用）→ 登入 → 建立自己的商店 |
| 賣場總覽 | `/seller` | 待辦、營收、近 7 天營收圖、熱銷商品、庫存提醒 |
| 我的商品 | `/seller/products` | 分頁（架上／售完／下架）、搜尋、上下架、刪除 |
| 新增 / 編輯商品 | `/seller/products/new`、`/:id/edit` | 上傳照片（瀏覽器端壓縮）或貼網址、多規格價格庫存、原價、免運 |
| 訂單管理 | `/seller/orders` | 安排出貨、取消訂單 |

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

第一次設定 Supabase：後台 SQL Editor 依序跑 `supabase/schema.sql`（資料表與權限）
與 `supabase/seed.sql`（示範商店與商品）。`seed.sql` 由 `src/data/seed.ts` 產生，請勿手改。

部署用的金鑰放在 GitHub repo 的 Secrets（`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`），
由 Actions 在建置時帶入。anon key 可公開，資料安全靠 RLS。

部署：**推到 `main` 分支就會自動部署**（`.github/workflows/deploy.yml`，GitHub Actions 建置後發佈到 GitHub Pages）。
不需要手動跑任何部署指令；部署狀態看 repo 的 Actions 分頁。

## 下一步

- 買家帳號（目前刻意不需要帳號，訂單綁在瀏覽器憑證上）
- 金流（綠界 / 藍新）、物流（超商取貨）
- 商品評價、聊聊、優惠券、平台管理後台（審核商品、抽成）
