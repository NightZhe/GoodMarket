import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SellerChatFrame from './SellerChatFrame';

const render = (p: { split: boolean; onThread: boolean }) => renderToStaticMarkup(
  <SellerChatFrame split={p.split} onThread={p.onThread} list={<p>列表內容</p>} thread={<p>對話內容</p>} />,
);

describe('賣家聊聊的版面框（AC-M37、設計 7.1）', () => {
  it('手機、列表頁：只有列表，沒有對話', () => {
    const h = render({ split: false, onThread: false });
    expect(h).toContain('列表內容');
    expect(h).not.toContain('對話內容');
    expect(h).not.toContain('選擇左側的對話開始回覆');
  });

  it('手機、對話頁：只有對話（整頁），沒有列表', () => {
    const h = render({ split: false, onThread: true });
    expect(h).toContain('對話內容');
    expect(h).not.toContain('列表內容');
  });

  it('桌機、還沒選對話：左列表、右邊是「選擇左側的對話開始回覆」', () => {
    const h = render({ split: true, onThread: false });
    expect(h).toContain('列表內容');
    expect(h).toContain('選擇左側的對話開始回覆');
    expect(h).not.toContain('對話內容');
  });

  it('桌機、選了對話：左列表右對話，左欄在對話之前（朗讀與 Tab 順序）', () => {
    const h = render({ split: true, onThread: true });
    expect(h.indexOf('列表內容')).toBeGreaterThanOrEqual(0);
    expect(h.indexOf('列表內容')).toBeLessThan(h.indexOf('對話內容'));
    expect(h).not.toContain('選擇左側的對話開始回覆');
  });

  it('桌機：兩欄各自捲動（左欄 overflow-y-auto、整張卡固定高度），左欄寬 20rem', () => {
    const h = render({ split: true, onThread: true });
    expect(h).toContain('w-80');
    expect(h).toContain('overflow-y-auto');
    expect(h).toContain('h-[calc(100dvh-3.5rem-3rem)]');
  });
});
