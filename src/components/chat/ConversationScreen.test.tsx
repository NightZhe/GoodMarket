import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ConversationScreen, { type ScreenHandlers, type ScreenModel } from './ConversationScreen';
import type { DisplayMessage } from '../../lib/chat/outbox';
import type { ChatCard } from '../../lib/chat/types';

const noop = () => undefined;
const handlers: ScreenHandlers = {
  onOpenMenu: noop, onUnblock: noop, onDismissRules: noop, onSend: noop, onResend: noop, onRemoveCard: noop, onLoadMore: noop,
  onRetryLoad: noop, onRetryMessages: noop, onLogin: noop, onFocusChange: noop,
  cardTo: c => (c.type === 'product' ? `/product/${c.id}` : '/orders'), cardGone: () => false, onCardGone: noop, onBrokenImage: noop, onOpenImage: noop,
};
const shopPeer = { name: '好物小舖', letter: '好物小舖', deleted: false, shopId: 's1' };
const model = (p: Partial<ScreenModel> = {}): ScreenModel => ({
  side: 'buyer', phase: 'ready', online: true, peer: shopPeer, blockedByMe: false, peerDeleted: false, hasMenu: true,
  messages: [], hasMore: false, loadingMore: false, moreFailed: false, messagesFailed: false, pendingCard: null, cardRemovable: true,
  rulesVisible: false, urls: {}, signFailed: false, incoming: null, failure: null, unblockBusy: false, focusToken: 0,
  backTo: '/chat', backLabel: '聊聊', listTo: '/chat', homeTo: '/', ordersTo: '/orders', ...p,
});
const html = (p: Partial<ScreenModel> = {}, h: Partial<ScreenHandlers> = {}) =>
  renderToStaticMarkup(<MemoryRouter><ConversationScreen m={model(p)} h={{ ...handlers, ...h }} /></MemoryRouter>);

const msg = (p: Partial<DisplayMessage>): DisplayMessage => ({
  key: 'k', clientId: 'k', id: 'm', seq: 1, mine: false, side: 'shop', text: '有現貨嗎？', card: null, photos: [], photosAreLocal: false,
  at: '2026-10-27T11:50:00.000Z', state: 'sent', failure: null, ...p,
});
const product: ChatCard = { type: 'product', id: 'p1', title: '【Jy】Switch 任天堂 NS 咚奇剛', image: '', price: 1000 };
const order: ChatCard = { type: 'order', id: 'o1', order_no: '261028SRPA9T6C', title: 'Switch 寶可夢', image: '', item_count: 2, total: 1537, status: 'to_ship' };

describe('對話頁：基本版面（§8.2、設計 4.1）', () => {
  it('導覽列：返回聊聊、店名連到店家頁、更多選項；三個地標與兩個 live region 一進頁就在', () => {
    const h = html();
    expect(h).toContain('aria-label="返回聊聊"');
    expect(h).toContain('href="/shop/s1"');
    expect(h).toContain('aria-label="前往『好物小舖』的店家頁"');
    expect(h).toContain('aria-label="更多選項"');
    expect(h).toContain('aria-label="訊息"');
    expect(h).toContain('aria-label="傳送訊息"');
    expect(h).toContain('role="status" aria-live="polite"');
    expect(h).toContain('role="alert"');
  });
  it('對話還不存在（新對話、還沒送過）時沒有更多選項：沒有東西可以封鎖或隱藏', () => {
    expect(html({ hasMenu: false })).not.toContain('更多選項');
  });
  it('賣家端沒有店家連結（賣家沒有買家頁）', () => {
    const h = html({ side: 'shop', peer: { name: '小明', letter: '小明', deleted: false, shopId: null } });
    expect(h).toContain('小明');
    expect(h).not.toContain('店家頁');
  });
});

describe('載入中與空狀態', () => {
  it('載入中：靜態灰塊＋「載入中」，輸入列已存在但停用', () => {
    const h = html({ phase: 'loading', peer: null, fallbackName: '好物小舖' });
    expect(h).toContain('載入中');
    expect(h).toContain('好物小舖');
    expect(h).toMatch(/<textarea[^>]* disabled=""/);
  });
  it('買家的空對話：打聲招呼；賣家的空對話：傳訊息給買家', () => {
    expect(html()).toContain('還沒有訊息，傳一則打聲招呼吧。');
    expect(html({ side: 'shop' })).toContain('還沒有訊息，傳一則訊息給買家吧。');
  });
  it('訊息讀不到但對話存在：訊息區顯示失敗與重試，輸入列照常可用', () => {
    const h = html({ messagesFailed: true });
    expect(h).toContain('訊息載入失敗');
    expect(h).toContain('重試');
    expect(h).not.toMatch(/<textarea[^>]* disabled=""/);
  });
});

