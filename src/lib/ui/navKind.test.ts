import { beforeEach, describe, expect, it, vi } from 'vitest';

// 模組內有「這份文件是否已導覽過」旗標，每個案例都重新載入模組才是乾淨的新文件
let nav: typeof import('./navKind');
beforeEach(async () => {
  vi.resetModules();
  nav = await import('./navKind');
});

describe('navKindOf：要不要當成「返回」', () => {
  it('首次載入（文件內還沒導覽過）的 POP → go，不還原', () => {
    expect(nav.navKindOf('POP', false)).toBe('go');
  });
  it('導覽過之後的 POP（瀏覽器上一頁、iOS 邊緣滑回）→ back，還原', () => {
    expect(nav.navKindOf('POP', true)).toBe('back');
  });
  it('PUSH、REPLACE 一律 go，不管有沒有導覽過', () => {
    expect(nav.navKindOf('PUSH', false)).toBe('go');
    expect(nav.navKindOf('PUSH', true)).toBe('go');
    expect(nav.navKindOf('REPLACE', true)).toBe('go');
  });
});

describe('文件內的導覽紀錄', () => {
  it('新文件：還沒導覽過，POP 是 go（重新整理、同分頁重開網址）', () => {
    expect(nav.currentNavKind('POP')).toBe('go');
  });
  it('只收到 POP（首次載入）仍然沒導覽過', () => {
    nav.recordNavigation('POP');
    expect(nav.currentNavKind('POP')).toBe('go');
  });
  it('收過 PUSH 之後的 POP → back', () => {
    nav.recordNavigation('POP');
    nav.recordNavigation('PUSH');
    expect(nav.currentNavKind('POP')).toBe('back');
  });
  it('收過 REPLACE 之後的 POP → back', () => {
    nav.recordNavigation('REPLACE');
    expect(nav.currentNavKind('POP')).toBe('back');
  });
});
