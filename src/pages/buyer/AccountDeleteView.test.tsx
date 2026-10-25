import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AccountDeleteView, DeletionStatusCard } from './AccountDeleteView';
import type { DeletionRequest } from '../../lib/deletion/api';
import { INTRO } from '../../lib/deletion/copy';
import type { DeletionView, Stage } from '../../lib/deletion/status';
import { CONTACT_EMAIL, DELETION_WINDOW } from '../../lib/site';

const REQ: DeletionRequest = { id: 'r1', status: 'pending', requested_at: '2026-10-26T02:00:00+00:00', due_date: '2026-11-04' };

function page(stage: Stage, view: DeletionView | null = null, o: { online?: boolean; justSubmitted?: boolean } = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AccountDeleteView
        stage={stage} view={view} online={o.online ?? true} retrying={false} justSubmitted={o.justSubmitted ?? false}
        onLogin={() => {}} onRetry={() => {}} onApply={() => {}} onAskCancel={() => {}}
      />
    </MemoryRouter>,
  );
}

// 申請列的文字（Banner 與說明裡也會出現「申請刪除帳號」字樣，所以連標籤一起比）
const APPLY = '>申請刪除帳號</span>';
const CAN: DeletionView = { kind: 'can_apply', hasShop: false };

// 說明在所有狀態都完整出現（Google Play 要求頁面出現 App 名稱「好物集」）
describe('刪除帳號申請頁：說明（所有狀態共用）', () => {
  const stages: [Stage, DeletionView | null][] = [
    ['loading', null], ['login', null], ['login_expired', null], ['can_apply', CAN], ['error', { kind: 'error' }], ['backend_missing', { kind: 'backend_missing' }],
  ];
  for (const [stage, view] of stages) {
    it(`${stage}：導言、四段說明、「好物集」`, () => {
      const h = page(stage, view);
      expect(h).toContain('好物集');
      expect(h).toContain(INTRO);
      for (const t of ['會刪除的資料', '會保留的資料', '完成後怎麼知道', '處理期間']) expect(h, t).toContain(`>${t}</h2>`);
      expect(h).toContain('名稱改為『匿名買家』');
      expect(h).toContain('再用同一個 Google、Apple 帳號或手機號碼登入，會是一個全新的空帳號');
    });
  }
  it('期限用常數組出，不寫死', () => {
    expect(INTRO).toContain(DELETION_WINDOW);
  });
});

describe('未登入（S-D3）與登入過期（S-D11）', () => {
  it('未登入：登入後申請；沒有申請鈕、沒有過期提示', () => {
    const h = page('login');
    expect(h).toContain('登入後申請');
    expect(h).toContain('請用你要刪除的那個帳號登入。');
    expect(h).not.toContain(APPLY);
    expect(h).not.toContain('登入已過期');
  });
  it('登入過期：提示＋重新登入', () => {
    const h = page('login_expired');
    expect(h).toContain('登入已過期');
    expect(h).toContain('重新登入');
    expect(h).not.toContain('登入後申請');
    expect(h).not.toContain(APPLY);
  });
});

describe('載入中（S-D4）', () => {
  it('說明先出現；按鈕位置是 aria-busy 灰塊，沒有任何按鈕', () => {
    const h = page('loading');
    expect(h).toContain('aria-busy="true"');
    expect(h).not.toContain('<button');
  });
});

describe('可申請（S-D5）', () => {
  it('紅字申請列（error-text）在白底分組列表裡；不是 aria-disabled', () => {
    const h = page('can_apply', CAN);
    expect(h).toContain(APPLY);
    expect(h).toContain('text-error-text');
    expect(h).toContain('type="button"');
    expect(h).not.toContain('aria-disabled');
    expect(h).toContain('按下後會先請你確認一次，確認前不會送出。');
    expect(h).not.toContain('你有開店');
  });
  it('離線：列 aria-disabled、改灰字（按下用 toast 說明）', () => {
    const h = page('can_apply', CAN, { online: false });
    expect(h).toContain('aria-disabled="true"');
    expect(h).toContain('text-muted-2');
    expect(h).not.toContain('text-error-text');
  });
  it('有店：出現「你有開店」提示', () => {
    const h = page('can_apply', { kind: 'can_apply', hasShop: true });
    expect(h).toContain('你有開店');
    expect(h).toContain('店內的全部訂單與評價會一併刪除');
  });
});

