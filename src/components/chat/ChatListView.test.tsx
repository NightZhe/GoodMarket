import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ChatListView, { type ListHandlers, type ListModel } from './ChatListView';
import type { ConversationRow } from '../../lib/chat/types';

const noop = () => undefined;
const handlers: ListHandlers = { onRetry: noop, onLoadMore: noop, onLogin: noop, onLongPress: noop };
const model = (p: Partial<ListModel> = {}): ListModel => ({
  side: 'buyer', phase: 'ready', rows: [], hasMore: false, loadingMore: false, moreFailed: false, staleFailed: false,
  now: new Date(2026, 9, 28, 15, 0), rowTo: r => `/chat/${r.conversation_id}`, ...p,
});
const html = (p: Partial<ListModel> = {}) => renderToStaticMarkup(<MemoryRouter><ChatListView m={model(p)} h={handlers} /></MemoryRouter>);

const row = (p: Partial<ConversationRow> = {}): ConversationRow => ({
  conversation_id: 'c1',
  counterpart: { kind: 'shop', deleted: false, shop_id: 's1', name: '好物小舖', avatar: null },
  last_message: { side: 'shop', mine: false, text: '有的，兩件', photo_count: 0, card_type: null, at: new Date(2026, 9, 28, 9, 2).toISOString() },
  last_message_at: new Date(2026, 9, 28, 9, 2).toISOString(), unread_count: 0, blocked_by_me: false, ...p,
});

describe('聊聊列表的狀態（§8.1、設計 3.2）', () => {
  it('載入中：靜態灰塊，讀屏念「載入中」', () => {
    expect(html({ phase: 'loading' })).toContain('載入中');
  });
  it('買家空狀態：原文一整句＋去逛逛', () => {
    const h = html();
    expect(h).toContain('還沒有對話。到商品頁按『聊聊』就能問店家。');
    expect(h).toContain('去逛逛');
  });
  it('賣家空狀態：「還沒有買家傳訊息。」沒有按鈕', () => {
    const h = html({ side: 'shop' });
    expect(h).toContain('還沒有買家傳訊息。');
    expect(h).not.toContain('去逛逛');
  });
  it('未登入：登入提示與登入鈕', () => {
    const h = html({ phase: 'login' });
    expect(h).toContain('登入後就能和店家聊聊');
    expect(h).toContain('登入或註冊');
  });
  it('降級（R-M24）：「聊聊暫時無法使用，請稍後再試」，沒有按鈕', () => {
    const h = html({ phase: 'unavailable' });
    expect(h).toContain('聊聊暫時無法使用，請稍後再試');
    expect(h).not.toContain('<button');
  });
  it('讀取失敗：說明與重試', () => {
    const h = html({ phase: 'error' });
    expect(h).toContain('聊聊暫時無法載入');
    expect(h).toContain('請檢查網路後再試一次。');
    expect(h).toContain('重試');
  });
  it('已有資料時重讀失敗：頂端提示＋重試，列表照舊', () => {
    const h = html({ rows: [row()], staleFailed: true });
    expect(h).toContain('聊聊暫時無法更新');
    expect(h).toContain('好物小舖');
  });
});

