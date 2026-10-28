import { describe, expect, it } from 'vitest';
import { badgeCount, chatNavLabel, formatUnread, unreadConversationCount, unreadOverview } from './unread';
import { EMPTY_SUMMARY } from './types';

describe('未讀與角標（R-M13、AC-M16～M19）', () => {
  it('角標＝有未讀的對話數；0 不顯示、超過 99 顯示 99+', () => {
    expect(formatUnread(0)).toBe('');
    expect(formatUnread(1)).toBe('1');
    expect(formatUnread(99)).toBe('99');
    expect(formatUnread(100)).toBe('99+');
  });

  it('數對話不是數訊息：同一條對話 3 則未讀算 1', () => {
    const rows = [{ unread_count: 3 }, { unread_count: 0 }, { unread_count: 1 }];
    expect(unreadConversationCount(rows)).toBe(2);
  });

  it('買家端只算買家側、賣家端只算店家側（同一帳號雙身分，AC-M18）', () => {
    const s = { buyer_conversations: 2, shop_conversations: 5, shop_messages: 17 };
    expect(badgeCount(s, 'buyer')).toBe(2);
    expect(badgeCount(s, 'shop')).toBe(5);
    expect(badgeCount(EMPTY_SUMMARY, 'buyer')).toBe(0);
  });

  it('朗讀名稱：0＝聊聊；N＝聊聊，N 條未讀；超過 99＝99 條以上', () => {
    expect(chatNavLabel(0)).toBe('聊聊');
    expect(chatNavLabel(3)).toBe('聊聊，3 條未讀');
    expect(chatNavLabel(99)).toBe('聊聊，99 條未讀');
    expect(chatNavLabel(100)).toBe('聊聊，99 條以上未讀');
  });

  it('資料壞掉（負數、非數字）一律當 0，不讓角標出現 NaN', () => {
    expect(badgeCount({ buyer_conversations: -2, shop_conversations: Number.NaN, shop_messages: 0 }, 'buyer')).toBe(0);
    expect(badgeCount({ buyer_conversations: 1, shop_conversations: Number.NaN, shop_messages: 0 }, 'shop')).toBe(0);
  });

  it('總覽提示卡：N 則未讀訊息；0 不出現、超過 99 照實顯示（不封頂，99+ 只用在角標）', () => {
    expect(unreadOverview(0)).toBeNull();
    expect(unreadOverview(6)).toBe('你有 6 則未讀訊息');
    expect(unreadOverview(120)).toBe('你有 120 則未讀訊息');
    expect(unreadOverview(123)).toBe('你有 123 則未讀訊息');
  });
});
