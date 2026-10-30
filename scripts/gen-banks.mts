// 銀行／分行清單產生器：一份來源、三個產物，前後端共用（介面契約 v2 §6）。
//   node --experimental-strip-types scripts/gen-banks.mts            寫出 src/data/banks.json、src/data/bank-branches.json，並更新 migration 裡 GENERATED 區塊
//   node --experimental-strip-types scripts/gen-banks.mts --check    只檢查三個產物是否等於現在的產生結果（不寫檔；不一致結束碼 1）
// 來源（scripts/data/banks-source/，網址／下載日／sha256／篩選規則見 SOURCE.md）：
//   R1_MEMBER.csv     跨行通匯業務參加金融機構一覽表（取「入戶電匯」）
//   R2_Location.csv   總分支機構位置查詢一覽表（取已收錄銀行的分支）
// 不在執行時連網；要更新時手動重新下載兩個 CSV、更新 SOURCE.md，再跑這支、再開新的 migration（不要改舊的）。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = ROOT + 'scripts/data/banks-source/';
const OUT_JSON = ROOT + 'src/data/banks.json';
const OUT_BRANCHES = ROOT + 'src/data/bank-branches.json';
const MIG = ROOT + 'supabase/migrations/20261029120000_bank_accounts.sql';
const DISTRICTS = ROOT + 'src/data/tw-districts.json';
const BEGIN = '-- BEGIN GENERATED banks';
const END = '-- END GENERATED banks';
const check = process.argv.includes('--check');

/** 排除的非存款戶機構（代碼，依 R1「入戶電匯」清單）：國庫局、票券公司、資訊中心、關貿、國庫署。信用合作社另以名稱規則排除。 */
const EXCLUDE_CODES = new Set(['000', '060', '061', '062', '066', '372', '600', '952', '995', '996', '997']);
const COOP = /信用合作社/;

/** 常用 6 家（N8：照蝦皮截圖；代碼已用清單查過）。順序＝common 的 1～6。找不到代碼或全名不符就失敗（銀行合併時會被發現）。 */
const COMMON: { code: string; short: string; name: string }[] = [
  { code: '822', short: '中國信託', name: '中國信託商業銀行' },
  { code: '013', short: '國泰世華', name: '國泰世華商業銀行' },
  { code: '808', short: '玉山', name: '玉山商業銀行' },
  { code: '012', short: '台北富邦', name: '台北富邦商業銀行' },
  { code: '700', short: '中華郵政', name: '中華郵政股份有限公司' },
  { code: '017', short: '兆豐', name: '兆豐國際商業銀行' },
];

/** 22 縣市（與 tw-districts.json 同寫法，用「臺」字）；順序＝bank-branches.json 的 cities。 */
const cities: string[] = JSON.parse(readFileSync(DISTRICTS, 'utf8')).cities.map((c: { name: string }) => c.name);
if (cities.length !== 22) { console.error(`tw-districts.json 縣市數不是 22：${cities.length}`); process.exit(2); }
/** 從 R2 地址前綴取縣市；R2 寫「台」，一律正規化成「臺」。取不到或不在 22 縣市內 → 失敗，不猜。 */
function cityOf(addr: string): number {
  const a = addr.trim().replace(/^台/, '臺');
  const idx = cities.findIndex((c) => a.startsWith(c));
  return idx;
}

/** RFC 4180 CSV 解析（支援雙引號欄位、欄位內逗號與 CRLF）；去掉開頭 BOM。 */
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}

const r1Text = readFileSync(SRC + 'R1_MEMBER.csv', 'utf8');
const r2Text = readFileSync(SRC + 'R2_Location.csv', 'utf8');
const r1 = parseCsv(r1Text), r2 = parseCsv(r2Text);
if (r1[0].join(',') !== '匯款類別,銀行代號/總機構代碼,銀行名稱') { console.error('R1 欄位標題不是預期的：' + r1[0].join(',')); process.exit(2); }
if (r2[0].join(',') !== '銀行代號/總機構代碼,分支機構代號,金融機構名稱,分支機構名稱,地址') { console.error('R2 欄位標題不是預期的：' + r2[0].join(',')); process.exit(2); }

const banks = new Map<string, string>();
for (const [kind, code, name] of r1.slice(1)) {
  if (kind !== '入戶電匯') continue;
  if (!/^[0-9]{3}$/.test(code)) { console.error(`R1 代碼格式不對：${code}`); process.exit(2); }
  if (EXCLUDE_CODES.has(code) || COOP.test(name)) continue;
  if (banks.has(code) && banks.get(code) !== name) { console.error(`R1 同代碼不同名稱：${code}`); process.exit(2); }
  banks.set(code, name.trim());
}
if (!banks.has('700') || !banks.has('004')) { console.error('預期的銀行（004 臺灣銀行、700 中華郵政）不在清單內，來源檔可能變了'); process.exit(2); }

