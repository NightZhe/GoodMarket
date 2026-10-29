import { describe, expect, it } from 'vitest';
import {
  buildSendArgs, canSubmit, confirmSent, createLocal, createSendQueue, dropConfirmed, incomingAnnouncement, markFailed, mergeLatest, mergeServer, rebindToConversation,
  restart, slotsReusable, textLength, visibleMessages, pendingCardFor,
} from './outbox';
import type { ChatCard, ServerMessage } from './types';

const msg = (seq: number, p: Partial<ServerMessage> = {}): ServerMessage => ({
  id: `m${seq}`, conversation_id: 'c1', seq, side: 'shop', mine: false, client_id: `k${seq}`,
  text: `第 ${seq} 則`, card: null, photos: [], created_at: `2026-10-28T0${seq}:00:00.000Z`, ...p,
});
const seqs = (l: ServerMessage[]) => l.map(m => m.seq);

describe('伺服器訊息合併（R-M23：以訊息 id 去重）', () => {
  it('亂序進來、依 seq 由舊到新排好', () => {
    expect(seqs(mergeServer([], [msg(3), msg(1), msg(2)]))).toEqual([1, 2, 3]);
  });
  it('重複事件不造成重複顯示：同一個 id 只留一則', () => {
    const once = mergeServer([], [msg(1), msg(2)]);
    expect(seqs(mergeServer(once, [msg(2), msg(2), msg(3)]))).toEqual([1, 2, 3]);
  });
  it('重連補讀（最新一頁）接得上就併入，不丟已載入的舊訊息', () => {
    const cur = [msg(1), msg(2), msg(3)];
    const out = mergeLatest(cur, { messages: [msg(4), msg(3)], has_more: true }, true);
    expect(seqs(out.list)).toEqual([1, 2, 3, 4]);
    expect(out.hasMore).toBe(true);
  });
  it('斷線太久、最新一頁與已載入的中間有缺口：改用最新一頁，並標示往上還有更早的', () => {
    const cur = [msg(1), msg(2)];
    const out = mergeLatest(cur, { messages: [msg(40), msg(39)], has_more: true }, false);
    expect(seqs(out.list)).toEqual([39, 40]);
    expect(out.hasMore).toBe(true);
  });
  it('最新一頁一路讀到最舊（has_more=false）時，往上不再有更早的', () => {
    const out = mergeLatest([], { messages: [msg(2), msg(1)], has_more: false }, true);
    expect(seqs(out.list)).toEqual([1, 2]);
    expect(out.hasMore).toBe(false);
  });
});

const card: ChatCard = { type: 'product', id: 'p1', title: '咚奇剛', image: 'x.jpg', price: 1000 };
const base = { clientId: 'k-new', text: '有現貨嗎？', card: null, previews: [], side: 'buyer' as const, at: '2026-10-28T10:00:00.000Z', args: { p_client_id: 'k-new', p_shop_id: 's1' } };

