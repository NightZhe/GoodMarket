/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// B5：iOS 聚焦字級小於 16px 的輸入框會把整頁放大。修法是 App 內（html.native）全站輸入框字級提到 1rem，而不是擋縮放。
// vitest 會把 .css 載入成空字串，所以直接用 fs 讀檔（同 railGeometry.test.ts）。
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CSS = read('../../index.css');
const HTML = read('../../../index.html');

// 找出把輸入框字級設成 1rem 的那條規則（選擇器＋宣告區塊）。
const RULE = /(html\.native\s+:is\(textarea,\s*select,\s*input[^{]*)\{\s*font-size:\s*1rem;\s*\}/.exec(CSS);

describe('App 內輸入框字級', () => {
  it('有一條 html.native 底下的全站規則，把 textarea／select／input 設為 1rem', () => {
    expect(RULE).not.toBeNull();
  });

  it('規則寫在 @layer 之外（才勝得過 Tailwind utilities 層的 text-sm）', () => {
    const idx = CSS.indexOf(RULE![0]);
    let depth = 0;
    for (const ch of CSS.slice(0, idx)) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    expect(depth).toBe(0);
  });

  it('文字輸入的 type 都吃得到：沒有排除 text／number／tel／email／password／search', () => {
    const selector = RULE![1];
    for (const t of ['text', 'number', 'tel', 'email', 'password', 'search']) {
      expect(selector).not.toContain(`[type="${t}"]`);
    }
  });

  it('不動已經 ≥16px 的字級（驗證碼欄用 text-xl）', () => {
    expect(RULE![1]).toContain('.text-xl');
  });

  it('不是用擋縮放的方式處理：viewport meta 沒有 maximum-scale／user-scalable', () => {
    const meta = /<meta name="viewport"[^>]*>/.exec(HTML)?.[0] ?? '';
    expect(meta).not.toBe('');
    expect(meta).not.toMatch(/maximum-scale|user-scalable/);
  });
});