const branches = new Map<string, Map<string, { name: string; city: number }>>(); // bank → (branch → name, 縣市索引)
for (const [code, branch, , branchName, address] of r2.slice(1)) {
  if (!banks.has(code) || branch === '') continue; // 非收錄銀行、或總機構列（分支欄空白）
  if (!/^[0-9]{4}$/.test(branch)) { console.error(`R2 分支代碼格式不對：${code}/${branch}`); process.exit(2); }
  const nm = branchName.trim();
  if (!nm || /[\u0000-\u001f\u007f-\u009f]/.test(nm)) { console.error(`R2 分行名稱空白或含控制字元：${code}/${branch}`); process.exit(2); }
  const city = cityOf(address ?? '');
  if (city < 0) { console.error(`R2 地址取不到 22 縣市之一：${code}/${branch}`); process.exit(2); }
  const m = branches.get(code) ?? new Map<string, { name: string; city: number }>();
  if (m.has(branch)) { console.error(`R2 重複的分行：${code}/${branch}`); process.exit(2); }
  m.set(branch, { name: nm, city }); branches.set(code, m);
}
const missingBranchBank = [...banks.keys()].filter((c) => !branches.has(c));

const codes = [...banks.keys()].sort();
for (const c of COMMON) {
  if (banks.get(c.code) !== c.name) { console.error(`常用銀行 ${c.code} 在清單內的全名不是「${c.name}」（是「${banks.get(c.code) ?? '不存在'}」）`); process.exit(2); }
}
const commonOf = (c: string) => COMMON.findIndex((x) => x.code === c);
const jsonOut = JSON.stringify(codes.map((c) => {
  const k = commonOf(c);
  return { code: c, name: banks.get(c)!, short: k >= 0 ? COMMON[k].short : null, common: k >= 0 ? k + 1 : null };
}), null, 2) + '\n';
const branchesObj: Record<string, [string, string, number][]> = {};
for (const c of codes) {
  const m = branches.get(c); if (!m) continue;
  branchesObj[c] = [...m.keys()].sort().map((b) => [b, m.get(b)!.name, m.get(b)!.city]);
}
const branchesOut = JSON.stringify({ cities, branches: branchesObj }) + '\n';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sha = (t: Buffer) => createHash('sha256').update(t).digest('hex');
let nBr = 0;
const lines: string[] = [
  `${BEGIN} (scripts/gen-banks.mts 產生，請勿手改；來源與篩選規則見 scripts/data/banks-source/SOURCE.md)`,
  `-- R1_MEMBER.csv sha256 ${sha(readFileSync(SRC + 'R1_MEMBER.csv'))}`,
  `-- R2_Location.csv sha256 ${sha(readFileSync(SRC + 'R2_Location.csv'))}`,
  'insert into public.bank_codes (code, name) values',
  codes.map((c) => `  (${q(c)}, ${q(banks.get(c)!)})`).join(',\n'),
  'on conflict (code) do update set name = excluded.name;',
  '',
  'insert into public.bank_branches (bank_code, branch_code, name, city) values',
];
const brLines: string[] = [];
for (const c of codes) for (const b of [...(branches.get(c)?.keys() ?? [])].sort()) { brLines.push(`  (${q(c)}, ${q(b)}, ${q(branches.get(c)!.get(b)!.name)}, ${q(cities[branches.get(c)!.get(b)!.city])})`); nBr++; }
lines.push(brLines.join(',\n'), 'on conflict (bank_code, branch_code) do update set name = excluded.name, city = excluded.city;', END);
const block = lines.join('\n');

const mig = readFileSync(MIG, 'utf8');
const i = mig.indexOf(BEGIN), j = mig.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error('migration 缺 GENERATED banks 標記'); process.exit(2); }
const nextMig = mig.slice(0, i) + block + mig.slice(j + END.length);

const summary = `${codes.length} 間銀行、${nBr} 家分行；無分行資料的銀行 ${missingBranchBank.length} 間${missingBranchBank.length ? '（' + missingBranchBank.join(',') + '）' : ''}`;
if (check) {
  let jsonOk = false; try { jsonOk = readFileSync(OUT_JSON, 'utf8') === jsonOut; } catch { /* 不存在 */ }
  let brOk = false; try { brOk = readFileSync(OUT_BRANCHES, 'utf8') === branchesOut; } catch { /* 不存在 */ }
  const migOk = nextMig === mig;
  console.log(`banks.json ${jsonOk ? 'OK' : '不一致'}；bank-branches.json ${brOk ? 'OK' : '不一致'}；migration ${migOk ? 'OK' : '不一致'}（${summary}）`);
  process.exit(jsonOk && brOk && migOk ? 0 : 1);
}
writeFileSync(OUT_JSON, jsonOut);
writeFileSync(OUT_BRANCHES, branchesOut);
writeFileSync(MIG, nextMig);
console.log(`已寫出 ${OUT_JSON}、${OUT_BRANCHES} 與 ${MIG} 的 GENERATED 區塊（${summary}）`);