describe('送出狀態機（D26：傳送中／已送出／失敗可重送）', () => {
  it('新送出的訊息是「傳送中」，排在伺服器訊息之後', () => {
    const view = visibleMessages([msg(1), msg(2)], [createLocal(base)]);
    expect(view.map(m => m.state)).toEqual(['sent', 'sent', 'sending']);
    expect(view[2]).toMatchObject({ mine: true, clientId: 'k-new', text: '有現貨嗎？', id: null });
  });

  it('伺服器訊息的 mine 決定左右；自己已送出的是 sent', () => {
    const view = visibleMessages([msg(1, { mine: true }), msg(2)], []);
    expect(view.map(m => m.mine)).toEqual([true, false]);
  });

  it('失敗：標記錯誤碼；重送回到「傳送中」並清掉錯誤碼，client id 不變（冪等，R-M9）', () => {
    const failed = markFailed([createLocal(base)], 'k-new', 'CANNOT_SEND');
    expect(failed[0]).toMatchObject({ state: 'failed', failure: 'CANNOT_SEND' });
    const again = restart(failed, 'k-new');
    expect(again[0]).toMatchObject({ state: 'sending', failure: null, clientId: 'k-new' });
    expect(again[0].args.p_client_id).toBe('k-new');
  });

  it('成功：本機那一筆被伺服器回傳的訊息取代，不會出現兩則（以 client id 對應）', () => {
    const server = mergeServer([msg(1)], [msg(2, { client_id: 'k-new', mine: true, text: '有現貨嗎？' })]);
    const local = confirmSent([createLocal(base)], 'k-new');
    expect(local).toEqual([]);
    expect(visibleMessages(server, local).map(m => m.text)).toEqual(['第 1 則', '有現貨嗎？']);
  });

  it('Realtime 比送出回應先到：伺服器清單已有同 client id 的訊息，本機那筆不再重複顯示', () => {
    const server = [msg(1), msg(2, { client_id: 'k-new', mine: true })];
    expect(visibleMessages(server, [createLocal(base)])).toHaveLength(2);
    expect(dropConfirmed([createLocal(base)], server)).toEqual([]);
  });

  it('多則本機訊息保持送出的先後；失敗的留在原位', () => {
    const a = createLocal({ ...base, clientId: 'a', at: '2026-10-28T10:00:00.000Z', args: { p_client_id: 'a' } });
    const b = createLocal({ ...base, clientId: 'b', text: '第二句', at: '2026-10-28T10:00:05.000Z', args: { p_client_id: 'b' } });
    const view = visibleMessages([], markFailed([a, b], 'a', null));
    expect(view.map(m => [m.clientId, m.state])).toEqual([['a', 'failed'], ['b', 'sending']]);
  });
});

describe('送出參數（§9 chat_send：三個目標參數恰好一個）', () => {
  it('買家從店家／商品進、對話還不存在：帶 p_shop_id，卡片只傳種類與 id（快照由伺服器產生）', () => {
    expect(buildSendArgs({ target: { kind: 'shop', shopId: 's1' }, conversationId: null, clientId: 'k', text: ' 有嗎 ', card })).toEqual({
      p_client_id: 'k', p_shop_id: 's1', p_text: '有嗎', p_card: { type: 'product', id: 'p1' },
    });
  });
  it('對話已存在：一律用 p_conversation_id（買家、店家都一樣）', () => {
    expect(buildSendArgs({ target: { kind: 'shop', shopId: 's1' }, conversationId: 'c1', clientId: 'k', text: 'hi', card: null })).toEqual({
      p_client_id: 'k', p_conversation_id: 'c1', p_text: 'hi',
    });
    expect(buildSendArgs({ target: { kind: 'conversation', id: 'c1' }, conversationId: 'c1', clientId: 'k', text: 'hi', card: null }).p_conversation_id).toBe('c1');
  });
  it('店家從訂單發起新對話：帶 p_order_id，且不能帶 p_card（伺服器自動附訂單卡）', () => {
    const orderCard: ChatCard = { type: 'order', id: 'o1', order_no: 'N1', title: 't', image: '', item_count: 1, total: 100, status: 'to_ship' };
    expect(buildSendArgs({ target: { kind: 'order', orderId: 'o1' }, conversationId: null, clientId: 'k', text: '缺貨了', card: orderCard })).toEqual({
      p_client_id: 'k', p_order_id: 'o1', p_text: '缺貨了',
    });
  });
  it('店家在既有對話附訂單卡：走 p_conversation_id ＋ p_card', () => {
    const orderCard: ChatCard = { type: 'order', id: 'o1', order_no: 'N1', title: 't', image: '', item_count: 1, total: 100, status: 'to_ship' };
    expect(buildSendArgs({ target: { kind: 'order', orderId: 'o1' }, conversationId: 'c1', clientId: 'k', text: '', card: orderCard })).toEqual({
      p_client_id: 'k', p_conversation_id: 'c1', p_card: { type: 'order', id: 'o1' },
    });
  });
  it('空白文字不送（R-M6：去前後空白，空就省略）', () => {
    expect('p_text' in buildSendArgs({ target: { kind: 'shop', shopId: 's1' }, conversationId: null, clientId: 'k', text: '   ', card })).toBe(false);
  });
});

