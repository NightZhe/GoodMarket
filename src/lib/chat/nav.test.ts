import { describe, expect, it } from 'vitest';
import {
  chatEntryVisible, conversationPath, isChatConversationPath, newChatPath, parseNewChat, peerView, buyerChatTab,
} from './nav';

describe('路由（路徑形式：列表 /chat、既有對話 /chat/:id、新對話 /chat/new?shop=…）', () => {
  it('既有對話', () => {
    expect(conversationPath('abc')).toBe('/chat/abc');
  });
  it('新對話路徑帶 shop，可選 product 或 order（只會帶一個）', () => {
    expect(newChatPath({ shopId: 's1' })).toBe('/chat/new?shop=s1');
    expect(newChatPath({ shopId: 's1', productId: 'p1' })).toBe('/chat/new?shop=s1&product=p1');
    expect(newChatPath({ shopId: 's1', orderId: 'o1' })).toBe('/chat/new?shop=s1&order=o1');
    expect(newChatPath({ shopId: 's 1&x', productId: 'p1', orderId: 'o1' })).toBe('/chat/new?shop=s%201%26x&product=p1');
  });
  it('解析新對話的查詢：缺 shop 或同時帶商品與訂單都視為無效', () => {
    expect(parseNewChat('?shop=s1&product=p1')).toEqual({ kind: 'shop', shopId: 's1', productId: 'p1' });
    expect(parseNewChat('?shop=s1&order=o1')).toEqual({ kind: 'shop', shopId: 's1', orderId: 'o1' });
    expect(parseNewChat('?shop=s1')).toEqual({ kind: 'shop', shopId: 's1' });
    expect(parseNewChat('?product=p1')).toBeNull();
    expect(parseNewChat('?shop=s1&product=p1&order=o1')).toBeNull();
    expect(parseNewChat('')).toBeNull();
  });
  it('對話頁（/chat/…）藏 tab bar；列表頁（/chat）不藏', () => {
    expect(isChatConversationPath('/chat')).toBe(false);
    expect(isChatConversationPath('/chat/')).toBe(false);
    expect(isChatConversationPath('/chat/new')).toBe(true);
    expect(isChatConversationPath('/chat/abc')).toBe(true);
    expect(isChatConversationPath('/chatter')).toBe(false);
  });
});

describe('入口鈕顯示規則（R-M24、R-M2、設計 5.1）', () => {
  const base = { availability: 'ok' as const, ownShop: false, locallyBlocked: false, ownerKnownMissing: false };
  it('一般情況顯示', () => {
    expect(chatEntryVisible(base)).toBe(true);
  });
  it('資料庫未升級（降級）或還沒確認可用：隱藏', () => {
    expect(chatEntryVisible({ ...base, availability: 'unavailable' })).toBe(false);
    expect(chatEntryVisible({ ...base, availability: 'unknown' })).toBe(false);
  });
  it('沒有店主的店（示範資料）沒人能回覆，伺服器回 SHOP_NOT_FOUND：隱藏；還不知道有沒有店主時照常顯示', () => {
    expect(chatEntryVisible({ ...base, ownerKnownMissing: true })).toBe(false);
    expect(chatEntryVisible({ ...base, ownerKnownMissing: false })).toBe(true);
  });
  it('自己的店、本機封鎖的店：隱藏', () => {
    expect(chatEntryVisible({ ...base, ownShop: true })).toBe(false);
    expect(chatEntryVisible({ ...base, locallyBlocked: true })).toBe(false);
  });
});

describe('tab 第 4 格', () => {
  it('路徑、標籤、角標與朗讀名稱', () => {
    expect(buyerChatTab(0)).toEqual({ to: '/chat', label: '聊聊', ariaLabel: '聊聊', badge: 0 });
    expect(buyerChatTab(3)).toEqual({ to: '/chat', label: '聊聊', ariaLabel: '聊聊，3 條未讀', badge: 3 });
  });
});

describe('對話對象的顯示（設計 7.2、§6.8）', () => {
  it('買家看店：店名；店已關閉＝「已關閉的賣場」、不是連結', () => {
    expect(peerView({ kind: 'shop', deleted: false, shop_id: 's1', name: '好物小舖', avatar: null })).toEqual({ name: '好物小舖', letter: '好物小舖', deleted: false, shopId: 's1' });
    expect(peerView({ kind: 'shop', deleted: true, shop_id: null, name: null, avatar: null })).toEqual({ name: '已關閉的賣場', letter: '', deleted: true, shopId: null });
  });
  it('店家看買家：有暱稱用暱稱；沒有就「買家 ＋ 4 碼」，頭像用「買」', () => {
    expect(peerView({ kind: 'buyer', deleted: false, nickname: '小明', short_code: '3F9A' })).toEqual({ name: '小明', letter: '小明', deleted: false, shopId: null });
    expect(peerView({ kind: 'buyer', deleted: false, nickname: null, short_code: '3F9A' })).toEqual({ name: '買家 3F9A', letter: '買', deleted: false, shopId: null });
    expect(peerView({ kind: 'buyer', deleted: true, nickname: null, short_code: null })).toEqual({ name: '已刪除的帳號', letter: '', deleted: true, shopId: null });
  });
});
