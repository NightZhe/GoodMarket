// 行政區清單產生器：一份來源、兩個輸出，前後端共用。
//   node --experimental-strip-types scripts/gen-tw-districts.mts            寫出 src/data/tw-districts.json，並更新 migration 裡 GENERATED 區塊
//   node --experimental-strip-types scripts/gen-tw-districts.mts --check    只檢查兩個產物是否等於現在的產生結果（不寫檔；不一致結束碼 1）
// 來源（已放進 scripts/data/tw-districts-source/，說明與授權見 SOURCE.md）：
//   post-geo-8.1.xml        中華郵政 8.1 3碼郵遞區號與行政區中心點經緯度對照表（主要來源）
//   post-zip3-7.3.utf8.txt  中華郵政 7.3 臺灣地區郵遞區號前3碼一覽表（交叉核對；原檔 Big5，這份是轉 UTF-8）
// 不在執行時連網；行政區調整時重新下載來源檔、跑這支、再開新的 migration（不要改舊的）。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import {
  buildDistricts, crossCheck, extractSqlBlock, parseGeoXml, parseZipTxt, renderJson, renderSqlBlock, spliceSqlBlock,
} from './lib/tw-districts-core.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = ROOT + 'scripts/data/tw-districts-source/';
const OUT_JSON = ROOT + 'src/data/tw-districts.json';
const MIG_DIR = ROOT + 'supabase/migrations/';
const check = process.argv.includes('--check');

const migName = readdirSync(MIG_DIR).filter(f => f.endsWith('_account_profile_addresses.sql'));
if (migName.length !== 1) { console.error(`預期剛好 1 個 *_account_profile_addresses.sql，找到 ${migName.length}`); process.exit(2); }
const MIG = MIG_DIR + migName[0];

const rows = parseGeoXml(readFileSync(SRC + 'post-geo-8.1.xml', 'utf8'));
const problems = crossCheck(rows, parseZipTxt(readFileSync(SRC + 'post-zip3-7.3.utf8.txt', 'utf8')));
if (problems.length) { console.error('7.3 與 8.1 交叉核對不一致：\n' + problems.join('\n')); process.exit(1); }

const data = buildDistricts(rows);
const json = renderJson(data);
const block = renderSqlBlock(data);
const mig = readFileSync(MIG, 'utf8');
const nextMig = spliceSqlBlock(mig, block);
const total = data.cities.reduce((n, c) => n + c.districts.length, 0);

if (check) {
  const jsonOk = (() => { try { return readFileSync(OUT_JSON, 'utf8') === json; } catch { return false; } })();
  const migOk = extractSqlBlock(mig) === block.trimEnd();
  console.log(`json ${jsonOk ? 'OK' : '不一致'}；migration ${migOk ? 'OK' : '不一致'}（${data.cities.length} 縣市、${total} 區）`);
  process.exit(jsonOk && migOk ? 0 : 1);
}
writeFileSync(OUT_JSON, json);
writeFileSync(MIG, nextMig);
console.log(`已寫出 ${OUT_JSON} 與 ${MIG} 的 GENERATED 區塊（${data.cities.length} 縣市、${total} 區；排除 ${data.meta.excluded.length} 項）`);