describe('聊聊列表的每一列', () => {
  it('店名、最後一則、時間；整列連到對話；沒有未讀不出現徽章', () => {
    const h = html({ rows: [row()] });
    expect(h).toContain('好物小舖');
    expect(h).toContain('有的，兩件');
    expect(h).toContain('09:02');
    expect(h).toContain('href="/chat/c1"');
    expect(h).not.toContain('bg-badge');
  });
  it('有未讀：數字徽章；超過 99 顯示 99+；朗讀整列含未讀數', () => {
    expect(html({ rows: [row({ unread_count: 2 })] })).toContain('>2<');
    const h = html({ rows: [row({ unread_count: 120 })] });
    expect(h).toContain('99+');
    expect(html({ rows: [row({ unread_count: 2 })] })).toContain('aria-label="好物小舖，2 則未讀，最後訊息：有的，兩件，09:02"');
  });
  it('摘要代字：圖片、商品、訂單；自己送的加「你：」', () => {
    const last = (p: object) => ({ side: 'shop' as const, mine: false, text: null, photo_count: 0, card_type: null, at: '2026-10-28T01:00:00.000Z', ...p });
    expect(html({ rows: [row({ last_message: last({ photo_count: 1 }) })] })).toContain('[圖片]');
    expect(html({ rows: [row({ last_message: last({ card_type: 'product' }) })] })).toContain('[商品]');
    expect(html({ rows: [row({ last_message: last({ card_type: 'order' }) })] })).toContain('[訂單]');
    expect(html({ rows: [row({ last_message: last({ text: '好的', mine: true }) })] })).toContain('你：好的');
  });
  it('已封鎖的對話有「已封鎖」標籤；店已關閉顯示「已關閉的賣場」', () => {
    expect(html({ rows: [row({ blocked_by_me: true })] })).toContain('已封鎖');
    const gone = html({ rows: [row({ counterpart: { kind: 'shop', deleted: true, shop_id: null, name: null, avatar: null } })] });
    expect(gone).toContain('已關閉的賣場');
  });
  it('店家看買家：暱稱，沒有暱稱就「買家 ＋ 4 碼」', () => {
    const buyer = (nickname: string | null) => row({ counterpart: { kind: 'buyer', deleted: false, nickname, short_code: '3F9A' } });
    expect(html({ side: 'shop', rows: [buyer('小明')] })).toContain('小明');
    expect(html({ side: 'shop', rows: [buyer(null)] })).toContain('買家 3F9A');
  });
  it('賣家桌機雙欄：右邊開著的那一列是選中（淡底＋aria-current），其他列不是', () => {
    const h = html({ side: 'shop', rows: [row({ conversation_id: 'c1' }), row({ conversation_id: 'c2' })], selectedId: 'c2' });
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/chat\/c2"|<a [^>]*href="\/chat\/c2"[^>]*aria-current="page"/);
    expect(html({ rows: [row()] })).not.toContain('aria-current');
  });
  it('列高至少 72（min-h-18）', () => {
    expect(html({ rows: [row()] })).toContain('min-h-18');
  });
  it('還有下一頁：底部有載入中', () => {
    expect(html({ rows: [row()], hasMore: true, loadingMore: true })).toContain('載入中');
    expect(html({ rows: [row()], hasMore: true, moreFailed: true })).toContain('載入失敗，點此重試');
  });
});

describe('脈絡列（D10、spec B3）：名稱下方、摘要上方一行小字', () => {
  const orderCard = { type: 'order' as const, id: 'o1', title: 'Switch 寶可夢', order_no: '261028SRPA9T6C' };
  const productCard = { type: 'product' as const, id: 'p1', title: '【Jy】Switch 任天堂 NS 咚奇剛', order_no: null };
  it('訂單卡：「訂單 #末 6 碼 · 商品名」；朗讀整列也含這一句', () => {
    const h = html({ side: 'shop', rows: [row({ counterpart: { kind: 'buyer', deleted: false, nickname: null, short_code: '31B3' }, last_card: orderCard })] });
    expect(h).toContain('訂單 #PA9T6C · Switch 寶可夢');
    expect(h).toContain('aria-label="買家 31B3，訂單 #PA9T6C · Switch 寶可夢，最後訊息：有的，兩件，09:02"');
  });
  it('商品卡：只有商品名；買家列表看店家時也顯示', () => {
    const h = html({ rows: [row({ last_card: productCard })] });
    expect(h).toContain('【Jy】Switch 任天堂 NS 咚奇剛');
    expect(h).toMatch(/好物小舖[\s\S]*【Jy】Switch 任天堂 NS 咚奇剛[\s\S]*有的，兩件/);
  });
  it('單行截斷：脈絡列是 truncate 的小字（text-xs text-muted）', () => {
    expect(html({ rows: [row({ last_card: productCard })] })).toContain('class="block truncate text-xs text-muted"');
  });
  it('沒有卡（null）或舊資料庫沒這個鍵（undefined）：不渲染那一行，版面與原本相同', () => {
    const withNull = html({ rows: [row({ last_card: null })] });
    const withoutKey = html({ rows: [row()] });
    expect(withNull).not.toContain('text-xs text-muted');
    expect(withNull).toBe(withoutKey);
  });
});
