import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import { CATEGORIES } from '../../data/seed';
import { CategoryIcon } from '../../data/categoryIcons';
import { orderCategories } from '../../lib/home/categoryOrder';
import { pickStory, type StoryPick } from '../../lib/home/pickStory';
import ProductCard from '../../components/ProductCard';
import ProductRow, { ProductRowList } from '../../components/ProductRow';
import Photo from '../../components/Photo';
import PricePill from '../../components/PricePill';
import SectionHeader from '../../components/SectionHeader';
import Shelf from '../../components/Shelf';
import { pillButton } from '../../components/pillButton';
import { BackToTopButton, MoreButton } from '../../components/RevealFooter';
import { useInfiniteReveal } from '../../components/useInfiniteReveal';
import { HOME_REVEAL_KEY } from '../../lib/ui/revealPolicy';
import EmptyState from '../../components/EmptyState';
import { useProductView } from '../../components/useProductView';
import type { Category, Product } from '../../types';

/** 「最新上架」橫滑貨架最多幾件，其餘到 › 目的地 */
const SHELF_MAX = 10;
/** 列表列：放在架商品最多的前幾個分類、每個分類幾列（§4.6） */
const ROW_CATEGORIES = 2;
const ROWS_PER_CATEGORY = 3;


const newestFirst = (a: Product, b: Product) => b.createdAt.localeCompare(a.createdAt);

export default function Home() {
  const { products } = useStore();

  const active = useMemo(() => products.filter(p => p.status === 'active'), [products]);
  const categories = useMemo(() => orderCategories(CATEGORIES, products), [products]);
  // 故事卡的「現在」只在商品資料變動時取一次（含靜默重讀），不在每次 render 讀時鐘
  const now = useMemo(() => Date.now(), [products]);
  const story = useMemo(() => pickStory(products, CATEGORIES, now), [products, now]);

  const newest = useMemo(() => [...active].sort(newestFirst), [active]);
  // categories 已依在架數由多到少排；在架 0 件的分類整段不出現
  const rowSections = useMemo(
    () => categories
      .map(category => ({ category, items: newest.filter(p => p.categoryId === category.id).slice(0, ROWS_PER_CATEGORY) }))
      .filter(s => s.items.length > 0)
      .slice(0, ROW_CATEGORIES),
    [categories, newest],
  );
  // 全部商品照銷量排；新上架的有「最新上架」貨架，不會被銷量 0 壓到看不見
  const recommended = useMemo(() => [...active].sort((a, b) => b.sold - a.sold), [active]);
  // 滑近底部自動多畫一批；沒有商品時下面直接 return，這支 hook 照樣要在 return 之前呼叫
  const reveal = useInfiniteReveal(recommended, HOME_REVEAL_KEY);

  if (active.length === 0) {
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState
          title="目前還沒有商品"
          action={
            <Link to="/seller" className={pillButton}>
              免費開店
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-8">
      <CategoryChips categories={categories} />

      {story && <StoryCard story={story} />}

      <SectionHeader eyebrow="過去 7 天" title="最新上架" to="/search?sort=newest" />
      <Shelf>
        {newest.slice(0, SHELF_MAX).map(p => <ProductCard key={p.id} product={p} variant="shelf" />)}
      </Shelf>

      {rowSections.map(({ category, items }) => (
        <section key={category.id}>
          <SectionHeader title={category.name} to={`/search?cat=${category.id}`} />
          <ProductRowList>
            {items.map(p => <ProductRow key={p.id} product={p} />)}
          </ProductRowList>
        </section>
      ))}

      <SectionHeader title="全部商品" />
      {/* 容器查詢要掛在父層：格子本身窄於 15rem（200% 縮放）時改單欄，價格才放得下 */}
      <div className="@container">
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-5 @max-[15rem]:grid-cols-1 md:grid-cols-4 lg:grid-cols-6">
          {reveal.visible.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      </div>
      <div ref={reveal.sentinelRef} aria-hidden="true" />
      {reveal.showFallback && <MoreButton onClick={reveal.showMore} />}
      {reveal.showBackToTop && <BackToTopButton onClick={reveal.backToTop} />}
    </div>
  );
}

/** 分類膠囊列（§4.2）：橫滑、11 個全列、順序依在架數。膠囊 36 高，外層 44 是熱區 */
function CategoryChips({ categories }: { categories: Category[] }) {
  return (
    <nav
      aria-label="分類"
      className="no-scrollbar flex snap-x snap-mandatory scroll-px-5 -mb-1 gap-2 overflow-x-auto px-5 pb-1 pt-2 md:flex-wrap md:overflow-visible"
    >
      {categories.map(c => (
        <Link key={c.id} to={`/search?cat=${c.id}`} className="group flex h-11 shrink-0 snap-start items-center">
          <span className="flex h-9 items-center gap-1.5 rounded-full bg-canvas pl-2.5 pr-3.5 text-subhead font-medium text-ink transition-colors duration-200 group-active:bg-press group-active:duration-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:bg-press">
            <CategoryIcon id={c.id} size={18} />
            {c.name}
          </span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * 故事卡（§4.3）：整張一個連結，VoiceOver 只停一次。不輪播、不自動切換；重讀後換了分類就直接換。
 * 副標（前三個品牌／關鍵字）萃取規則未定，本版不顯示。
 */
function StoryCard({ story }: { story: StoryPick }) {
  const { price, soldOut, shopLine } = useProductView(story.latest);

  return (
    <Link
      to={`/search?cat=${story.categoryId}&sort=newest`}
      aria-label={`${story.eyebrow}：${story.title}`}
      className="mx-5 mt-5 block overflow-hidden rounded-story shadow-story transition-transform duration-160 ease-[cubic-bezier(.23,1,.32,1)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <div aria-hidden="true">
        <Photo src={story.image} alt="" size="lg" className="aspect-[4/3] rounded-none md:aspect-[16/5]">
          {/* 壓暗層：底 62%→40% 處 55%→頂 0，白字最差對比 4.74 */}
          <div className="absolute inset-x-0 bottom-0 h-[70%] bg-[linear-gradient(to_top,rgb(0_0_0/.62)_0%,rgb(0_0_0/.55)_40%,rgb(0_0_0/0)_100%)]" />
          <div className="absolute inset-x-4 bottom-3.5 text-white">
            <p className="text-footnote font-semibold">{story.eyebrow}</p>
            <p className="mt-0.5 line-clamp-2 text-title1 font-bold">{story.title}</p>
          </div>
        </Photo>
        <div className="flex items-center gap-3 bg-white px-4 py-3">
          <Photo src={story.image} alt="" size="sm" className="size-11 shrink-0 rounded-[10px]" />
          {/* 字放大到擠不下時價格膠囊換到標題下方（§3.5，同列表列） */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 basis-32">
              <p className="truncate text-subhead font-semibold text-ink">{story.latest.title}</p>
              <p className="truncate text-footnote text-muted">{shopLine}</p>
            </div>
            <PricePill price={price} muted={soldOut} />
          </div>
        </div>
      </div>
    </Link>
  );
}
