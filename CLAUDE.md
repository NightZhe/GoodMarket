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
