import type { Category, CategoryId, Product } from '../../types';

export interface StoryPick {
  categoryId: CategoryId;
  categoryName: string;
  /** 「{分類名}到貨」 */
  title: string;
  eyebrow: string;
  /** 卡片主圖：該分類近 7 天最新一件有圖商品的 images[0] */
  image: string;
  /** 主圖那件商品，卡片下方白條用 */
  latest: Product;
  /** 該分類近 7 天上新件數 */
  newCount: number;
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 近 7 天上新少於這個數就整張卡不顯示 */
const MIN_NEW = 3;

/**
 * 首頁故事卡挑哪個分類（D3，design-final §4.3）。純函式：`now` 由呼叫端給，不在這裡讀時鐘。
 * 1. 只看在架商品；近 7 天＝`now` 往前 7×24 小時內上架。
 * 2. 近 7 天件數最多的分類；同數比在架總數；再同數照 `categories` 順序。
 * 3. 該分類近 7 天少於 3 件，或沒有近 7 天商品 → null（整張卡不顯示）。
 * 4. 主圖＝該分類近 7 天最新一件的 images[0]，沒圖往下一件找；都沒圖 → null。
 */
export function pickStory(products: Product[], categories: Category[], now: number): StoryPick | null {
  const active = products.filter(p => p.status === 'active');
  const recent = active.filter(p => now - Date.parse(p.createdAt) <= WINDOW_MS);

  const groups = new Map<CategoryId, Product[]>();
  for (const p of recent) {
    const list = groups.get(p.categoryId);
    if (list) list.push(p);
    else groups.set(p.categoryId, [p]);
  }

  const totals = new Map<CategoryId, number>();
  for (const p of active) totals.set(p.categoryId, (totals.get(p.categoryId) ?? 0) + 1);

  // 近 7 天件數多者勝；同數比在架總數；再同數保留 categories 裡較前面的（只在嚴格大於時換）
  const count = (c: Category) => groups.get(c.id)?.length ?? 0;
  const total = (c: Category) => totals.get(c.id) ?? 0;
  let best: Category | undefined;
  for (const c of categories) {
    if (count(c) === 0) continue;
    if (!best || count(c) > count(best) || (count(c) === count(best) && total(c) > total(best))) best = c;
  }
  if (!best || count(best) < MIN_NEW) return null;

  // 同一刻上架再比 id：重讀後陣列順序可能不同，主圖不能跟著跳
  const items = [...groups.get(best.id)!].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id),
  );
  // 主圖往下一件找；白條放同一件，圖與文才對得上
  const latest = items.find(p => Boolean(p.images[0]));
  if (!latest) return null;
  return {
    categoryId: best.id,
    categoryName: best.name,
    title: `${best.name}到貨`,
    eyebrow: '近 7 天上新',
    image: latest.images[0],
    latest,
    newCount: items.length,
  };
}
