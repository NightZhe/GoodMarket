import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../auth/pending';
import { BLOCK_KEY, BLOCK_LIMIT, addBlocked, parseBlocked, readBlocked, removeBlocked } from './store';
import { visibleProducts } from './filter';
import { blockedDate } from './format';

const mem = (opts: { failWrite?: boolean } = {}): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { if (opts.failWrite) throw new Error('blocked'); data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
};

const NOW = 1_800_000_000_000;

// R-K11、AC-K18、AC-K20：封鎖只存在這台裝置；儲存值壞掉當空清單；第 201 家擋下
describe('封鎖清單的讀寫', () => {
  it('封鎖後讀得到；值的格式是 { v:1, shops:[{id,name,at}] }', () => {
    const s = mem();
    expect(addBlocked(s, { id: 'a', name: '好物小舖' }, NOW)).toBe('ok');
    expect(readBlocked(s)).toEqual([{ id: 'a', name: '好物小舖', at: NOW }]);
    expect(JSON.parse(s.data.get(BLOCK_KEY)!)).toEqual({ v: 1, shops: [{ id: 'a', name: '好物小舖', at: NOW }] });
  });
  it('同一家再封鎖一次：不重複、不佔額度、回成功', () => {
    const s = mem();
    addBlocked(s, { id: 'a', name: 'A' }, NOW);
    expect(addBlocked(s, { id: 'a', name: 'A2' }, NOW + 1)).toBe('ok');
    expect(readBlocked(s)).toEqual([{ id: 'a', name: 'A', at: NOW }]);
  });
  it('取消封鎖：只移除那一家；沒封鎖過的取消也算成功', () => {
    const s = mem();
    addBlocked(s, { id: 'a', name: 'A' }, NOW);
    addBlocked(s, { id: 'b', name: 'B' }, NOW);
    expect(removeBlocked(s, 'a')).toBe(true);
    expect(readBlocked(s).map(x => x.id)).toEqual(['b']);
    expect(removeBlocked(s, 'zzz')).toBe(true);
  });
  it('上限 200 家：第 201 家回 full、不寫入', () => {
    const s = mem();
    for (let i = 0; i < BLOCK_LIMIT; i++) expect(addBlocked(s, { id: `s${i}`, name: `店${i}` }, NOW)).toBe('ok');
    expect(addBlocked(s, { id: 'extra', name: '多一家' }, NOW)).toBe('full');
    expect(readBlocked(s)).toHaveLength(BLOCK_LIMIT);
    expect(readBlocked(s).some(x => x.id === 'extra')).toBe(false);
    // 已封鎖的那 200 家仍可取消，取消後又能再封鎖
    expect(removeBlocked(s, 's0')).toBe(true);
    expect(addBlocked(s, { id: 'extra', name: '多一家' }, NOW)).toBe('ok');
  });
  it('寫入失敗（私密模式）：回 failed，清單不變', () => {
    const s = mem({ failWrite: true });
    expect(addBlocked(s, { id: 'a', name: 'A' }, NOW)).toBe('failed');
    expect(readBlocked(s)).toEqual([]);
    const ok = mem();
    addBlocked(ok, { id: 'a', name: 'A' }, NOW);
    const broken: StorageLike = { getItem: ok.getItem, setItem: () => { throw new Error('x'); }, removeItem: ok.removeItem };
    expect(removeBlocked(broken, 'a')).toBe(false);
  });
  it('讀取本身丟錯也當空清單', () => {
    const s: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
    expect(readBlocked(s)).toEqual([]);
  });
});

describe('壞掉的儲存值當作空清單，不丟錯', () => {
  it.each([
    ['沒有值', null],
    ['空字串', ''],
    ['不是 JSON', '{not json'],
    ['是陣列', '[]'],
    ['是字串', '"abc"'],
    ['版本不對', '{"v":2,"shops":[]}'],
    ['shops 不是陣列', '{"v":1,"shops":"x"}'],
  ])('%s', (_label, raw) => {
    expect(parseBlocked(raw)).toEqual([]);
  });
  it('單筆壞掉只丟那一筆，其餘保留；重複的 id 只留第一筆', () => {
    const raw = JSON.stringify({
      v: 1,
      shops: [
        { id: 'a', name: 'A', at: 1 },
        { id: 7, name: '型別錯', at: 1 },
        { id: 'b', name: 'B' },
        null,
        { id: 'a', name: '重複', at: 2 },
        { id: 'c', name: 'C', at: 3 },
      ],
    });
    expect(parseBlocked(raw)).toEqual([{ id: 'a', name: 'A', at: 1 }, { id: 'c', name: 'C', at: 3 }]);
  });
  it('被手動塞超過 200 筆：只取前 200', () => {
    const shops = Array.from({ length: 250 }, (_, i) => ({ id: `s${i}`, name: 'x', at: i }));
    expect(parseBlocked(JSON.stringify({ v: 1, shops }))).toHaveLength(BLOCK_LIMIT);
  });
});

describe('visibleProducts：濾掉被封鎖店家的商品', () => {
  const ps = [{ id: 1, shopId: 'a' }, { id: 2, shopId: 'b' }, { id: 3, shopId: 'a' }];
  it('只留沒被封鎖的店；其他店照常', () => {
    expect(visibleProducts(ps, new Set(['a']))).toEqual([{ id: 2, shopId: 'b' }]);
  });
  it('沒有封鎖：回同一個陣列（參考不變）', () => {
    expect(visibleProducts(ps, new Set())).toBe(ps);
  });
  it('全部被封鎖：空陣列', () => {
    expect(visibleProducts(ps, new Set(['a', 'b']))).toEqual([]);
  });
});

describe('blockedDate：封鎖日期以台北時間顯示', () => {
  it('UTC 16:00 以後已是台北隔天', () => {
    expect(blockedDate(Date.parse('2026-10-25T15:59:00Z'))).toBe('2026/10/25');
    expect(blockedDate(Date.parse('2026-10-25T16:00:00Z'))).toBe('2026/10/26');
  });
  it('壞值回空字串', () => {
    expect(blockedDate(Number.NaN)).toBe('');
  });
});
