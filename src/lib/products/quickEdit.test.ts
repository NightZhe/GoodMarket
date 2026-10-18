import { describe, expect, it } from 'vitest';
import {
  bigChangeArrow, bigChangeLine, bigPriceChange, changesKey, collectQuickEdit, conflictDetail, conflictSentence,
  failureText, fieldKey, invalidToErrors, needsConfirm, resultNotice, settleConflict, toQuickEditFailure,
  type QuickChange, type QuickEditConflict, type QuickRow,
} from './quickEdit';

describe('bigPriceChange：降 50% 以上或漲 100% 以上才要確認', () => {
  it('降一半剛好要確認；差一塊不用', () => {
    expect(bigPriceChange(1000, 500)).toEqual({ kind: 'drop', percent: 50 });
    expect(bigPriceChange(1000, 501)).toBeNull();
  });

  it('1699 改成 169 降 90%；1699 改成 900 降 47% 不用確認', () => {
    expect(bigPriceChange(1699, 169)).toEqual({ kind: 'drop', percent: 90 });
    expect(bigPriceChange(1699, 900)).toBeNull();
  });

  it('漲一倍剛好要確認；差一塊不用', () => {
    expect(bigPriceChange(1000, 2000)).toEqual({ kind: 'rise', percent: 100 });
    expect(bigPriceChange(1000, 1999)).toBeNull();
    expect(bigPriceChange(1499, 3000)).toEqual({ kind: 'rise', percent: 100 });
  });

  it('用實際比值判斷，不用四捨五入後的百分比：降 49.6% 顯示 50% 也不觸發', () => {
    expect(bigPriceChange(1000, 504)).toBeNull();
    expect(bigPriceChange(10000, 5040)).toBeNull();
  });

  it('沒變、原價不合理時不觸發', () => {
    expect(bigPriceChange(1000, 1000)).toBeNull();
    expect(bigPriceChange(0, 500)).toBeNull();
  });

  it('文案：從 $1,699 改成 $169（降 90%）', () => {
    expect(bigChangeLine(1699, 169, { kind: 'drop', percent: 90 })).toBe('從 $1,699 改成 $169（降 90%）');
    expect(bigChangeLine(1000, 2000, { kind: 'rise', percent: 100 })).toBe('從 $1,000 改成 $2,000（漲 100%）');
  });
});

describe('toQuickEditFailure：把呼叫失敗分類', () => {
  it('error.hint 是資料庫丟的錯誤碼', () => {
    expect(toQuickEditFailure({ message: '請先登入', hint: 'NOT_AUTHENTICATED' }, false)).toBe('auth');
    expect(toQuickEditFailure({ message: 'x', hint: 'PRODUCT_NOT_FOUND' }, false)).toBe('not_found');
    expect(toQuickEditFailure({ message: 'x', hint: 'VARIANT_NOT_FOUND' }, false)).toBe('variant_missing');
    expect(toQuickEditFailure({ message: 'x', hint: 'CHANGES_INVALID' }, false)).toBe('server');
    expect(toQuickEditFailure({ message: 'x', hint: 'NO_SHOP' }, false)).toBe('server');
  });

  it('逾時優先；網路錯誤；其他當伺服器問題', () => {
    expect(toQuickEditFailure({ message: 'AbortError' }, true)).toBe('timeout');
    expect(toQuickEditFailure({ message: 'TypeError: Failed to fetch' }, false)).toBe('network');
    expect(toQuickEditFailure({ message: 'Load failed' }, false)).toBe('network');
    expect(toQuickEditFailure({ message: 'boom', code: '500' }, false)).toBe('server');
  });

  it('函式不存在（正式站還沒套 migration，PGRST202）顯示通用失敗，不當成網路問題', () => {
    expect(toQuickEditFailure({ message: 'Could not find the function', code: 'PGRST202' }, false)).toBe('server');
  });

  it('登入過期：JWT 錯誤碼與沒有權限', () => {
    expect(toQuickEditFailure({ message: 'JWT expired', code: 'PGRST301' }, false)).toBe('auth');
    expect(toQuickEditFailure({ message: 'x', code: 'PGRST303' }, false)).toBe('auth');
    expect(toQuickEditFailure({ message: 'permission denied', code: '42501' }, false)).toBe('auth');
  });

  it('沒有 code 也沒有 hint＝沒有伺服器回應（對齊 account/errors）；空字串視為沒有', () => {
    expect(toQuickEditFailure({ message: 'whatever', code: '', hint: '' }, false)).toBe('network');
    expect(toQuickEditFailure({ message: 'whatever' }, false)).toBe('network');
  });
});

describe('failureText：失敗文案', () => {
  it('一般失敗保留輸入', () => {
    expect(failureText('network')).toBe('沒有存成功：連不上網路。你填的內容還在。');
    expect(failureText('timeout')).toBe('沒有存成功：伺服器沒有回應。你填的內容還在。');
    expect(failureText('server')).toBe('沒有存成功：伺服器發生問題。你填的內容還在。');
  });

  it('登入過期沒有「你填的內容還在」', () => {
    expect(failureText('auth')).toBe('沒有存成功：登入已過期，請重新登入。');
  });
});

