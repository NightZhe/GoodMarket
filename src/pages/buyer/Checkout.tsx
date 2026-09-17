import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, MapPin, Store } from 'lucide-react';
import { shippingFor, useStore } from '../../store/StoreContext';
import ProductImage from '../../components/ProductImage';
import EmptyState from '../../components/EmptyState';
import { money } from '../../lib/format';
import type { CartItem, Order } from '../../types';

const BUYER_KEY = 'goodmarket_buyer';
const PAYMENTS: { id: Order['payment']; label: string }[] = [
  { id: 'cod', label: '貨到付款' },
  { id: 'card', label: '信用卡（示範）' },
  { id: 'transfer', label: 'ATM 轉帳' },
];

export default function Checkout() {
  const { state } = useLocation() as { state: { items?: CartItem[]; fromCart?: boolean } | null };
  const { getProduct, getShop, checkout } = useStore();
  const [buyer, setBuyer] = useState<Order['buyer']>(() => {
    try { return JSON.parse(localStorage.getItem(BUYER_KEY) ?? '') } catch { return { name: '', phone: '', address: '' }; }
  });
  const [payment, setPayment] = useState<Order['payment']>('cod');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<Order[] | null>(null);

  const items = state?.items ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, { item: CartItem; title: string; image: string; variantName: string; price: number }[]>();
    for (const item of items) {
      const p = getProduct(item.productId);
      const v = p?.variants.find(x => x.id === item.variantId);
      if (!p || !v) continue;
      map.set(p.shopId, [...(map.get(p.shopId) ?? []), { item, title: p.title, image: p.images[0], variantName: v.name, price: v.price }]);
    }
    return [...map.entries()].map(([shopId, rows]) => {
      const subtotal = rows.reduce((s, r) => s + r.price * r.item.qty, 0);
      return { shopId, rows, subtotal, shipping: shippingFor(subtotal, rows.map(r => getProduct(r.item.productId))) };
    });
    // 只在進頁時計算一次：結帳成功後庫存會變，不該讓摘要跟著跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) {
    return (
      <div className="mx-auto max-w-lg p-3 md:py-12">
        <div className="flex flex-col items-center gap-3 rounded-md bg-white px-6 py-12 text-center">
          <CheckCircle2 size={64} className="text-teal-500" strokeWidth={1.5} />
          <h1 className="text-xl font-bold">訂單成立！</h1>
          <p className="text-sm text-muted">共 {done.length} 筆訂單（依商店分開出貨），賣家會盡快為你出貨。</p>
          <div className="mt-4 flex gap-3">
            <Link to="/orders" className="rounded-sm border border-brand px-6 py-2.5 text-sm text-brand">查看訂單</Link>
            <Link to="/" className="rounded-sm bg-brand px-6 py-2.5 text-sm text-white">繼續購物</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        <EmptyState icon="🧾" title="沒有要結帳的商品" action={<Link to="/cart" className="text-brand">回購物車</Link>} />
      </div>
    );
  }

  const subtotal = groups.reduce((s, g) => s + g.subtotal, 0);
  const shipping = groups.reduce((s, g) => s + g.shipping, 0);
  const valid = buyer.name.trim() && /^09\d{2}-?\d{3}-?\d{3}$/.test(buyer.phone.trim()) && buyer.address.trim().length >= 6;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    localStorage.setItem(BUYER_KEY, JSON.stringify(buyer));
    setDone(checkout({ items, buyer, payment, fromCart: !!state?.fromCart }));
    window.scrollTo(0, 0);
  };

  const field = (key: keyof Order['buyer'], label: string, placeholder: string, bad: boolean, hint: string) => (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <input
        value={buyer[key]}
        onChange={e => setBuyer(b => ({ ...b, [key]: e.target.value }))}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-sm border px-3 py-2.5 text-sm outline-none focus:border-ink ${touched && bad ? 'border-red-400' : 'border-line'}`}
      />
      {touched && bad && <span className="mt-1 block text-xs text-red-500">{hint}</span>}
    </label>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-2 pb-28 md:space-y-4 md:px-4 md:pt-6">
      <section className="bg-white p-4 md:rounded-md md:p-6">
        <div className="-mx-4 -mt-4 mb-4 h-1 bg-[repeating-linear-gradient(45deg,#6fa6d6_0,#6fa6d6_33px,transparent_0,transparent_41px,#f18d9b_0,#f18d9b_74px,transparent_0,transparent_82px)] md:-mx-6 md:-mt-6 md:rounded-t-md" />
        <h2 className="mb-4 flex items-center gap-1.5 text-brand"><MapPin size={18} /> 收件資訊</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr]">
          {field('name', '收件人', '王小明', !buyer.name.trim(), '請填寫收件人')}
          {field('phone', '手機號碼', '0912-345-678', !/^09\d{2}-?\d{3}-?\d{3}$/.test(buyer.phone.trim()), '請填寫 09 開頭的手機號碼')}
          {field('address', '收件地址', '臺北市大安區…', buyer.address.trim().length < 6, '請填寫完整地址')}
        </div>
      </section>

      {groups.map(g => (
        <section key={g.shopId} className="bg-white md:rounded-md">
          <header className="flex items-center gap-1.5 border-b border-line px-4 py-3 text-sm font-medium md:px-6">
            <Store size={16} /> {getShop(g.shopId)?.name}
          </header>
          {g.rows.map(r => (
            <div key={`${r.item.productId}|${r.item.variantId}`} className="flex items-center gap-3 px-4 py-3 md:px-6">
              <ProductImage src={r.image} alt="" size="sm" className="w-14 rounded-sm border border-line" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{r.title}</p>
                <p className="text-xs text-muted">規格：{r.variantName}</p>
              </div>
              <p className="text-sm text-muted">{money(r.price)} × {r.item.qty}</p>
              <p className="hidden w-24 text-right text-sm md:block">{money(r.price * r.item.qty)}</p>
            </div>
          ))}
          <div className="flex justify-between border-t border-dashed border-line bg-[#fafdff] px-4 py-3 text-sm md:px-6">
            <span className="text-muted">運費 {g.shipping === 0 && <span className="text-teal-600">（免運）</span>}</span>
            <span>{money(g.shipping)}</span>
          </div>
        </section>
      ))}

      <section className="bg-white p-4 md:rounded-md md:p-6">
        <h2 className="mb-3">付款方式</h2>
        <div className="flex flex-wrap gap-2">
          {PAYMENTS.map(p => (
            <button key={p.id} onClick={() => setPayment(p.id)}
              className={`rounded-sm border px-4 py-2 text-sm ${payment === p.id ? 'border-brand text-brand' : 'border-line'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <dl className="mt-6 ml-auto max-w-xs space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">商品總金額</dt><dd>{money(subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">運費總金額</dt><dd>{money(shipping)}</dd></div>
          <div className="flex items-center justify-between pt-2"><dt className="text-muted">總付款金額</dt><dd className="text-2xl text-brand">{money(subtotal + shipping)}</dd></div>
        </dl>
      </section>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 flex items-center border-t border-line bg-white md:static md:justify-end md:rounded-md md:border-0 md:px-6 md:py-5">
        <p className="flex-1 px-4 text-sm md:flex-none">總付款 <span className="text-lg text-brand">{money(subtotal + shipping)}</span></p>
        <button onClick={submit} className="h-12 min-w-32 bg-brand px-6 text-white transition hover:bg-brand-dark md:min-w-52 md:rounded-sm">
          下訂單
        </button>
      </div>
    </div>
  );
}
