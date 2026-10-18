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

## 目前狀態（2026-10-18 晚間更新，給新 session 的交接）

已上線：商品評價（含照片、賣家回覆）；買家已取貨自動完成＋訂單狀態鎖定；**買家帳號**（遊客只能瀏覽，
加購物車／下單／訂單／評價都要 Google 或 Apple 登入；購物車與訂單綁帳號；舊訂單憑證機制已移除）；
**商品表單上限**（售價／原價 499,999、庫存 999,999，`src/lib/products/variants.ts`）；帳號頁拿掉「刪除帳號」區塊（申請方式只在隱私政策頁）；
**我的商品列表快改**（點價格／庫存格就地改、多規格展開、手機底部面板；走資料庫函式 `quick_edit_product`：只寫被改的值、比對舊值回衝突、
庫存全 0 自動下架、留 `product_change_log` 異動紀錄；列表斷點改 1024；上下架改只寫 status）。
每個功能的決策、規格、驗收報告、上線紀錄都在 `.work/<功能>/`（不進版控）：
`product-reviews/`、`picked-up-complete/`、`buyer-auth/`、`list-quick-edit/`（含 `prod-runbook.md`、`prod-apply-log.md`、`tools/metrics/` 成功指標查詢）。
同日另有「帳號頁子選單＋地址簿」（`account-payment-methods/`）與「手機號碼登入」（`phone-otp-auth/`，分支 `phone-otp-auth`）兩條線由其他 session 進行。

下一個該做的：**結帳比價**（`.work/checkout-price-check/`，使用者已拍板流程：下單時伺服器比對買家看到的價格，不一致就不建單、顯示下單失敗並導回賣家商品頁）。
快改上線後改價會變多，這個缺口要盡快補。

維運提醒：
- **Apple 登入 client secret 2027-04-15 到期**，2027-04-01 前用 Supabase 文件頁工具＋原 `.p8` 重做並更新後台。
- 刪帳號走人工流程：`.work/buyer-auth/prod-runbook.md` 第 6 節的工具；有開店的帳號工具會擋，另外處理。
- 寄信用 Gmail SMTP（寄件人「好物集」），目前沒有任何流程會寄信；Confirm email 使用者決定**不開**（理由與風險評估在 `.work/buyer-auth/decisions.md`，本檔進公開 repo，不展開）。
- 正式站 Storage 刪檔需要 service role key：由使用者在自己終端機以 `read -rs` 輸入後跑 `tools/delete-review-paths.mjs`，不經過 agent。

已知小問題（不急）：登入方式設定讀取超過 5 秒會先顯示兩顆按鈕；平板寬度賣家首頁與商品頁有橫向捲軸；
購物車兩次更新間隔 3 秒內讀屏可能不重念；賣家中心頂欄在 188px 寬（手機 200%）橫向溢出，快改面板的關閉鈕會被擠出；
`.claude/agents/qa.md` 沒有「交件前必跑關卡」表（其他四個角色都有）；快改的 iPhone Safari／LINE 實機驗收待使用者。