describe('訊息與送出狀態（D26、AC-M23）', () => {
  it('對方在左灰底、自己在右淡橘底；每則有時間，日期分隔「今天／昨天」之外用月日', () => {
    const h = html({ messages: [msg({ key: 'a' }), msg({ key: 'b', mine: true, side: 'buyer', text: '有的，兩件', at: '2026-10-27T11:54:00.000Z' })] });
    expect(h).toContain('bg-canvas');
    expect(h).toContain('bg-tab-sel');
    expect(h).toContain('有現貨嗎？');
    expect(h).toContain('有的，兩件');
    expect(h).toContain('<time');
  });
  it('朗讀前綴：誰、時間、狀態', () => {
    const h = html({ messages: [msg({ key: 'a' }), msg({ key: 'b', mine: true, side: 'buyer', text: '有的', state: 'sending' })] });
    expect(h).toMatch(/好物小舖，\d\d:\d\d：/);
    expect(h).toMatch(/你，\d\d:\d\d，傳送中：/);
    expect(h).toContain('傳送中');
  });
  it('失敗：訊息下方「無法傳送」＋「重送」；送太快有自己的說法；沒有任何已讀標示', () => {
    const failed = html({ messages: [msg({ mine: true, side: 'buyer', state: 'failed', failure: 'CANNOT_SEND' })] });
    expect(failed).toContain('無法傳送');
    expect(failed).toContain('重送');
    const fast = html({ messages: [msg({ mine: true, side: 'buyer', state: 'failed', failure: 'RATE_LIMITED' })] });
    expect(fast).toContain('送太快了，稍後再試');
    expect(failed).not.toContain('已讀');
    expect(html({ messages: [msg({ mine: true, side: 'buyer', state: 'sent' })] })).not.toContain('已讀');
  });
  it('已送出（單勾）只代表伺服器收到了：朗讀「已送出」', () => {
    expect(html({ messages: [msg({ mine: true, side: 'buyer', state: 'sent' })] })).toContain('已送出：');
  });
  it('圖片訊息：按鈕＋alt「圖片」；多張念「圖片 2／3」', () => {
    const h = html({ messages: [msg({ text: null, photos: ['a.jpg', 'b.jpg', 'c.jpg'], photosAreLocal: true })] });
    expect(h).toContain('aria-label="圖片 2／3"');
    expect(html({ messages: [msg({ text: null, photos: ['a.jpg'], photosAreLocal: true })] })).toContain('alt="圖片"');
  });
  it('訊息裡的卡片：商品卡連到商品頁、訂單卡連到訂單；快照價格；下架時顯示「商品已下架」且不是連結', () => {
    const p = html({ messages: [msg({ text: null, card: product })] });
    expect(p).toContain('href="/product/p1"');
    expect(p).toContain('$1,000');
    expect(p).toContain('商品卡，【Jy】Switch 任天堂 NS 咚奇剛，1000 元');
    const gone = html({ messages: [msg({ text: null, card: product })] }, { cardGone: () => true });
    expect(gone).toContain('商品已下架');
    expect(gone).not.toContain('href="/product/p1"');
    const o = html({ messages: [msg({ text: null, card: order })] });
    expect(o).toContain('href="/orders"');
    expect(o).toContain('訂單 <span class="font-mono">#261028SRPA9T6C</span>');
    expect(o).toContain('送出時狀態：待出貨');
    expect(html({ messages: [msg({ text: null, card: order })] }, { cardGone: () => true })).toContain('找不到訂單');
  });
  it('往上還有更早的訊息：頂端有載入中；載入失敗有重試', () => {
    expect(html({ messages: [msg({})], hasMore: true, loadingMore: true })).toContain('載入中');
    expect(html({ messages: [msg({})], hasMore: true, moreFailed: true })).toContain('載入更早的訊息失敗，點此重試');
  });
});

