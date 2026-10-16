import { describe, expect, it } from 'vitest';
import { buildSubmitItems, confirmSummary, contentLength, isContentTooLong, submitBlocker, type EditorItem } from './form';

const item = (over: Partial<EditorItem> & { productId: string }): EditorItem => ({
  rating: 0, content: '', photos: [], ...over,
});

describe('submitBlocker：說明文字的優先順序', () => {
  it('1. 沒有任何商品打星等', () => {
    expect(submitBlocker([item({ productId: 'a' })], true)?.kind).toBe('noRating');
  });

  it('2. 照片處理中／上傳中', () => {
    const b = submitBlocker([item({ productId: 'a', rating: 5, photos: [{ status: 'uploading' }] })], true);
    expect(b).toMatchObject({ kind: 'uploading', target: { type: 'item', productId: 'a' } });
    expect(submitBlocker([item({ productId: 'a', rating: 5, photos: [{ status: 'processing' }] })], true)?.kind).toBe('uploading');
  });

  it('3. 照片失敗或無法使用', () => {
    expect(submitBlocker([item({ productId: 'a', rating: 5, photos: [{ status: 'failed' }] })], true)?.kind).toBe('failed');
    expect(submitBlocker([item({ productId: 'a', rating: 5, photos: [{ status: 'unusable' }] })], true)?.kind).toBe('failed');
  });

  it('上傳中比失敗優先', () => {
    const b = submitBlocker([item({ productId: 'a', rating: 5, photos: [{ status: 'failed' }, { status: 'uploading' }] })], true);
    expect(b?.kind).toBe('uploading');
  });

  it('4. 文字超過 500 字：訊息帶第幾件商品', () => {
    const b = submitBlocker([
      item({ productId: 'a', rating: 5 }),
      item({ productId: 'b', rating: 4, content: 'x'.repeat(501) }),
    ], true);
    expect(b).toMatchObject({ kind: 'tooLong', message: '第 2 件商品的評價內容超過 500 字' });
  });

  it('5. 暱稱不合法', () => {
    expect(submitBlocker([item({ productId: 'a', rating: 5 })], false)).toMatchObject({ kind: 'nickname', target: { type: 'nickname' } });
  });

  it('可以送出：回 null', () => {
    expect(submitBlocker([item({ productId: 'a', rating: 5, photos: [{ status: 'done' }] })], true)).toBeNull();
  });

  it('沒打星等的商品，就算有壞照片或超長文字也不擋', () => {
    const items = [
      item({ productId: 'a', rating: 5 }),
      item({ productId: 'b', rating: 0, content: 'x'.repeat(900), photos: [{ status: 'failed' }] }),
    ];
    expect(submitBlocker(items, true)).toBeNull();
  });
});

describe('文字長度', () => {
  it('頭尾空白不算；500 字剛好可以，501 字不行', () => {
    expect(contentLength('  abc  ')).toBe(3);
    expect(isContentTooLong('x'.repeat(500))).toBe(false);
    expect(isContentTooLong('x'.repeat(501))).toBe(true);
    expect(isContentTooLong(`  ${'x'.repeat(500)}  `)).toBe(false);
  });

  it('以 code point 計：500 個擴充區的字不超過', () => {
    expect(isContentTooLong('𠮷'.repeat(500))).toBe(false);
  });
});

describe('送出內容', () => {
  it('只送有打星等的商品；照片只送已上傳成功的路徑；文字去頭尾空白', () => {
    const out = buildSubmitItems([
      { productId: 'a', rating: 4, content: '  好用 ', photos: [{ status: 'done', path: 'p1.jpg' }, { status: 'failed', path: 'p2.jpg' }, { status: 'done' }] },
      { productId: 'b', rating: 0, content: '不會送', photos: [] },
    ]);
    expect(out).toEqual([{ productId: 'a', rating: 4, content: '好用', photos: ['p1.jpg'] }]);
  });

  it('送出前確認的第一行', () => {
    expect(confirmSummary(2, 0)).toBe('將送出 2 件商品的評價。');
    expect(confirmSummary(1, 3)).toBe('將送出 1 件商品的評價，共 3 張照片。');
  });
});
