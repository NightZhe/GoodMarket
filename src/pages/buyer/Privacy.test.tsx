import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyView } from './Privacy';
import { CONTACT_EMAIL, PRIVACY_EFFECTIVE } from '../../lib/site';
import { BANK_REVISION } from './Privacy';

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
  it('開關打開：出現付款資料與銀行帳號兩項，與「不會儲存完整卡號」', () => {
    const on = html(true);
    expect(on).toContain('付款資料（信用卡）');
    expect(on).toContain('>銀行帳號<');
    expect(on).toContain('不會儲存完整卡號');
    expect(on).toContain('綠界科技');
  });
  it('開關打開：連動的句子也在（怎麼使用、誰看得到、保存多久、刪除）', () => {
    const on = html(true);
    expect(on).toContain('你按下付款時，向綠界科技請求用你選的卡付款');
    expect(on).toContain('你下單的賣家看得到訂單是否已付款，看不到你的卡片資料');
    expect(on).toContain('通知綠界科技撤銷綁定');
    expect(on).toContain('刪除帳號時，我們會先請綠界科技刪除你綁定的所有信用卡。');
    expect(on).toContain('信用卡與銀行帳號可以隨時在「我的帳號 › 銀行帳號／信用卡」刪除');
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
  it('修訂紀錄：MAAC Go 那筆（PR #8）維持固定日期 2026/10/26 與當時的原句，排在刪除帳號申請那筆之後、物流設定（2026/10/25）之前', () => {
    const page = html(false);
    const entry = `2026/10/26</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${SMS_REVISION}`;
    expect(page).toContain(entry);
    expect(page.indexOf(entry)).toBeLessThan(page.indexOf('2026/10/25</dt>'));
    expect(page.indexOf(entry)).toBeGreaterThan(page.indexOf('刪除帳號改為在 App 或網站提出申請'));
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
  it('修訂紀錄：物流設定那筆是固定日期 2026/10/25 與當時的原句，不跟著生效日走，且排在簡訊服務商改三竹那筆（2026/10/20）之前', () => {
    const page = html(false);
    const entry = `2026/10/25</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${RETURN_REVISION}`;
    expect(page).toContain(entry);
    expect(page.indexOf(entry)).toBeLessThan(page.indexOf('2026/10/20</dt>'));
  });
  it('生效日不早於最近一筆舊修訂 2026/10/25（改生效日沒有改到舊紀錄）', () => {
    expect(PRIVACY_EFFECTIVE >= '2026/10/25').toBe(true);
    const log = html(false).split('9. 修訂紀錄')[1];
    expect(log.match(/2026\/10\/25<\/dt>/g)).toHaveLength(String(PRIVACY_EFFECTIVE) === '2026/10/25' ? 2 : 1);
    expect(log.match(/2026\/10\/20<\/dt>/g)).toHaveLength(1);
  });
});

describe('刪除帳號申請與內容審核檢舉（AC-D33、D35、D36、K23、K24）', () => {
  const REVISION = '刪除帳號改為在 App 或網站提出申請、7 個工作天內處理，刪除時評價與照片一併刪除；新增『內容審核與檢舉』與檢舉紀錄的說明。';
  const section = (page: string, from: string, to: string) => page.split(from)[1].split(to)[0];

  it('第 4 節：期限是 7 個工作天內，並說明刪除申請與檢舉紀錄的保存', () => {
    for (const on of [false, true]) {
      const s4 = section(html(on), '4. 保存多久', '5. 刪除你的資料');
      expect(s4).toContain('我們會在 7 個工作天內刪除或去識別化你的個人資料');
      expect(s4).toContain('我們會保留刪除申請的處理紀錄（申請、完成日期與已刪除帳號的識別碼），以及你檢舉過的內容紀錄（不含你的身分）。');
      expect(s4).not.toContain('1 年');
    }
  });
  it('第 4 節：評價與照片隨帳號一併刪除，不再有匿名評價（N3＝B）；整頁不含「匿名買家」', () => {
    for (const on of [false, true]) {
      const page = html(on);
      const s4 = section(page, '4. 保存多久', '5. 刪除你的資料');
      expect(s4).toContain('刪除或去識別化你的個人資料，你寫的評價與照片會一併刪除。');
      expect(page).not.toContain('匿名買家');
    }
  });
  it('第 5 節：不再叫人來信申請，改為 App 或網站申請，連結到 #/account/delete', () => {
    for (const on of [false, true]) {
      const s5 = section(html(on), '5. 刪除你的資料', '6. 內容審核與檢舉');
      expect(s5).not.toContain('目前請來信申請');
      expect(s5).not.toContain('mailto:');
      expect(s5).toContain('要刪除整個帳號，請在 App 或網站的『我的 › 刪除帳號』提出申請，也可以直接從這裡');
      expect(s5).toMatch(/<a [^>]*href="\/account\/delete"[^>]*>申請刪除帳號<\/a>/);
      expect(s5).toContain('我們會在申請後 7 個工作天內人工處理；處理完成前你可以隨時取消。');
      expect(s5).toContain('還有待出貨或運送中的訂單時，要等訂單完成或取消後才能申請。');
      expect(s5).toContain('有開店的帳號，店、商品與店內的訂單會一併刪除。');
      expect(s5).toContain('刪除完成後，再用同一個登入方式登入會是全新的空帳號。');
    }
  });
  it('第 6 節「內容審核與檢舉」：人工審核、檢舉與 2 個工作天、封鎖只在裝置、聯絡信箱各有一句', () => {
    for (const on of [false, true]) {
      const s6 = section(html(on), '6. 內容審核與檢舉', '7. 聊聊');
      expect(s6).toContain('好物集上的商品、評價與照片由使用者刊登。我們以人工方式審核，發現或收到檢舉的違規內容（例如違禁品、仿冒品、詐騙、色情暴力、騷擾或洩露個人資料）會下架或移除。');
      expect(s6).toContain('每個商品、評價與店家都可以按『檢舉』告訴我們，我們會在 2 個工作天內處理，不會讓被檢舉的一方知道是誰檢舉。');
      expect(s6).toContain('封鎖只記在你這台裝置上，被封鎖店家的商品不會再出現在首頁與搜尋結果。');
      expect(s6).toContain(`href="mailto:${CONTACT_EMAIL}"`);
    }
  });
  it('第 1 節新增「檢舉紀錄」資料項目', () => {
    const s1 = section(html(false), '1. 我們收集的資料', '2. 怎麼使用');
    expect(s1).toContain('檢舉紀錄');
    expect(s1).toContain('你檢舉時選的原因、說明、被檢舉的內容與時間，跟著你的帳號識別碼保存，用來處理檢舉與防止濫用；不會提供給被檢舉的一方。');
  });
  it('節次重新編號：聊聊是第 7 節、聯絡我們是第 8 節、修訂紀錄是第 9 節', () => {
    const page = html(false);
    expect(page).toContain('>7. 聊聊<');
    expect(page).toContain('>8. 聯絡我們<');
    expect(page).toContain('>9. 修訂紀錄<');
  });
  it('修訂紀錄：刪除帳號申請那筆維持固定日期 2026/10/26 與當時的原句（不跟著生效日走），排在聊聊那筆之後、MAAC Go（同日）之前', () => {
    const page = html(false);
    const entry = `2026/10/26</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${REVISION}`;
    expect(page).toContain(entry);
    expect(page.indexOf(entry)).toBeGreaterThan(page.indexOf(`${PRIVACY_EFFECTIVE}</dt>`));
    expect(page.indexOf(entry)).toBeLessThan(page.indexOf(`2026/10/26</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${'驗證碼簡訊服務商由三竹'}`));
  });
  it('新句都不含付款字樣、不含 emoji（開關關著時整頁仍沒有付款字樣）', () => {
    const off = html(false);
    const added = [section(off, '1. 我們收集的資料', '2. 怎麼使用').split('檢舉紀錄')[1], section(off, '5. 刪除你的資料', '7. 聊聊'), REVISION].join('');
    for (const w of PAY_WORDS) {
      expect(added, w).not.toContain(w);
      expect(off, w).not.toContain(w);
    }
    expect(off).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('銀行帳號（AC-49、AC-36、spec 7.1、N6）', () => {
  const ITEM = '你在「銀行帳號／信用卡」綁定的銀行代碼、分行代碼、銀行帳號與戶名，用來在你開店收款時把貨款撥給你。完整銀行帳號以加密方式保存，畫面上只顯示銀行名稱與帳號末四碼；只有撥款流程會解密使用，你本人與其他使用者都無法從網站或 App 讀取完整帳號。我們也保存每個帳號的驗證狀態、未通過的原因，以及每次新增、刪除或更換撥款帳號的時間與帳號末四碼，用來處理帳號遭盜用的爭議。';
  const section = (page: string, from: string, to: string) => page.split(from)[1].split(to)[0];

  it('開關打開：資料項目有銀行帳號那段（含用途句）與簡訊再驗證句', () => {
    const s1 = section(html(true), '1. 我們收集的資料', '2. 怎麼使用');
    expect(s1).toContain(ITEM);
    expect(s1).toContain('新增第二個以上的銀行帳號或更換撥款帳號時，我們會傳送驗證碼簡訊到你帳號上綁定的手機，簡訊服務商同「驗證碼簡訊」一項。');
  });
  it('開關打開：誰看得到、保存與刪除各補一句', () => {
    const page = html(true);
    expect(section(page, '3. 誰看得到', '4. 保存多久')).toContain('你的銀行帳號不會顯示給買家或其他賣家。');
    expect(section(page, '4. 保存多久', '5. 刪除你的資料')).toContain('刪除帳號時，你綁定的銀行帳號一併刪除。');
  });
  it('不再出現舊字句：「不會儲存完整銀行帳號」「用特約商店編號與狀態判斷」「收款帳戶（賣家）」', () => {
    for (const on of [false, true]) {
      const page = html(on);
      for (const old of ['不會儲存完整銀行帳號', '用特約商店編號與狀態判斷', '收款帳戶（賣家）', '特約商店']) expect(page, old).not.toContain(old);
    }
  });
  it('開關關著：沒有銀行帳號的資料項目、也沒有付款字樣（既有不變量）', () => {
    const off = html(false);
    expect(off).not.toContain('>銀行帳號<');
    expect(off).not.toContain('不會顯示給買家或其他賣家');
    expect(off).not.toContain('你綁定的銀行帳號一併刪除');
    for (const w of PAY_WORDS) expect(off, w).not.toContain(w);
  });
  it('修訂紀錄（AC-36）：銀行帳號那筆只在開關打開時出現，固定日期 2026/10/29，排在聊聊那筆之後、刪除帳號那筆之前；不含付款字樣', () => {
    for (const w of PAY_WORDS) expect(BANK_REVISION, w).not.toContain(w);
    const entry = `2026/10/29</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${BANK_REVISION}`;
    expect(html(false)).not.toContain(BANK_REVISION);
    const on = html(true);
    expect(on).toContain(entry);
    expect(on.indexOf(entry)).toBeGreaterThan(on.indexOf('新增『聊聊』：'));
    expect(on.indexOf(entry)).toBeLessThan(on.indexOf('刪除帳號改為在 App 或網站提出申請'));
  });
});

describe('聊聊訊息（AC-M46、規格 §10.1）', () => {
  // 規格 §10.1 全文，一字不改（不含開頭粗體的「聊聊訊息」與冒號）
  const CHAT_SENTENCE = '你與店家在站內的對話內容（文字、圖片、商品與訂單卡片）會儲存在我們的資料庫與檔案儲存空間，用於提供對話功能與處理交易糾紛。對話不會自動刪除；你刪除帳號後，對方仍看得到既有對話，但你的名稱會顯示為『已刪除的帳號』。圖片只有對話雙方看得到。我們不會將對話內容用於廣告。';
  const CHAT_REVISION = '新增『聊聊』：說明站內對話內容的儲存、保留與刪帳號後的顯示方式。';
  const section = (page: string, from: string, to: string) => page.split(from)[1].split(to)[0];

  it('第 7 節「聊聊」：粗體「聊聊訊息」＋「：」＋規格原文整句（開關開或關都在）', () => {
    for (const on of [false, true]) {
      const s7 = section(html(on), '>7. 聊聊<', '8. 聯絡我們');
      expect(s7).toContain(`<strong class="font-semibold">聊聊訊息</strong>：${CHAT_SENTENCE}`);
    }
  });
  it('第 7 節夾在「內容審核與檢舉」（6）與「聯絡我們」（8）之間', () => {
    const page = html(false);
    expect(page.indexOf('>6. 內容審核與檢舉<')).toBeLessThan(page.indexOf('>7. 聊聊<'));
    expect(page.indexOf('>7. 聊聊<')).toBeLessThan(page.indexOf('>8. 聯絡我們<'));
  });
  it('第 5 節補一句：聊聊對話不隨帳號刪除而刪除，你的名稱改顯示為『已刪除的帳號』', () => {
    for (const on of [false, true]) {
      expect(section(html(on), '5. 刪除你的資料', '6. 內容審核與檢舉')).toContain('聊聊對話不隨帳號刪除而刪除，你的名稱改顯示為『已刪除的帳號』。');
    }
  });
  it('生效日是 2026/10/29（上線日），修訂紀錄最新一筆用生效日、排在其他所有舊修訂之前', () => {
    const page = html(false);
    expect(PRIVACY_EFFECTIVE).toBe('2026/10/29');
    const latest = `${PRIVACY_EFFECTIVE}</dt><dd class="mt-0.5 text-sm leading-6 text-muted">${CHAT_REVISION}`;
    expect(page).toContain(latest);
    expect(page.split('9. 修訂紀錄')[1].match(/<dt[^>]*>([^<]+)<\/dt>/)?.[1]).toBe(PRIVACY_EFFECTIVE);
    expect(page).toContain(`生效日期：${PRIVACY_EFFECTIVE}`);
  });
  it('新句與修訂紀錄新句都不含付款字樣、不含 emoji（開關關著時整頁仍沒有）', () => {
    const off = html(false);
    for (const w of PAY_WORDS) {
      expect(CHAT_SENTENCE, w).not.toContain(w);
      expect(CHAT_REVISION, w).not.toContain(w);
      expect(off, w).not.toContain(w);
    }
    expect(off).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
