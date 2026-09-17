# 好物集 GoodMarket

人人都能開店的購物平台（C2C / B2C 混合市集）。買家在前台逛商品、下單；賣家在「賣家中心」自己開店、上架商品、處理訂單。

**線上示範：** https://nightzhe.github.io/GoodMarket/

> 目前是 **純前端示範版**：沒有後端，所有資料（商品、訂單、購物車、商店）都存在瀏覽器 `localStorage`，
> 每個人看到的是自己瀏覽器裡的資料。清除網站資料即可回到初始示範狀態。

## 功能

### 買家前台（`/#/`）

| 頁面 | 路由 | 說明 |
|------|------|------|
| 首頁 | `/` | 主視覺、分類、限時特賣（倒數）、每日新發現 |
| 搜尋 / 分類 | `/search?q=&cat=&sort=` | 關鍵字、分類、免運篩選；綜合／最新／熱銷／價格排序 |
| 商品頁 | `/product/:id` | 多圖、規格選擇、庫存、加入購物車／直接購買（手機為底部抽屜） |
| 賣場 | `/shop/:id` | 商店資訊與全部商品 |
| 購物車 | `/cart` | 依商店分組、勾選結帳、改數量 |
| 結帳 | `/checkout` | 收件資訊驗證、付款方式、**依商店拆單**、同店滿 $499 免運 |
| 我的訂單 | `/orders` | 狀態分頁、取消／完成訂單 |

### 賣家中心（`/#/seller`）

| 頁面 | 路由 | 說明 |
|------|------|------|
| 開店 / 登入 | `/seller` | 建立新商店，或選一家示範商店進入 |
| 賣場總覽 | `/seller` | 待辦、營收、近 7 天營收圖、熱銷商品、庫存提醒 |
| 我的商品 | `/seller/products` | 分頁（架上／售完／下架）、搜尋、上下架、刪除 |
| 新增 / 編輯商品 | `/seller/products/new`、`/:id/edit` | 上傳照片（瀏覽器端壓縮）或貼網址、多規格價格庫存、原價、免運 |
| 訂單管理 | `/seller/orders` | 安排出貨、取消訂單 |

## 技術棧

架構參考 [CarSocialMedia](https://github.com/NightZhe/CarSocialMedia)（前台 / 商家後台分離），升級為：

- React 19 + TypeScript + Vite
- react-router（`HashRouter`：GitHub Pages 沒有 SPA fallback）
- Tailwind CSS v4（建置期編譯，不用 CDN）
- lucide-react 圖示
- GitHub Pages（`npm run deploy` 把 dist 推到 `gh-pages` 分支）

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
npm run dev      # http://localhost:5173
npm run build    # 型別檢查 + 打包到 dist/
```

部署到 GitHub Pages：

```bash
npm run deploy
```

想改成「推 main 就自動部署」：先執行 `gh auth refresh -s workflow` 讓 token 有 workflow 權限，
再把 `scripts/deploy.github-actions.yml.example` 搬到 `.github/workflows/deploy.yml`，
並把 repo 的 Pages 來源改成 GitHub Actions。

## 下一步（接真後端時）

- 會員系統（買家 / 賣家帳號、登入）
- 後端 API + 資料庫：把 `StoreContext.tsx` 的 action 換成呼叫 API
- 圖片改存物件儲存（S3 / R2），不再塞 localStorage
- 金流（綠界 / 藍新）、物流（超商取貨）
- 商品評價、聊聊、優惠券、平台管理後台（審核商品、抽成）