describe('invalidToErrors：伺服器的 invalid 標到輸入框旁', () => {
  it('超過原價：標在該規格的售價旁，金額用伺服器回的原價', () => {
    const r = invalidToErrors([
      { code: 'ORIGINAL_NOT_ABOVE_PRICE', variantId: 'a', field: 'original_price', message: 'x', originalPrice: 2199, price: 2300 },
    ]);
    expect(r).toEqual({ [fieldKey('a', 'price')]: '售價要低於原價 $2,199。要改原價請到編輯頁' });
  });

  it('價格與庫存的範圍錯誤用 variants.ts 的文案', () => {
    const r = invalidToErrors([
      { code: 'PRICE_TOO_HIGH', variantId: 'a', field: 'price', message: '' },
      { code: 'STOCK_INVALID', variantId: 'b', field: 'stock', message: '' },
    ]);
    expect(r?.[fieldKey('a', 'price')]).toBe('售價最高 $499,999');
    expect(r?.[fieldKey('b', 'stock')]).toBe('請填庫存（0 以上的整數）');
  });

  it('快改不會送原價，其他原價錯誤碼無法標在輸入框：回 null 讓呼叫端走通用失敗', () => {
    expect(invalidToErrors([{ code: 'ORIGINAL_TOO_HIGH', variantId: 'a', field: 'original_price', message: '' }])).toBeNull();
  });
});

describe('resultNotice：存完要顯示什麼', () => {
  const base = { autoHidden: false, status: 'active' as const, stockChanged: false, stockTotal: 10, leftTab: null as string | null };

  it('一般成功', () => {
    expect(resultNotice(base)).toEqual({ kind: 'plain', text: '已更新' });
  });

  it('自動下架', () => {
    expect(resultNotice({ ...base, autoHidden: true, status: 'hidden', stockTotal: 0, stockChanged: true }))
      .toEqual({ kind: 'warn', text: '已更新，庫存為 0，已自動下架' });
  });

  it('下架中的商品改了庫存、加總大於 0：提示仍是下架', () => {
    expect(resultNotice({ ...base, status: 'hidden', stockChanged: true }))
      .toEqual({ kind: 'warn', text: '已更新。商品仍是下架狀態，要賣請按上架' });
  });

  it('下架中的商品只改價格、或改完加總是 0：不提示', () => {
    expect(resultNotice({ ...base, status: 'hidden', stockChanged: false })).toEqual({ kind: 'plain', text: '已更新' });
    expect(resultNotice({ ...base, status: 'hidden', stockChanged: true, stockTotal: 0 })).toEqual({ kind: 'plain', text: '已更新' });
  });

  it('列離開目前分頁籤：從「已售完」補貨到上架中', () => {
    expect(resultNotice({ ...base, stockChanged: true, leftTab: 'soldout' }))
      .toEqual({ kind: 'plain', text: '已更新，這件商品移到了「架上商品」' });
  });

  it('列離開目前分頁籤：補貨但仍是下架', () => {
    expect(resultNotice({ ...base, status: 'hidden', stockChanged: true, leftTab: 'soldout' }))
      .toEqual({ kind: 'warn', text: '已更新。商品仍是下架狀態，要賣請按上架（已移到「已下架」）' });
  });

  it('列離開目前分頁籤：自動下架用同一句', () => {
    expect(resultNotice({ ...base, autoHidden: true, status: 'hidden', stockTotal: 0, stockChanged: true, leftTab: 'active' }))
      .toEqual({ kind: 'warn', text: '已更新，庫存為 0，已自動下架' });
  });
});

describe('conflictDetail：衝突明細', () => {
  it('多規格明細', () => {
    expect(conflictDetail({ field: 'stock', seen: 3, current: 1, attempted: 20 })).toBe('庫存　你看到 3 → 現在 1（你填 20）');
    expect(conflictDetail({ field: 'price', seen: 1299, current: 1199, attempted: 1099 }))
      .toBe('售價　你看到 $1,299 → 現在 $1,199（你填 $1,099）');
  });
});

describe('bigChangeArrow／conflictSentence：決策區文案', () => {
  it('多規格確認明細', () => {
    expect(bigChangeArrow(1299, 129, { kind: 'drop', percent: 90 })).toBe('$1,299 → $129（降 90%）');
    expect(bigChangeArrow(1499, 3000, { kind: 'rise', percent: 100 })).toBe('$1,499 → $3,000（漲 100%）');
  });

  it('單規格衝突：庫存與售價用不同的原因', () => {
    expect(conflictSentence({ field: 'stock', seen: 10, current: 8, attempted: 15 }))
      .toBe('庫存已從 10 變成 8，可能是這段時間有人下單。你填的是 15。');
    expect(conflictSentence({ field: 'price', seen: 1699, current: 1499, attempted: 1299 }))
      .toBe('售價已從 $1,699 變成 $1,499，可能是在別的視窗改過。你填的是 $1,299。');
  });
});

