import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LeaveDialog, { tabWrapTarget } from './LeaveDialog';

// QA B-1：Tab 要在對話框內循環。判斷「頭」「尾」一律看按鈕在 DOM 裡的順序（Tab 就是照 DOM 順序走），
// 不看哪顆是安全選項（安全選項在 DOM 裡是後面那顆）。

describe('tabWrapTarget：焦點在最後一顆按 Tab 回到第一顆，在第一顆按 Shift+Tab 回到最後一顆', () => {
  const items = ['A', 'B', 'C'];
  it('Tab：最後一顆 → 第一顆；其餘位置交給瀏覽器（null）', () => {
    expect(tabWrapTarget(items, 'C', false)).toBe('A');
    expect(tabWrapTarget(items, 'A', false)).toBeNull();
    expect(tabWrapTarget(items, 'B', false)).toBeNull();
  });
  it('Shift+Tab：第一顆 → 最後一顆；其餘交給瀏覽器', () => {
    expect(tabWrapTarget(items, 'A', true)).toBe('C');
    expect(tabWrapTarget(items, 'C', true)).toBeNull();
    expect(tabWrapTarget(items, 'B', true)).toBeNull();
  });
  it('焦點已經在對話框外：Tab 拉回第一顆、Shift+Tab 拉回最後一顆', () => {
    expect(tabWrapTarget(items, 'outside', false)).toBe('A');
    expect(tabWrapTarget(items, 'outside', true)).toBe('C');
  });
  it('兩顆按鈕：Tab 與 Shift+Tab 各自在兩端循環', () => {
    expect(tabWrapTarget(['x', 'y'], 'y', false)).toBe('x');
    expect(tabWrapTarget(['x', 'y'], 'x', true)).toBe('y');
  });
  it('沒有按鈕：不處理', () => {
    expect(tabWrapTarget([], 'a', false)).toBeNull();
  });
});

describe('LeaveDialog 的實際 DOM 順序（預設焦點在安全選項時按 Tab 不能跑出對話框）', () => {
  const html = renderToStaticMarkup(
    <LeaveDialog title="t" description="d" stayLabel="保留申請" leaveLabel="撤回申請" onStay={() => {}} onLeave={() => {}} />,
  );
  const labels = [...html.matchAll(/<button[^>]*>(?:<svg.*?<\/svg>)?([^<]+)<\/button>/g)].map(m => m[1]);
  it('按鈕順序是 leave 在前、stay 在後（這是 Tab 的順序）', () => {
    expect(labels).toEqual(['撤回申請', '保留申請']);
  });
  it('焦點在 stay（開啟時的預設）按 Tab → 回到 leave；按 Shift+Tab 不攔（瀏覽器移到 leave）', () => {
    expect(tabWrapTarget(labels, '保留申請', false)).toBe('撤回申請');
    expect(tabWrapTarget(labels, '保留申請', true)).toBeNull();
  });
  it('焦點在 leave 按 Shift+Tab → 回到 stay；按 Tab 不攔', () => {
    expect(tabWrapTarget(labels, '撤回申請', true)).toBe('保留申請');
    expect(tabWrapTarget(labels, '撤回申請', false)).toBeNull();
  });
});
