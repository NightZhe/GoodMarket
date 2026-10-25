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

## 本機環境與 worktree

- 開 worktree 時不要另裝套件：`ln -s /Users/ben/harryaiagent/GoodMarket/node_modules node_modules` 指向主 checkout。
- main 拉新後若 `package.json` 有變，到主 checkout 跑 `npm install`，所有 worktree 一起生效。
- CI（`.github/workflows/ci.yml`）在乾淨環境跑 lint／測試／build，會抓到「本機能跑、乾淨環境不能跑」的問題。

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

## 目前狀態

最近狀態與各功能的 `.work/` 路徑見 `docs/STATUS.md`；新功能上線後更新那裡，不要寫回本檔。