describe('封鎖、對方不存在、離線（D22、R-M17、AC-M24）', () => {
  it('我封鎖了對方：橫幅「你已封鎖此用戶」＋「解除封鎖」，輸入列停用', () => {
    const h = html({ blockedByMe: true });
    expect(h).toContain('你已封鎖此用戶');
    expect(h).toContain('解除封鎖');
    expect(h).toContain('placeholder="解除封鎖後才能傳送"');
    expect(h).toMatch(/<textarea[^>]* disabled=""/);
  });
  it('被封鎖方什麼都不顯示：沒有橫幅、輸入列照常可用（送出後才變「無法傳送」）', () => {
    const h = html({ blockedByMe: false });
    expect(h).not.toContain('封鎖');
    expect(h).not.toMatch(/<textarea[^>]* disabled=""/);
  });
  it('對方不存在：買家看到「此賣場已關閉」、店家看到「此帳號已刪除」，歷史照看、輸入列停用', () => {
    const buyer = html({ peerDeleted: true, peer: { name: '已關閉的賣場', letter: '', deleted: true, shopId: null }, messages: [msg({})] });
    expect(buyer).toContain('此賣場已關閉');
    expect(buyer).toContain('有現貨嗎？');
    expect(buyer).toContain('placeholder="無法傳送"');
    expect(buyer).toMatch(/<textarea[^>]* disabled=""/);
    expect(html({ side: 'shop', peerDeleted: true, peer: { name: '已刪除的帳號', letter: '', deleted: true, shopId: null } })).toContain('此帳號已刪除');
  });
  it('離線：頂部「目前離線，無法傳送」、輸入列停用、已顯示的訊息還在；離線優先於其他狀態列', () => {
    const h = html({ online: false, blockedByMe: true, messages: [msg({})] });
    expect(h).toContain('目前離線，無法傳送');
    expect(h).toContain('placeholder="目前離線"');
    expect(h).toContain('有現貨嗎？');
    expect(h).not.toContain('你已封鎖此用戶');
    expect(h).toMatch(/<textarea[^>]* disabled=""/);
  });
  it('離線與對方不存在時，輸入列的停用原因由 aria-describedby 念出來', () => {
    expect(html({ online: false })).toMatch(/<textarea[^>]*aria-describedby="[^"]+"/);
  });
});

describe('規則提示（§10.2、AC-M38）', () => {
  it('還沒關閉：顯示全文與關閉鈕', () => {
    const h = html({ rulesVisible: true });
    expect(h).toContain('為了交易安全，請勿在對話中提供電話、LINE 等聯絡方式；站外交易不受好物集保障。');
    expect(h).toContain('aria-label="關閉提示"');
  });
  it('關閉之後不再顯示', () => {
    expect(html({ rulesVisible: false })).not.toContain('為了交易安全');
  });
});

describe('輸入列與待送出卡片（D16、§6.4）', () => {
  it('商品卡待送出：小標「商品・隨訊息送出」、可移除', () => {
    const h = html({ pendingCard: product });
    expect(h).toContain('商品・隨訊息送出');
    expect(h).toContain('aria-label="移除商品卡"');
    expect(h).toContain('待送出的商品卡，【Jy】Switch 任天堂 NS 咚奇剛，1000 元，隨訊息一起送出');
  });
  it('店主從訂單發起新對話：訂單卡不可移除，並說明原因', () => {
    const h = html({ side: 'shop', pendingCard: order, cardRemovable: false });
    expect(h).toContain('訂單・隨訊息送出');
    expect(h).not.toContain('aria-label="移除訂單卡"');
    expect(h).toContain('第一則訊息會附上這筆訂單');
  });
  it('只有卡片、沒打字也能送出（R-M6）：送出鈕不是停用樣子；什麼都沒有就停用', () => {
    expect(html({ pendingCard: product })).not.toMatch(/aria-label="傳送"[^>]*aria-disabled/);
    expect(html()).toMatch(/aria-label="傳送"[^>]*aria-disabled="true"/);
  });
  it('觸控目標：圖片鈕與送出鈕 44×44', () => {
    const h = html();
    expect(h).toMatch(/aria-label="選擇圖片"[^>]*class="[^"]*size-11/);
    expect(h).toMatch(/aria-label="傳送"[^>]*class="[^"]*size-11/);
  });
  it('賣家桌機的提示語', () => {
    expect(html({ side: 'shop', desktopHint: true })).toContain('placeholder="輸入訊息，Enter 傳送"');
  });
});

describe('整頁失敗狀態（設計 4.6）：沒有輸入列', () => {
  const composer = 'aria-label="傳送訊息"';
  it('降級（資料庫未升級）：只剩說明與回聊聊', () => {
    const h = html({ phase: 'unavailable' });
    expect(h).toContain('聊聊暫時無法使用，請稍後再試');
    expect(h).toContain('回聊聊');
    expect(h).not.toContain(composer);
  });
  it('未登入：登入提示與按鈕', () => {
    const h = html({ phase: 'login' });
    expect(h).toContain('登入後就能和店家聊聊');
    expect(h).toContain('登入或註冊');
  });
  it('找不到店（買家）／找不到對話（賣家）／找不到訂單／開啟失敗', () => {
    expect(html({ phase: 'noshop' })).toContain('找不到這家商店');
    expect(html({ phase: 'noshop', side: 'shop' })).toContain('找不到這個對話');
    expect(html({ phase: 'noorder' })).toContain('找不到這筆訂單');
    const err = html({ phase: 'error' });
    expect(err).toContain('無法開啟對話');
    expect(err).toContain('請檢查網路後再試一次。');
    expect(err).toContain('重試');
    expect(err).not.toContain(composer);
  });
});