describe('處理中（S-D8）與剛送出（S-D7）', () => {
  const pending: DeletionView = { kind: 'pending', request: REQ, hasShop: false };
  it('處理中：標題、申請日（台北）、預計完成日、取消申請；沒有申請鈕', () => {
    const h = page('pending', pending);
    expect(h).toContain('刪除申請處理中');
    expect(h).toContain('2026/10/26');
    expect(h).toContain('2026/11/04 前完成');
    expect(h).toContain('2026 年 11 月 4 日前完成');
    expect(h).toContain('處理完成前，你可以隨時回到這一頁取消。');
    expect(h).toContain('取消申請');
    expect(h).not.toContain(APPLY);
  });
  it('剛送出：標題是「已收到你的刪除申請」', () => {
    const h = page('pending', pending, { justSubmitted: true });
    expect(h).toContain('已收到你的刪除申請');
    expect(h).not.toContain('刪除申請處理中');
  });
  it('狀態卡標題可收焦點（tabIndex -1），日期畫面版 aria-hidden、讀屏版 sr-only', () => {
    const h = renderToStaticMarkup(<DeletionStatusCard request={REQ} justSubmitted={false} online onCancel={() => {}} />);
    expect(h).toContain('id="del-status-title"');
    expect(h).toContain('tabindex="-1"');
    expect(h).toContain('aria-hidden="true">2026/11/04 前完成');
    expect(h).toContain('sr-only">2026 年 11 月 4 日前完成');
  });
});

describe('不能申請：有未完成訂單（S-D9）', () => {
  it('買家訂單：筆數、連到我的訂單；申請列停用且指向原因', () => {
    const h = page('blocked_orders', { kind: 'blocked_orders', hasShop: false, buyerOrders: 3, shopOrders: 0 });
    expect(h).toContain('你還有 3 筆待出貨或運送中的訂單');
    expect(h).toContain('href="/orders"');
    expect(h).not.toContain('你的店還有');
    expect(h).toContain('aria-disabled="true"');
    expect(h).toContain('aria-describedby="del-block-orders"');
  });
  it('店內訂單：連到賣家中心訂單管理；有店提示也在', () => {
    const h = page('blocked_orders', { kind: 'blocked_orders', hasShop: true, buyerOrders: 0, shopOrders: 2 });
    expect(h).toContain('你的店還有 2 筆待出貨或運送中的訂單');
    expect(h).toContain('href="/seller/orders"');
    expect(h).not.toContain('你還有');
    expect(h).toContain('aria-describedby="del-block-shop"');
    expect(h).toContain('你有開店');
  });
  it('兩者都有：兩塊都出現，買家的在上', () => {
    const h = page('blocked_orders', { kind: 'blocked_orders', hasShop: true, buyerOrders: 1, shopOrders: 1 });
    expect(h.indexOf('你還有 1 筆')).toBeGreaterThan(-1);
    expect(h.indexOf('你還有 1 筆')).toBeLessThan(h.indexOf('你的店還有 1 筆'));
    expect(h).toContain('aria-describedby="del-block-orders del-block-shop"');
  });
});

describe('讀不到狀態（S-D10）', () => {
  it('在線失敗：可重試的錯誤區塊，絕不出現申請鈕', () => {
    const h = page('error', { kind: 'error' });
    expect(h).toContain('讀不到刪除申請的狀態');
    expect(h).toContain('重試');
    expect(h).toContain('role="alert"');
    expect(h).not.toContain(APPLY);
  });
  it('離線：沒有網路的提示＋重試', () => {
    const h = page('error', { kind: 'error' }, { online: false });
    expect(h).toContain('目前沒有網路');
    expect(h).toContain('重試');
    expect(h).not.toContain(APPLY);
  });
});

describe('資料庫未升級（S-D12）', () => {
  it('唯一出現「來信」的狀態：信箱連結用常數、期限用常數；沒有申請鈕、沒有英文錯誤', () => {
    const h = page('backend_missing', { kind: 'backend_missing' });
    expect(h).toContain('刪除帳號申請暫時無法在這裡送出');
    expect(h).toContain(`href="mailto:${CONTACT_EMAIL}"`);
    expect(h).toContain(`申請，我們會在 ${DELETION_WINDOW}處理。`);
    expect(h).not.toContain(APPLY);
    expect(h).not.toMatch(/Could not|schema cache|PGRST/);
  });
  it('其他狀態都不出現「來信」', () => {
    for (const [s, v] of [['can_apply', CAN], ['error', { kind: 'error' }], ['login', null], ['pending', { kind: 'pending', request: REQ, hasShop: false }]] as [Stage, DeletionView | null][]) {
      expect(page(s, v), s).not.toContain('來信');
    }
  });
});

describe('沒有 emoji（AC-X5）', () => {
  it('各狀態輸出都不含 emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [s, v] of [['can_apply', CAN], ['pending', { kind: 'pending', request: REQ, hasShop: true }], ['error', { kind: 'error' }], ['backend_missing', { kind: 'backend_missing' }]] as [Stage, DeletionView | null][]) {
      expect(emoji.test(page(s, v)), s).toBe(false);
    }
  });
});
