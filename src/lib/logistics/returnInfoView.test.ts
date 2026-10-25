import { describe, expect, it } from 'vitest';
import { LEGAL_NOTICE, RETURN_EMPTY_TEXT, buildReturnInfoView, parseReturnInfo, type ReturnInfo } from './returnInfoView';

const store = {
  brand: 'seven_eleven', store_name: '好物門市', recipient: '王小明', phone: '0912345678',
  city: '臺北市', district: '大安區', postal_code: '106', detail: '忠孝東路四段1號',
};
const personal = {
  recipient: '李小華', phone: '0987654321', city: '新北市', district: '板橋區', postal_code: '220', detail: '文化路一段1號3樓',
};
const info = (p: Partial<ReturnInfo>): ReturnInfo => ({ store: null, personal: null, note: null, ...p });

describe('固定文案（逐字，使用者確認過）', () => {
  it('沒設定、法規句', () => {
    expect(RETURN_EMPTY_TEXT).toBe('賣家尚未提供退貨地址');
    expect(LEGAL_NOTICE).toBe('收到商品後 7 天內，可以向賣家提出退貨（消費者保護法第 19 條；部分商品依法除外）。');
  });
  it('法規句不含天數倒數、不保證可退', () => {
    expect(LEGAL_NOTICE).not.toMatch(/剩|保證|倒數/);
  });
});

describe('買家退貨資訊的組合（AC-L27～L29）', () => {
  it('只有門市：只有「超商退貨」一段', () => {
    const v = buildReturnInfoView(info({ store }));
    expect(v.sections.map(s => s.title)).toEqual(['超商退貨']);
    expect(v.empty).toBe(false);
  });
  it('只有個人地址：只有「宅配退貨」一段', () => {
    const v = buildReturnInfoView(info({ personal }));
    expect(v.sections.map(s => s.title)).toEqual(['宅配退貨']);
    expect(v.empty).toBe(false);
  });
  it('兩者都有：超商在前、宅配在後', () => {
    const v = buildReturnInfoView(info({ store, personal }));
    expect(v.sections.map(s => s.kind)).toEqual(['store', 'personal']);
  });
  it('都沒有：沒有任何段落、empty＝true，並帶固定句', () => {
    const v = buildReturnInfoView(info({}));
    expect(v.sections).toEqual([]);
    expect(v.empty).toBe(true);
    expect(v.emptyText).toBe('賣家尚未提供退貨地址');
  });
  it('每種組合都帶法規句', () => {
    for (const i of [info({}), info({ store }), info({ personal }), info({ store, personal, note: 'x' })]) {
      expect(buildReturnInfoView(i).legalText).toBe(LEGAL_NOTICE);
    }
  });
});

describe('退貨說明', () => {
  it('有說明：原樣（保留換行）帶出；沒有就是 null', () => {
    expect(buildReturnInfoView(info({ store, note: '請先 LINE 聯絡\n再寄回' })).note).toBe('請先 LINE 聯絡\n再寄回');
    expect(buildReturnInfoView(info({ store })).note).toBeNull();
  });
  it('都沒有地址時，說明仍然帶出（H-L6）', () => {
    const v = buildReturnInfoView(info({ note: '電話聯絡' }));
    expect(v.empty).toBe(true);
    expect(v.note).toBe('電話聯絡');
  });
  it('只有空白的說明當作沒有；網址、角括號不改寫（純文字顯示）', () => {
    expect(buildReturnInfoView(info({ note: ' \n ' })).note).toBeNull();
    expect(buildReturnInfoView(info({ note: 'https://a.b <b>x</b>' })).note).toBe('https://a.b <b>x</b>');
  });
});

describe('段落內容與複製文字（設計 6.2～6.3）', () => {
  it('超商退貨：門市（品牌字樣＋名稱）／地址／收件人／手機（0912-345-678）', () => {
    const s = buildReturnInfoView(info({ store })).sections[0];
    expect(s.rows).toEqual([
      { label: '門市', value: '7-ELEVEN 好物門市', strong: true },
      { label: '地址', value: '106 臺北市大安區忠孝東路四段1號', strong: false },
      { label: '收件人', value: '王小明', strong: true },
      { label: '手機', value: '0912-345-678', strong: false },
    ]);
    expect(s.copyLabel).toBe('複製超商退貨資料');
    expect(s.copyText).toBe('超商退貨\n門市：7-ELEVEN 好物門市\n地址：106 臺北市大安區忠孝東路四段1號\n收件人：王小明\n手機：0912-345-678');
  });
  it('宅配退貨：收件人／手機／地址', () => {
    const s = buildReturnInfoView(info({ personal })).sections[0];
    expect(s.rows.map(r => [r.label, r.value])).toEqual([
      ['收件人', '李小華'], ['手機', '0987-654-321'], ['地址', '220 新北市板橋區文化路一段1號3樓'],
    ]);
    expect(s.rows[0].strong).toBe(true);
    expect(s.copyLabel).toBe('複製宅配退貨資料');
    expect(s.copyText).toBe('宅配退貨\n收件人：李小華\n手機：0987-654-321\n地址：220 新北市板橋區文化路一段1號3樓');
  });
  it('資料庫日後多出不認得的品牌代碼：照原樣顯示，不丟錯', () => {
    const s = buildReturnInfoView(info({ store: { ...store, brand: 'new_brand' } })).sections[0];
    expect(s.rows[0].value).toBe('new_brand 好物門市');
  });
});

describe('parseReturnInfo：RPC 回傳 → 固定形狀', () => {
  it('三個 key 都在；缺的或型別不對當作沒有', () => {
    expect(parseReturnInfo({ store, personal: null, note: '嗨' })).toEqual({ store, personal: null, note: '嗨' });
    for (const raw of [null, undefined, {}, 'x', []]) {
      expect(parseReturnInfo(raw), String(raw)).toEqual({ store: null, personal: null, note: null });
    }
  });
});
