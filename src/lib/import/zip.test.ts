import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from './zip';
import { failureZipName } from './download';

// 最小讀取器：從 end-of-central-directory 找回每個檔案，驗證 CRC 與內容
function readZip(zip: Uint8Array): { name: string; bytes: Uint8Array; crc: number; flags: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const flags = v.getUint16(p + 8, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, bytes: zip.subarray(dataStart, dataStart + size), crc, flags });
    p += 46 + nameLen;
  }
  return out;
}

describe('zip 寫入器', () => {
  it('CRC32 對照已知值', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('多個檔案（含中文檔名）寫入後可完整讀回，CRC 與內容一致', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new TextEncoder().encode('第二個檔案');
    const files = readZip(buildZip([
      { name: '失敗原因_basic.xlsx', bytes: a },
      { name: 'b.xlsx', bytes: b },
    ], new Date(2026, 9, 15, 20, 30, 10)));
    expect(files.map((f) => f.name)).toEqual(['失敗原因_basic.xlsx', 'b.xlsx']);
    expect([...files[0].bytes]).toEqual([...a]);
    expect(new TextDecoder().decode(files[1].bytes)).toBe('第二個檔案');
    expect(files.every((f) => f.crc === crc32(f.bytes))).toBe(true);
    expect(files.every((f) => (f.flags & 0x0800) !== 0)).toBe(true); // UTF-8 檔名旗標
  });

  it('空清單也是合法的 zip', () => {
    expect(readZip(buildZip([]))).toEqual([]);
  });
});

describe('失敗原因 zip 檔名', () => {
  it('失敗原因_{店家 ID}_{yyyyMMdd-HHmm}.zip', () => {
    expect(failureZipName('99990001', new Date(2026, 9, 5, 7, 3))).toBe('失敗原因_99990001_20261005-0703.zip');
  });
});
