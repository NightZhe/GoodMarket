import { describe, expect, it } from 'vitest';
import { SELLER_CHAT_LIST_PATH, parseSellerNewChat, sellerConversationPath, sellerNewChatPath } from './sellerPaths';

describe('賣家中心聊聊的路徑（§8.5、§6.4）', () => {
  it('列表與既有對話', () => {
    expect(SELLER_CHAT_LIST_PATH).toBe('/seller/chat');
    expect(sellerConversationPath('c1')).toBe('/seller/chat/c1');
    expect(sellerConversationPath('a/b c')).toBe('/seller/chat/a%2Fb%20c');
  });

  it('從訂單進：/seller/chat/new?order=…（賣家唯一的發起入口）', () => {
    expect(sellerNewChatPath('o1')).toBe('/seller/chat/new?order=o1');
    expect(sellerNewChatPath('o 1&x')).toBe('/seller/chat/new?order=o%201%26x');
  });

  it('解析：往返一致，缺 order 或空字串都無效', () => {
    expect(parseSellerNewChat('?order=o1')).toEqual({ kind: 'order', orderId: 'o1' });
    expect(parseSellerNewChat('?order=o%201%26x')).toEqual({ kind: 'order', orderId: 'o 1&x' });
    expect(parseSellerNewChat('')).toBeNull();
    expect(parseSellerNewChat('?order=')).toBeNull();
    expect(parseSellerNewChat('?shop=s1')).toBeNull();
  });
});
