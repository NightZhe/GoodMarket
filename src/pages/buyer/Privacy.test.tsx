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
    expect(on).toContain('刪除帳號時，我們會先請綠界科技刪除你綁定的所有信用卡。');
    expect(on).toContain('信用卡可以隨時在「我的帳號 › 付款方式」刪除');
  });
});

describe('驗證碼簡訊服務商（AC-M40；2026-10 改為 MAAC Go，三竹備援）', () => {
  const SMS_SENTENCE = '用手機號碼登入或綁定手機時，驗證碼簡訊由簡訊服務商漸強實驗室股份有限公司（MAAC Go，位於台灣）代為傳送，它會處理你的手機號碼與簡訊內容。如果 MAAC Go 暫時無法傳送，會改由三竹資訊股份有限公司（位於台灣）代為傳送，處理的資料相同。';
  const SMS_REVISION = '驗證碼簡訊服務商由三竹資訊股份有限公司改為漸強實驗室股份有限公司（MAAC Go，位於台灣）；三竹資訊改為備援，只在 MAAC Go 暫時無法傳送時使用。';

  it('資料項目寫漸強實驗室（MAAC Go，位於台灣）為主、三竹資訊為備援，不再寫 Twilio 與美國', () => {
    const page = html(false);
    const section1 = page.split('1. 我們收集的資料')[1].split('2. 怎麼使用')[0];
    expect(section1).toContain(SMS_SENTENCE);
    expect(page).not.toContain('位於美國');
    // 修訂紀錄是歷史，會提到 Twilio；正文（修訂紀錄之前）不能再有
    expect(page.split('修訂紀錄')[0]).not.toContain('Twilio');
    // 正文只剩這一句提到三竹（備援），不能再有「由三竹代為傳送」當主要服務商的舊句
    expect(page.split('修訂紀錄')[0]).not.toContain('由簡訊服務商三竹資訊');
  });
  it('新句與修訂紀錄新句都不含付款字樣', () => {
    for (const w of PAY_WORDS) {
      expect(SMS_SENTENCE, w).not.toContain(w);
      expect(SMS_REVISION, w).not.toContain(w);
    }
  });
  it('修訂紀錄：最新一筆用生效日、是本次的供應商更換說明，且排在物流設定（2026/10/25）那筆之前', () => {
    const page = html(false);
    const latest = `${PRIVACY_EFFECTIVE}</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${SMS_REVISION}`;
    expect(page).toContain(latest);
    expect(page.indexOf(latest)).toBeLessThan(page.indexOf('2026/10/25</dt>'));
    expect(page).toContain(`生效日期：${PRIVACY_EFFECTIVE}`);
  });
  it('修訂紀錄：Twilio 改三竹那筆維持固定日期 2026/10/20 與當時的原句，不跟著生效日走', () => {
    const page = html(false);
    expect(page).toContain('2026/10/20</dt><dd class="mt-0.5 text-sm leading-6 text-muted">驗證碼簡訊服務商由 Twilio 改為三竹資訊股份有限公司（位於台灣）。');
    expect(page).toContain('2026/10/19</dt><dd class="mt-0.5 text-sm leading-6 text-muted">新增手機號碼登入與綁定手機');
  });
});

describe('賣家退貨收件資料的揭露（AC-L38、AC-L39）', () => {
  const RETURN_SENTENCE = '有開店的賣家在『物流設定』填的退貨收件資料（收件人姓名、手機、退貨門市或地址、退貨說明），會顯示給向這家店購買、且訂單已出貨或已完成的買家；賣場頁與商品頁不會顯示。';
  const RETURN_REVISION = '新增賣家『物流設定』：說明賣家的退貨收件資料會顯示給哪些買家。';

  it('第 3 節「誰看得到」出現退貨收件資料那一句（開關開或關都在）', () => {
    for (const on of [false, true]) {
      const page = html(on);
      const section3 = page.split('3. 誰看得到')[1].split('4. 保存多久')[0];
      expect(section3).toContain(RETURN_SENTENCE);
    }
  });
  it('新句與修訂紀錄新句都不含付款字樣（開關關著時整頁仍沒有）', () => {
    for (const w of PAY_WORDS) {
      expect(RETURN_SENTENCE, w).not.toContain(w);
      expect(RETURN_REVISION, w).not.toContain(w);
    }
    const off = html(false);
    for (const w of PAY_WORDS) expect(off, w).not.toContain(w);
  });
  it('修訂紀錄：物流設定那筆改為固定日期 2026/10/25 與當時的原句，不跟著生效日走，且排在簡訊服務商改三竹那筆（2026/10/20）之前', () => {
    const page = html(false);
    const entry = `2026/10/25</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${RETURN_REVISION}`;
    expect(page).toContain(entry);
    expect(page.indexOf(entry)).toBeLessThan(page.indexOf('2026/10/20</dt>'));
  });
  it('生效日不早於最近一筆舊修訂 2026/10/25（改生效日沒有改到舊紀錄）', () => {
    expect(PRIVACY_EFFECTIVE >= '2026/10/25').toBe(true);
    const log = html(false).split('7. 修訂紀錄')[1];
    expect(log.match(/2026\/10\/25<\/dt>/g)).toHaveLength(String(PRIVACY_EFFECTIVE) === '2026/10/25' ? 2 : 1);
    expect(log.match(/2026\/10\/20<\/dt>/g)).toHaveLength(1);
  });
});
