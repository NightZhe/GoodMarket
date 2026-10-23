import { Link, useParams } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import ProductCard from '../../components/ProductCard';
import EmptyState from '../../components/EmptyState';
import { pillButton } from '../../components/pillButton';
import LetterAvatar from '../../components/LetterAvatar';
import SectionHeader from '../../components/SectionHeader';
import { ratingText } from '../../lib/reviews/format';
import { useReviews } from '../../store/ReviewsContext';

export default function ShopPage() {
  const { id = '' } = useParams();
  const { getShop, products } = useStore();
  const { shopStat, summaryState } = useReviews();
  const shop = getShop(id);
  if (!shop) {
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState title="找不到這家商店" action={<Link to="/" className={pillButton}>回首頁</Link>} />
      </div>
    );
  }
  const list = products.filter(p => p.shopId === id && p.status === 'active');
  const stat = shopStat(id);
  // 沒有評價才寫「尚無」；資料還沒回來或載入失敗時寫「–」，不對有評價的店說謊
  const ratingValue = stat ? ratingText(stat.avg) : summaryState === 'ready' ? '尚無' : '–';

  return (
    <div className="mx-auto max-w-6xl md:px-4 md:pt-6">
      <section className="px-5 pt-2 md:px-0">
        <div className="flex items-center gap-4">
          <LetterAvatar name={shop.name} size={64} />
          <div className="min-w-0">
            <h1 className="truncate text-title2 font-bold text-ink">{shop.name}</h1>
            <p className="text-subhead text-muted">{shop.location}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 border-y-[0.5px] border-separator py-2.5 text-center md:max-w-md">
          <Stat label="商品" value={String(list.length)} />
          <Stat label="評價" value={ratingValue} />
          <Stat label="加入" value={new Date(shop.joinedAt).getFullYear() + ' 年'} />
        </dl>
        {shop.description && <p className="mt-4 text-subhead text-muted">{shop.description}</p>}
      </section>
      <SectionHeader title="所有商品" className="mx-5 mt-8 mb-3 md:mx-0" />
      {list.length === 0 ? (
        <EmptyState title="這家店還沒有上架商品" />
      ) : (
        <div className="@container">
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-5 pb-4 @max-[15rem]:grid-cols-1 md:grid-cols-4 md:px-0 lg:grid-cols-5">
            {list.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** 資訊條的一格（§4.8 第 6 點）：標籤在上，格與格之間 0.5pt 線 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-separator px-1 [&:not(:first-child)]:border-l-[0.5px]">
      <dt className="text-caption2 font-semibold text-muted">{label}</dt>
      <dd className="mt-1 text-title3 font-bold text-muted">{value}</dd>
    </div>
  );
}