describe('對話還沒建立時連續送出（第二則不能再附一張訂單卡）', () => {
  it('第一則回來、拿到對話 id 後，後續訊息改走 p_conversation_id，丟掉 p_order_id／p_shop_id', () => {
    expect(rebindToConversation({ p_client_id: 'k2', p_order_id: 'o1', p_text: '第二則' }, 'c1')).toEqual({
      p_client_id: 'k2', p_conversation_id: 'c1', p_text: '第二則',
    });
    expect(rebindToConversation({ p_client_id: 'k2', p_shop_id: 's1', p_text: 'hi' }, 'c1')).toEqual({
      p_client_id: 'k2', p_conversation_id: 'c1', p_text: 'hi',
    });
  });
  it('已經走 p_conversation_id 的不變；使用者自己附的卡片保留', () => {
    const args = { p_client_id: 'k', p_conversation_id: 'c1', p_card: { type: 'product' as const, id: 'p1' } };
    expect(rebindToConversation(args, 'c1')).toEqual(args);
  });
  it('排隊：第一則還沒回來，第二則不會開始；第一則失敗了第二則也照樣輪到', async () => {
    const q = createSendQueue();
    const log: string[] = [];
    let release!: () => void;
    const first = q.enqueue(async () => { log.push('1 開始'); await new Promise<void>(r => { release = r; }); log.push('1 結束'); throw new Error('斷網'); });
    const second = q.enqueue(async () => { log.push('2 開始'); });
    await Promise.resolve();
    expect(log).toEqual(['1 開始']);
    release();
    await expect(first).rejects.toThrow('斷網');
    await second;
    expect(log).toEqual(['1 開始', '1 結束', '2 開始']);
  });
});

describe('可不可以送出（§8.2 輸入列）', () => {
  const ok = { text: '', hasCard: false, photoCount: 0, processing: false, online: true, blockedByMe: false, peerDeleted: false };
  it('文字、卡片、圖片至少一樣非空', () => {
    expect(canSubmit(ok)).toBe(false);
    expect(canSubmit({ ...ok, text: '嗨' })).toBe(true);
    expect(canSubmit({ ...ok, hasCard: true })).toBe(true);
    expect(canSubmit({ ...ok, photoCount: 1 })).toBe(true);
    expect(canSubmit({ ...ok, text: '   ' })).toBe(false);
  });
  it('離線、我封鎖了對方、對方不存在、圖片還在處理、超過 1000 字都不能送', () => {
    const t = { ...ok, text: '嗨' };
    expect(canSubmit({ ...t, online: false })).toBe(false);
    expect(canSubmit({ ...t, blockedByMe: true })).toBe(false);
    expect(canSubmit({ ...t, peerDeleted: true })).toBe(false);
    expect(canSubmit({ ...t, photoCount: 2, processing: true })).toBe(false);
    expect(canSubmit({ ...ok, text: 'a'.repeat(1001) })).toBe(false);
    expect(canSubmit({ ...ok, text: 'a'.repeat(1000) })).toBe(true);
  });
  it('字數以 code point 算：emoji 一個字', () => {
    expect(textLength('😀😀')).toBe(2);
    expect(textLength('  好物  ')).toBe(2);
  });
});

describe('重送時的圖片位置', () => {
  const NOW = Date.parse('2026-10-28T10:00:00Z');
  it('還剩 2 分鐘以上才沿用；快過期或沒有位置就重新申請', () => {
    expect(slotsReusable([{ expires_at: '2026-10-28T10:20:00Z' }], NOW)).toBe(true);
    expect(slotsReusable([{ expires_at: '2026-10-28T10:01:00Z' }], NOW)).toBe(false);
    expect(slotsReusable([{ expires_at: '2026-10-28T10:20:00Z' }, { expires_at: '2026-10-28T09:59:00Z' }], NOW)).toBe(false);
    expect(slotsReusable([], NOW)).toBe(false);
  });
});

