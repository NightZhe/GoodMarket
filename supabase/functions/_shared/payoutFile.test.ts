import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePayoutFile } from './payoutFile.ts';

const fx = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/payout/${name}`, import.meta.url)));

describe('parsePayoutFile：35670 對帳檔（綠界實際格式：BOM、CRLF、每格 ="…"）', () => {
  it('正常檔：每列依表頭名稱取值，日期正規化成 YYYY-MM-DD，沒有撥款日的是 null', async () => {
    const r = await parsePayoutFile(fx('ac-r6.csv'));
    if (!r.ok) throw new Error(r.code);
    expect(r.encoding).toBe('utf-8');
    expect(r.totalRows).toBe(9);
    expect(r.rows).toHaveLength(8);
    expect(r.rows[0]).toMatchObject({
      line: 2, merchantTradeNo: 'P261020100001a1b2c3d', ecpayTradeNo: '2610201000011001', tradeAt: '2026-10-20 10:00:01',
      payMethod: '信用卡', feeRate: '2.45%', settleDate: '2026-10-21', payoutDate: '2026-10-28',
      amount: 1200, gatewayFee: '30.40', platformFee: 0, refundAmount: 0, netAmount: 1170, processingFee: '1.0000',
    });
    expect(r.rows[1]).toMatchObject({ merchantTradeNo: 'P261020100002a1b2c3d', payoutDate: null, amount: 850 });
  });

  it('AC-R1：欄位順序打亂、表頭前後有 tab 與空白、有 BOM、一般 CSV 寫法 → 解析結果跟正常檔相同（行號以外）', () => {
    const a = parsePayoutFile(fx('ac-r6.csv')), b = parsePayoutFile(fx('ac-r6-shuffled-tab-bom.csv'));
    if (!a.ok || !b.ok) throw new Error('parse failed');
    expect(b.rows).toEqual(a.rows);
    expect(b.invalid).toEqual(a.invalid);
  });
  it('AC-R3：UTF-8 沒有 BOM、Big5 的同一份內容 → 結果相同，encoding 標出來', () => {
    const a = parsePayoutFile(fx('ac-r6.csv')), n = parsePayoutFile(fx('ac-r6-utf8-nobom.csv')), b = parsePayoutFile(fx('ac-r6-big5.csv'));
    if (!a.ok || !n.ok || !b.ok) throw new Error('parse failed');
    expect(n.rows).toEqual(a.rows);
    expect(b.rows).toEqual(a.rows);
    expect(b.encoding).toBe('big5');
  });
  it('AC-R3：不是 UTF-8 也不是 Big5 → PARSE_ENCODING，沒有任何列', () => {
    expect(parsePayoutFile(fx('garbage.bin'))).toMatchObject({ ok: false, code: 'PARSE_ENCODING' });
  });
  it('AC-R2：缺必要欄位（撥款日期）→ PARSE_HEADER，訊息寫出缺哪一欄；不是 CSV（HTML）也是 PARSE_HEADER', () => {
    expect(parsePayoutFile(fx('missing-required.csv'))).toMatchObject({ ok: false, code: 'PARSE_HEADER', message: expect.stringContaining('撥款日期') });
    expect(parsePayoutFile(fx('not-csv.html'))).toMatchObject({ ok: false, code: 'PARSE_HEADER' });
  });
  it('AC-R2：缺選用欄位（平台手續費、金流處理費、手續費率）→ 照常解析，那幾欄是 null', () => {
    const r = parsePayoutFile(fx('missing-optional.csv'));
    if (!r.ok) throw new Error(r.code);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ amount: 1200, platformFee: null, processingFee: null, feeRate: null, netAmount: 1170 });
  });
  it('AC-R4：檔案多了卡號、發卡銀行欄 → 輸出裡完全找不到卡號字串', () => {
    const r = parsePayoutFile(fx('card-columns.csv'));
    if (!r.ok) throw new Error(r.code);
    expect(r.rows).toHaveLength(2);
    const dump = JSON.stringify(r);
    expect(dump).not.toContain('431195');
    expect(dump).not.toContain('測試銀行');
  });
  it('壞列（金額不是數字）→ 放進 invalid（帶行號、原因、只有認得的欄位），同檔其他列照常', () => {
    const r = parsePayoutFile(fx('ac-r6.csv'));
    if (!r.ok) throw new Error(r.code);
    expect(r.invalid).toEqual([expect.objectContaining({ line: 8, reason: '交易金額格式不正確', occurrence: 1 })]);
    expect(r.invalid[0].cells['特店交易編號']).toBe('P261020100006a1b2c3d');
  });
  it('只有表頭 → ok、0 列（空檔是正常結果）', () => {
    expect(parsePayoutFile(fx('header-only.csv'))).toEqual({ ok: true, encoding: 'utf-8', totalRows: 0, rows: [], invalid: [] });
  });
  it('綠界把錯誤寫在 CSV 裡（實打拿到的格式）→ ECPAY_MESSAGE＋原文訊息，不是資料列', () => {
    expect(parsePayoutFile(fx('ecpay-error-merchant-mismatch.csv'))).toMatchObject({ ok: false, code: 'ECPAY_MESSAGE', message: 'MerchantID does not match the MerchantID in the encrypted data' });
    expect(parsePayoutFile(fx('ecpay-error-range.csv'))).toMatchObject({ ok: false, code: 'ECPAY_MESSAGE', message: 'Date range must not be greater than one month.' });
  });
  it('退刷是負數列；同一張訂單同日同金額的兩筆部分退款 → occurrence 1、2（A-7：不會被當成重複）', () => {
    const r = parsePayoutFile(fx('partial-refunds.csv'));
    if (!r.ok) throw new Error(r.code);
    expect(r.rows.map((x) => [x.amount, x.netAmount, x.occurrence, x.payoutDate])).toEqual([[1200, 1170, 1, '2026-10-28'], [-200, -195, 1, '2026-10-29'], [-200, -195, 2, '2026-10-29']]);
  });
  it('日期格式：yyyyMMdd、含時間、不存在的日期（2/30）→ 不存在的是壞列', () => {
    const csv = (d: string) => new TextEncoder().encode(`特店交易編號,綠界交易編號,撥款日期,交易金額\nP1,T1,${d},100\n`);
    expect(parsePayoutFile(csv('20261028'))).toMatchObject({ ok: true, rows: [{ payoutDate: '2026-10-28' }] });
    expect(parsePayoutFile(csv('2026/10/28 00:00:00'))).toMatchObject({ ok: true, rows: [{ payoutDate: '2026-10-28' }] });
    expect(parsePayoutFile(csv('2026/02/30'))).toMatchObject({ ok: true, rows: [], invalid: [{ reason: '撥款日期格式不正確' }] });
  });
  it('引號裡有逗號、"" 跳脫', () => {
    const csv = new TextEncoder().encode('特店交易編號,綠界交易編號,撥款日期,交易金額\n"P,1","T""1",,"1,200"\n');
    expect(parsePayoutFile(csv)).toMatchObject({ ok: true, rows: [{ merchantTradeNo: 'P,1', ecpayTradeNo: 'T"1', payoutDate: null, amount: 1200 }] });
  });
});
