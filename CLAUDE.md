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
資料庫異動用 Supabase CLI：`npx supabase db query --linked -f <檔案>`（已 link 專案 `hvecvwzpummmlsakxqbw`）。