describe('新訊息宣告（live region 只念一次，不重念整頁）', () => {
  it('一則念內容（過長截斷）、圖片念「圖片」、卡片念種類；多則合併成一句', () => {
    expect(incomingAnnouncement([])).toBeNull();
    expect(incomingAnnouncement([msg(1, { text: '有的' })])).toBe('新訊息：有的');
    expect(incomingAnnouncement([msg(1, { text: null, photos: ['a.jpg'] })])).toBe('新訊息：圖片');
    expect(incomingAnnouncement([msg(1, { text: null, card: { type: 'order', id: 'o', order_no: 'N', title: 't', image: '', item_count: 1, total: 1, status: 'to_ship' } })])).toBe('新訊息：訂單卡');
    expect(incomingAnnouncement([msg(1, { text: 'a'.repeat(50) })])).toBe(`新訊息：${'a'.repeat(40)}…`);
    expect(incomingAnnouncement([msg(1), msg(2), msg(3)])).toBe('收到 3 則新訊息');
  });
});

describe('待送出卡片只在對話最後一則已是這張卡時才不出現（B2：回前景重讀不重複附卡；隔幾天再聊聊仍要有卡）', () => {
  const product: ChatCard = { type: 'product', id: 'p1', title: 'A', image: '', price: 100 };
  const order: ChatCard = { type: 'order', id: 'o1', order_no: 'N1', title: 'A', image: '', item_count: 1, total: 100, status: 'to_ship' };
  const sentLocal = (card: ChatCard) => createLocal({
    clientId: 'k', side: 'buyer', text: 'hi', card, previews: [], at: '2026-10-28T00:00:00.000Z',
    args: buildSendArgs({ target: { kind: 'shop', shopId: 's', productId: 'p1' }, conversationId: null, clientId: 'k', text: 'hi', card }),
  });

  it('對話裡沒有這張卡的訊息：照伺服器給的待送出卡片', () => {
    expect(pendingCardFor(product, [msg(1), msg(2, { card: order })], [])).toEqual(product);
  });
  it('最後一則（依 seq 最新）已是同一張卡（種類與 id 都相同）：不再待送出', () => {
    expect(pendingCardFor(product, [msg(1, { card: product })], [])).toBeNull();
    expect(pendingCardFor(order, [msg(1), msg(2, { card: order })], [])).toBeNull();
  });
  it('最後一則是對方文字、更早有同卡：仍待送出（幾天後再從同一商品頁按聊聊）', () => {
    expect(pendingCardFor(product, [msg(1, { card: product }), msg(2, { text: '還在嗎', mine: false })], [])).toEqual(product);
  });
  it('最後一則是自己送的同卡：不待送出，且不依陣列順序而依 seq', () => {
    expect(pendingCardFor(product, [msg(3, { card: product, mine: true }), msg(1, { text: '嗨' })], [])).toBeNull();
  });
  it('同 id 但種類不同不算同一張', () => {
    expect(pendingCardFor({ ...product, id: 'x' }, [msg(1, { card: { ...order, id: 'x' } })], [])).not.toBeNull();
  });
  it('本機剛送出（傳送中或失敗待重送）的訊息帶著這張卡：也不再待送出', () => {
    expect(pendingCardFor(product, [], [sentLocal(product)])).toBeNull();
    expect(pendingCardFor(product, [msg(1, { text: '嗨', mine: false })], [sentLocal(product)])).toBeNull();
  });
  it('伺服器沒給待送出卡片：維持沒有', () => {
    expect(pendingCardFor(null, [msg(1)], [])).toBeNull();
  });
});
