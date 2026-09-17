import { Link, useParams } from 'react-router-dom';
import { Calendar, Package, Star } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import ProductCard from '../../components/ProductCard';
import EmptyState from '../../components/EmptyState';

export default function ShopPage() {
  const { id = '' } = useParams();
  const { getShop, products } = useStore();
  const shop = getShop(id);
  if (!shop) {
    return <div className="mx-auto max-w-6xl p-3 md:p-6"><EmptyState icon="🏚️" title="找不到這家商店" action={<Link to="/" className="text-brand">回首頁</Link>} /></div>;
  }
  const list = products.filter(p => p.shopId === id && p.status === 'active');

  return (
    <div className="mx-auto max-w-6xl md:px-4 md:pt-6">
      <section className="flex flex-col gap-5 bg-white p-4 md:flex-row md:items-center md:rounded-md md:p-6">
        <div className="flex items-center gap-4 rounded-md bg-gradient-to-br from-[#3d3d3d] to-[#1f1f1f] p-5 text-white md:w-96">
          <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/30 bg-white/10 text-5xl">{shop.avatar}</span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{shop.name}</h1>
            <p className="text-xs opacity-70">{shop.location}</p>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-3 text-sm">
          <Stat icon={<Package size={16} />} label="商品" value={String(list.length)} />
          <Stat icon={<Star size={16} />} label="評價" value={shop.rating.toFixed(1)} />
          <Stat icon={<Calendar size={16} />} label="加入" value={new Date(shop.joinedAt).getFullYear() + ' 年'} />
          <p className="col-span-3 text-muted">{shop.description}</p>
        </div>
      </section>
      <h2 className="mt-3 border-b-4 border-brand bg-white px-4 py-3 text-sm font-medium text-brand md:mt-4 md:rounded-t-md">所有商品</h2>
      {list.length === 0 ? (
        <EmptyState icon="📦" title="這家店還沒有上架商品" />
      ) : (
        <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 md:grid-cols-6 md:px-0">
          {list.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">{icon}</span>
      <span className="text-muted">{label}</span>
      <span className="text-brand">{value}</span>
    </div>
  );
}
