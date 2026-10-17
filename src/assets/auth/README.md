# 登入按鈕的官方品牌素材

## Google
- 來源：Google「Sign in with Google Branding Guidelines」（https://developers.google.com/identity/branding-guidelines）頁面中的素材包 https://developers.google.com/static/identity/images/signin-assets.zip
- 下載日期：2026-10-17（使用者在對話中同意下載，D22）
- 使用的檔案（原檔，沒有修改）：
  - `google-light-square.svg`：取自 `Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg`
- 這個檔案是 40×40 的按鈕，G 標誌位在 (10,10)～(30,30)。只取出 G 本身（用 overflow 裁切，不改動圖形），G 是 20px，排版照官方 web 規格：G 左側 12px、G 右側 10px、文字右側 12px。
- SVG 已經檢查過：沒有 script、事件屬性或外部連結。檔案裡有一個 `<foreignObject>`（Figma 匯出的漸層）；用 `<img>` 載入，已用 Playwright 的 WebKit 與 Chromium 實測渲染正確。
- 2026-10-18：已刪除原本一併下載、但沒有使用的 `google-light-square@4x.png`。

## Apple
- 官方素材包（https://devimages-cdn.apple.com/design/resources/download/Logo-Sign-in-with-Apple.dmg）裡附有軟體授權協議，必須先接受才能打開。agent 不能替使用者接受條款，所以要由使用者自己下載。

## Apple（2026-10-18 更新）
- 來源：Apple Design Resources「Sign in with Apple Logo」素材包 https://devimages-cdn.apple.com/design/resources/download/Logo-Sign-in-with-Apple.dmg
  使用者於 2026-10-18 下載並同意授權後打開，再由主對話從掛載磁碟複製。原檔與授權全文在 `.work/buyer-auth/apple-assets/`（不進版控）。
- 檔案（原檔，沒有修改）：
  - `apple-left-black-medium.svg`：viewBox 0 0 31 44，用於「標誌＋文字」的按鈕，標誌檔高度要等於按鈕高度
- SVG 已掃描：沒有 script、事件屬性、外部連結或 foreignObject。
- HIG 規則（developer.apple.com/design/human-interface-guidelines/sign-in-with-apple）：不得裁切、不得加垂直 padding、標誌高度＝按鈕高度；標題只能是官方三種；標誌與文字同為黑或白；不得自行繪製 Apple 標誌。
- 授權注意：素材包附的 Apple Design Resources License 字面上限制為「Apple 平台軟體的 mock-up」，但 HIG 明文要求自訂 Sign in with Apple 按鈕（含 web）只能用這份素材。採用依據是 HIG；法律解釋未查證。
- 2026-10-18：small 與 logo-only 兩個檔沒有被引用，已刪除，只保留 medium（減少受授權約束的素材進入公開 repo）。
