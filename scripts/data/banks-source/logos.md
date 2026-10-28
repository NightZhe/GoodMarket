# 常用銀行 logo 的來源紀錄（spec v0.2 §6.4；decisions Q25／N8）

2026-10-29，小u 取得。logo 是各銀行的商標；使用者決定（Q25）直接用，**未取得授權**。
風險：App 版送審屬 App Store Review Guidelines §5.2.1 範圍（R15）。被要求下架或被退件時，頁 B 與列表要能只靠設定退回純文字（AC-48）。
檔案在 `public/bank-logos/<代碼>.<副檔名>`。全部只縮放／裁切，**沒有改色**。下載一律來自銀行自家網域，沒用第三方網站的圖。

## 取得結果

| 銀行代碼 | 銀行名稱 | 來源網址（檔案本身） | 來源頁面 | 取得日期 | 取得人 | 檔名與格式 | 檔案雜湊（SHA-256） | 有無修改 | 授權狀態 |
|----------|----------|----------------------|----------|----------|--------|------------|----------------------|----------|----------|
| 822 | 中國信託商業銀行 | https://www.ctbcbank.com/content/dam/twrbo/images/touch/apple-touch-icon-180x180.png | https://www.ctbcbank.com/twrbo/zh_tw/index.html（官網首頁 `<link rel="apple-touch-icon">`） | 2026-10-29 | 小u | `822.png`，PNG，180×180（RGBA） | `72bf5f5afdb3324d6fa7b375fb2a2d460b468c4496d7da84eb6a7f464cfe73c0` | 原檔，未修改 | 未取得授權（Q25 使用者決定直接用） |
| 013 | 國泰世華商業銀行 | https://www.cathay-cube.com.tw/content/dam/cub-aem-cs/Image/Common/cub-icons/logo.svg | https://www.cathaybk.com.tw/cathaybk/（導向 cathay-cube.com.tw 官網首頁，頁首 logo） | 2026-10-29 | 小u | `013.svg`，SVG，54×39（viewBox） | `0c677c01d786dbddfb5dcd4c498f7992e23ced70da5d2f8e3f33594e7c5b7f16` | **裁切**：原檔是「樹形標誌＋中英文字」橫式 212×39，只改 `width`／`viewBox` 為 54×39 只留樹形；路徑與顏色一字未動 | 未取得授權（Q25 使用者決定直接用） |
| 808 | 玉山商業銀行 | https://www.esunbank.com/zh-tw/-/media/New-ESUNBANK/icon/apple-touch-icon/esun-icon.png | https://www.esunbank.com/zh-tw/personal（官網首頁 `<link rel="apple-touch-icon">`） | 2026-10-29 | 小u | `808.png`，PNG，180×180（RGB） | `82ca7a21ed1865fe2f42123278ae409eeaa1cd381535a0d598c9a2d82067d8e3` | 原檔，未修改 | 未取得授權（Q25 使用者決定直接用） |
| 012 | 台北富邦商業銀行 | https://www.fubon.com/banking/common_content/images/favicon.ico | https://www.fubon.com/banking/personal（官網首頁 `<link rel="icon">`） | 2026-10-29 | 小u | `012.png`，PNG，64×64 | `836a0356a41b3cbf83983ddbb011f583dbd7e1de731dfc4923fd303fe67d31b7` | **格式轉換**：ICO 的 64×64 影格轉成 PNG，像素未動。**解析度偏低**（顯示在 40pt 的格子 3x 螢幕會略糊）；官網沒找到更大的單獨標誌檔，只有橫式 420×65 的 `logo.png`（含字） | 未取得授權（Q25 使用者決定直接用） |
| 700 | 中華郵政股份有限公司 | https://www.post.gov.tw/post/internet/Group/images/Logo.jpg | https://www.post.gov.tw/post/internet/Group/default.jsp（官網首頁頁首 logo） | 2026-10-29 | 小u | `700.png`，PNG，54×48 | `9a3950d7e33f7ac778c580c0a74b80d22463721c97919d7aff921d64c55d4ecb` | **裁切**：原檔是「郵字圓標＋文字」橫式 JPG 242×66，取左上 54×48 只留圓標（JPG 轉 PNG，像素未動）。**解析度低**，且圓標下緣仍帶一點原檔的倒影殘影；官網 favicon 只有 20×20，更小 | 未取得授權（Q25 使用者決定直接用） |
| 017 | 兆豐國際商業銀行 | https://www.megabank.com.tw/themes/project/cms/media/assets/touch/icon-192x192.png | https://www.megabank.com.tw/personal（官網首頁 `<link rel="apple-touch-icon">`） | 2026-10-29 | 小u | `017.png`，PNG，192×192（RGBA） | `5cf1563626241b342d420c24bc9d9cba6fe87d50df69e913d31c8d292cee153e` | 原檔，未修改 | 未取得授權（Q25 使用者決定直接用） |

## 給使用者審的幾件事
1. **6 家都拿到了**，但品質不一：822、808、017 是官網自己的 180／192 圖示（最好）；013 是向量（無限放大）；012 偏糊；700 最糊。
2. 圖示 vs 完整橫式 logo：蝦皮截圖用的是只有標誌的圓形小圖，所以全部取「標誌」。013、700 是從橫式 logo 裁出標誌，不是銀行提供的單獨標誌檔。
3. 822 的官網圖示是「We are family」紅色圓標（與蝦皮截圖相同）；808、017 的圖示底是圓形外加白或透明邊角，顯示時不要再加色底。
4. 如果使用者願意向銀行或其品牌部門要正式的標誌檔（SVG），012、700 最值得換。
