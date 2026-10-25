import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReturnInfoPanel, type ReturnInfoLoad } from './ReturnInfo';
import { buildReturnInfoView, LEGAL_NOTICE, type ReturnInfo } from '../../lib/logistics/returnInfoView';

const STORE = { brand: 'familymart', store_name: '好物門市', recipient: '王小明', phone: '0912345678', city: '臺北市', district: '大安區', postal_code: '106', detail: '忠孝東路四段1號' };
const PERSONAL = { recipient: '李小華', phone: '0987654321', city: '新北市', district: '板橋區', postal_code: '220', detail: '文化路一段1號3樓' };

const ready = (info: Partial<ReturnInfo>): ReturnInfoLoad => ({ phase: 'ready', view: buildReturnInfoView({ store: null, personal: null, note: null, ...info }) });
const html = (load: ReturnInfoLoad) => renderToStaticMarkup(<ReturnInfoPanel load={load} onRetry={() => undefined} onCopy={() => undefined} />);

describe('買家退貨資訊面板的內容組合（AC-L27～L29）', () => {
  it('只有門市：只有「超商退貨」段', () => {
    const h = html(ready({ store: STORE }));
    expect(h).toContain('超商退貨');
    expect(h).not.toContain('宅配退貨');
    expect(h).toContain('全家 好物門市');
    expect(h).toContain('106 臺北市大安區忠孝東路四段1號');
    expect(h).toContain('0912-345-678');
  });
  it('只有個人地址：只有「宅配退貨」段', () => {
    const h = html(ready({ personal: PERSONAL }));
    expect(h).toContain('宅配退貨');
    expect(h).not.toContain('超商退貨');
  });
  it('兩者都有：超商在前、宅配在後，各有複製鈕', () => {
    const h = html(ready({ store: STORE, personal: PERSONAL }));
    expect(h.indexOf('超商退貨')).toBeLessThan(h.indexOf('宅配退貨'));
    expect(h).toContain('aria-label="複製超商退貨資料"');
    expect(h).toContain('aria-label="複製宅配退貨資料"');
  });
  it('都沒有：顯示「賣家尚未提供退貨地址」，沒有複製鈕', () => {
    const h = html(ready({}));
    expect(h).toContain('賣家尚未提供退貨地址');
    expect(h).not.toContain('複製');
  });
  it('每種組合都有法規句，沒有天數倒數', () => {
    for (const info of [{}, { store: STORE }, { personal: PERSONAL }, { store: STORE, personal: PERSONAL, note: 'x' }]) {
      const h = html(ready(info));
      expect(h).toContain(LEGAL_NOTICE);
      expect(h).not.toContain('剩');
    }
  });
  it('退貨說明：純文字、保留換行樣式、網址不變成連結；都沒有地址時仍顯示在「尚未提供」下方', () => {
    const h = html(ready({ note: '請先 LINE 聯絡\nhttps://example.com/a?b=1' }));
    expect(h).toContain('退貨說明');
    expect(h).toContain('whitespace-pre-wrap');
    expect(h).toContain('請先 LINE 聯絡\nhttps://example.com/a?b=1');
    expect(h).not.toContain('<a ');
    expect(h.indexOf('賣家尚未提供退貨地址')).toBeLessThan(h.indexOf('退貨說明'));
  });
  it('說明裡的 HTML 會被跳脫，不會變成標籤', () => {
    expect(html(ready({ note: '<b>hi</b>' }))).not.toContain('<b>hi');
  });
  it('段落標題是 h3、文字可選取', () => {
    const h = html(ready({ store: STORE }));
    expect(h).toContain('<h3');
    expect(h).toContain('select-text');
  });
});

describe('買家退貨資訊面板的失敗狀態（AC-L32、R-L19、N6）', () => {
  it('讀取失敗：可重試，不出現「賣家尚未提供退貨地址」', () => {
    const h = html({ phase: 'failed', failure: 'failed' });
    expect(h).toContain('讀不到退貨資訊');
    expect(h).toContain('重試');
    expect(h).toContain('role="alert"');
    expect(h).not.toContain('賣家尚未提供');
  });
  it('離線：說明要連網、可重試', () => {
    const h = html({ phase: 'failed', failure: 'offline' });
    expect(h).toContain('目前沒有網路');
    expect(h).toContain('連上網路後才能看到退貨資訊。');
    expect(h).toContain('重試');
    expect(h).not.toContain('賣家尚未提供');
  });
  it('資料庫未升級：暫時無法使用，無重試、無英文錯誤', () => {
    const h = html({ phase: 'failed', failure: 'unavailable' });
    expect(h).toContain('退貨資訊暫時無法使用');
    expect(h).toContain('請稍後再試。');
    expect(h).not.toContain('重試');
  });
  it('訂單狀態已變、找不到、登入過期：純文字、無重試', () => {
    expect(html({ phase: 'failed', failure: 'not_available' })).toContain('這張訂單目前沒有退貨資訊');
    expect(html({ phase: 'failed', failure: 'not_found' })).toContain('找不到這張訂單的退貨資訊');
    const auth = html({ phase: 'failed', failure: 'auth' });
    expect(auth).toContain('登入已過期，請重新登入。');
    expect(auth).not.toContain('重試');
  });
  it('讀取中：骨架與 sr-only 狀態，沒有任何地址或「尚未提供」', () => {
    const h = html({ phase: 'loading' });
    expect(h).toContain('載入退貨資訊中');
    expect(h).not.toContain('賣家尚未提供');
  });
});
