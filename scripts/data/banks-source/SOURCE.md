# 銀行／分行清單的來源（src/data/banks.json 與 migration 裡的 bank_codes／bank_branches 都由這裡產生）

不要手改兩個產物；改來源檔後跑 `node --experimental-strip-types scripts/gen-banks.mts`，
檢查用 `--check`（不一致結束碼 1）。

## 來源檔（2026-10-28 下載，未修改；UTF-8 帶 BOM）
政府資料開放平台，提供機關中央銀行，檔案放在財金資訊公司網域。

| 本資料夾的檔案 | 資料集 | 下載網址 | sha256 |
|----------------|--------|----------|--------|
| `R1_MEMBER.csv` | dataset 13682「跨行通匯業務參加金融機構一覽表」（https://data.gov.tw/dataset/13682） | https://www.fisc.com.tw/TC/OPENDATA/R1_MEMBER.csv | `1f1c227a76b45b38c302c66b9b66df6fa45825c14de77ec1eb23ebd8358ac00c` |
| `R2_Location.csv` | dataset 24323「『總分支機構位置』查詢一覽表」（https://data.gov.tw/dataset/24323） | https://www.fisc.com.tw/TC/OPENDATA/R2_Location.csv | `4ae6d98be78f906b9d95bee5b1a80a40091e321b859944a8326b3b8d54cded27` |

## 篩選規則（介面契約 §1、Q8=A）
1. R1 只取「匯款類別＝入戶電匯」（84 筆）。
2. 排除非存款戶機構（代碼）：`000` 中央銀行國庫局、`060/061/062/066/372` 票券公司、`600` 農金資訊、`952` 農漁會南區資訊中心、`995` 關貿網路、`996` 財政部國庫署、`997` 信合社聯合社資訊處理中心。
3. 排除名稱含「信用合作社」者（`114 115 119 130 132 146 162 204 215 216`）。
4. 保留 `700` 中華郵政。結果 **63 間**。農會、漁會不在入戶電匯清單裡，所以不收。
5. 分行：R2 中「總機構代碼」屬於上述 63 間、且「分支機構代號」非空（總機構列分支欄是空白）者，取分支機構名稱（共 3,508 家）。
6. 腳本檢查：標題列等於預期、代碼 3 碼／4 碼、同銀行分行代碼不重複、分行名稱非空且無控制字元；不符就失敗，不默默略過。

## 縣市與第二個產物
縣市取自 R2 地址前綴（「台」正規化成「臺」，需屬 `src/data/tw-districts.json` 的 22 縣市，否則腳本失敗）；腳本另輸出 `src/data/bank-branches.json`（`{cities, branches}`），`--check` 同時檢查 `banks.json`、`bank-branches.json` 與 migration 的 GENERATED 區塊。

## 更新
本刀手動（有銀行合併或新設時）：重新下載、更新上表 sha256 與日期、跑腳本、**開新的 migration**（不要改舊的）。
