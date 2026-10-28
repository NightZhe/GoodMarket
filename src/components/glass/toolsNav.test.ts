/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AC-15：控制欄是「一個有名稱的導覽區域」。第二層頁（商品、購物車）沒有分頁組，直立軌只剩工具組，
// 工具組要自己是有名稱的 <nav>，不能只是 role="group"（QA1 O4）。沒有元件渲染環境，讀原始碼釘住。
const src = readFileSync(new URL('./GlassCapsule.tsx', import.meta.url), 'utf8');
const toolsBody = /function ToolsBody[\s\S]*?\n}\n/.exec(src)?.[0] ?? '';

describe('直立軌工具組是有名稱的導覽區域（QA1 O4）', () => {
  it('ToolsBody 渲染成 <nav aria-label={label}>，不是 role="group"', () => {
    expect(toolsBody).toMatch(/<nav\b[^>]*aria-label=\{label\}/);
    expect(toolsBody).not.toContain('role="group"');
  });

  it('分頁組仍是各自有名稱的 <nav>（首頁的「主要分頁」不變）', () => {
    expect(/function TabsBody[\s\S]*$/.exec(src)?.[0]).toMatch(/<nav\b[\s\S]*?aria-label=\{label\}/);
  });
});