const row = (id: string, price: number, stock: number, originalPrice?: number): QuickRow =>
  ({ id, name: `規格${id}`, originalPrice, seen: { price, stock } });
const drafts = (o: Record<string, [string, string]>) =>
  Object.fromEntries(Object.entries(o).map(([k, [price, stock]]) => [k, { price, stock }]));

describe('collectQuickEdit：算出這次要送的值', () => {
  const rows = [row('a', 1000, 5, 2000), row('b', 300, 0)];

  it('沒改的規格不送、不驗（R-3、R-5）', () => {
    const r = collectQuickEdit(rows, drafts({ a: ['1000', '5'], b: ['300', '0'] }), ['price', 'stock']);
    expect(r).toEqual({ errs: {}, changes: [], big: [] });
  });

  it('只看這個編輯區的欄位', () => {
    const r = collectQuickEdit(rows, drafts({ a: ['900', '7'], b: ['300', '0'] }), ['price']);
    expect(r.changes).toEqual([{ variantId: 'a', field: 'price', expected: 1000, value: 900 }]);
  });

  it('驗證錯誤標到欄位；其餘合法的值照樣收進 changes', () => {
    const r = collectQuickEdit(rows, drafts({ a: ['2000', '5'], b: ['400', '0'] }), ['price']);
    expect(r.errs).toEqual({ [fieldKey('a', 'price')]: '售價要低於原價 $2,000。要改原價請到編輯頁' });
    expect(r.changes).toEqual([{ variantId: 'b', field: 'price', expected: 300, value: 400 }]);
  });

  it('大幅改價：單規格用整句，多規格用箭頭', () => {
    const single = collectQuickEdit([row('a', 1699, 5)], drafts({ a: ['169', '5'] }), ['price']);
    expect(single.big).toEqual([{ variantId: 'a', name: '規格a', text: '售價從 $1,699 改成 $169（降 90%）' }]);
    const multi = collectQuickEdit(rows, drafts({ a: ['400', '5'], b: ['300', '0'] }), ['price']);
    expect(multi.big).toEqual([{ variantId: 'a', name: '規格a', text: '$1,000 → $400（降 60%）' }]);
  });
});

describe('大幅改價確認只對「確認過的那組值」有效', () => {
  const r1 = [row('a', 1000, 5)];
  const ask = (price: string) => collectQuickEdit(r1, drafts({ a: [price, '5'] }), ['price']);

  it('沒確認過一定要問；確認過同一組值就不再問', () => {
    const first = ask('400');
    const key = changesKey(first.changes);
    expect(needsConfirm(first.big, key, null)).toBe(true);
    expect(needsConfirm(first.big, key, key)).toBe(false);
  });

  it('送出失敗後把價格改成更離譜的值再送：要再確認一次', () => {
    const confirmed = changesKey(ask('400').changes);
    const again = ask('100');
    expect(needsConfirm(again.big, changesKey(again.changes), confirmed)).toBe(true);
  });

  it('沒有大幅改價就不問', () => {
    const small = ask('900');
    expect(needsConfirm(small.big, changesKey(small.changes), null)).toBe(false);
  });
});

describe('settleConflict：逾時但其實已寫入，重試只會看到「現在的值就是我要寫的值」', () => {
  const changes: QuickChange[] = [{ variantId: 'a', field: 'stock', expected: 10, value: 0 }];
  const conflict = (over: Partial<QuickEditConflict> = {}): QuickEditConflict => ({
    outcome: 'conflict', productId: 'p', status: 'hidden',
    variants: [{ id: 'a', name: '標準款', price: 100, stock: 0 }],
    conflicts: [{ variantId: 'a', variantName: '標準款', field: 'stock', seen: 10, current: 0, attempted: 0 }],
    ...over,
  });

  it('每一筆都是 current＝attempted：當成功，帶回目前的規格與狀態', () => {
    const ok = settleConflict(conflict(), changes, true);
    expect(ok).toMatchObject({ outcome: 'ok', productId: 'p', status: 'hidden', autoHidden: true });
    expect(ok?.variants).toHaveLength(1);
    expect(ok?.changed).toEqual([{ variantId: 'a', field: 'stock', old: 10, new: 0 }]);
  });

  it('原本就是下架、或庫存沒有全部歸零：不算自動下架', () => {
    expect(settleConflict(conflict(), changes, false)?.autoHidden).toBe(false);
    const some = conflict({ variants: [{ id: 'a', name: 'x', price: 1, stock: 0 }, { id: 'b', name: 'y', price: 1, stock: 3 }] });
    expect(settleConflict(some, changes, true)?.autoHidden).toBe(false);
  });

  it('有任何一筆是別人改的（current≠attempted）、或衝突沒涵蓋全部 changes：不是成功', () => {
    const other = conflict({ conflicts: [{ variantId: 'a', variantName: '標準款', field: 'stock', seen: 10, current: 3, attempted: 0 }] });
    expect(settleConflict(other, changes, true)).toBeNull();
    const two: QuickChange[] = [...changes, { variantId: 'a', field: 'price', expected: 100, value: 120 }];
    expect(settleConflict(conflict(), two, true)).toBeNull();
  });
});
