import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyView } from './Privacy';
import { PRIVACY_EFFECTIVE } from '../../lib/site';

const html = (payOn: boolean) => renderToStaticMarkup(<MemoryRouter><PrivacyView payOn={payOn} /></MemoryRouter>);

// 開關關著時，隱私政策與線上付款功能上線前逐字相同：不出現付款、信用卡、綠界、收款、撥款相關的任何字
const PAY_WORDS = ['綠界', '信用卡', '付款', '卡號', '收款', '撥款', '特約商店', '扣款'];

describe('隱私政策隨線上付款開關顯示付款段落', () => {
  it('開關關著：沒有任何付款相關字樣（含「不會儲存完整卡號」）', () => {
    const off = html(false);
    for (const w of PAY_WORDS) expect(off, w).not.toContain(w);
  });
  it('開關關著：訂單、保存、刪除各節維持原句', () => {
    const off = html(false);
    expect(off).toContain('你的訂單內容、金額、狀態與物流進度。');
    expect(off).toContain('訂單等交易紀錄，依相關法規規定的期間保存。');
    expect(off).toContain('收件地址可以隨時在「我的帳號 › 地址」刪除；暱稱可以在「個人檔案」清空。');
  });
  it('開關打開：出現付款資料與收款帳戶兩項，與「不會儲存完整卡號」', () => {
    const on = html(true);
    expect(on).toContain('付款資料（信用卡）');
    expect(on).toContain('收款帳戶（賣家）');
    expect(on).toContain('不會儲存完整卡號');
    expect(on).toContain('綠界科技');
  });
  it('開關打開：連動的句子也在（怎麼使用、誰看得到、保存多久、刪除）', () => {
    const on = html(true);
    expect(on).toContain('你按下付款時，向綠界科技請求用你選的卡付款');
    expect(on).toContain('你下單的賣家看得到訂單是否已付款，看不到你的卡片資料');
    expect(on).toContain('通知綠界科技撤銷綁定');
    expect(on).toContain('信用卡可以隨時在「我的帳號 › 付款方式」刪除');
  });
});

describe('驗證碼簡訊服務商（AC-M40）', () => {
  it('資料項目寫三竹資訊（位於台灣），不再寫 Twilio 與美國', () => {
    const page = html(false);
    expect(page).toContain('驗證碼簡訊由簡訊服務商三竹資訊股份有限公司（位於台灣）代為傳送，它會處理你的手機號碼與簡訊內容。');
    expect(page).not.toContain('位於美國');
    // 修訂紀錄是歷史，會提到 Twilio；正文（修訂紀錄之前）不能再有
    expect(page.split('修訂紀錄')[0]).not.toContain('Twilio');
  });
  it('修訂紀錄：最新一筆用生效日、說明服務商更換；上一筆是固定日期且維持當時的原句', () => {
    const page = html(false);
    expect(page).toContain(`${PRIVACY_EFFECTIVE}</dt><dd class="mt-0.5 text-sm leading-6 text-muted">驗證碼簡訊服務商由 Twilio 改為三竹資訊股份有限公司（位於台灣）。`);
    expect(page).toContain('2026/10/19</dt><dd class="mt-0.5 text-sm leading-6 text-muted">新增手機號碼登入與綁定手機');
  });
});
