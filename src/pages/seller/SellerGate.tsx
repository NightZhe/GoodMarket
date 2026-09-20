import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useStore } from '../../store/StoreContext';

const AVATARS = ['🏪', '🌸', '🐱', '🍰', '🎮', '👜', '🪴', '📚', '💎', '🧶'];

// 示範版沒有真正的帳號密碼：選一家示範商店，或自己開一家新店
export default function SellerGate() {
  const { sellerShopId, shops, loginSeller, createShop } = useStore();
  const [form, setForm] = useState({ name: '', location: '臺北市', description: '', avatar: AVATARS[0] });
  const [touched, setTouched] = useState(false);

  if (sellerShopId && shops.some(s => s.id === sellerShopId)) return <Outlet />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (form.name.trim().length < 2) return;
    createShop({ ...form, name: form.name.trim(), description: form.description.trim() || '歡迎光臨！' });
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-brand via-[#f46b35] to-[#ff9a5a]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 text-white">
        <Link to="/" className="flex items-center gap-1.5 text-xl font-bold">🛍️ 好物集 <span className="text-base font-normal opacity-90">賣家中心</span></Link>
        <Link to="/" className="text-sm opacity-90 hover:opacity-100">回到購物 →</Link>
      </header>

      <main className="mx-auto grid max-w-5xl items-start gap-6 px-4 pb-12 pt-4 md:grid-cols-[1fr_420px] md:pt-12">
        <div className="text-white">
          <h1 className="text-3xl font-bold leading-tight md:text-5xl">開一家店，<br />只要 3 分鐘</h1>
          <ul className="mt-6 space-y-2 text-sm opacity-95 md:text-base">
            <li>✓ 0 元開店，免上架費</li>
            <li>✓ 手機拍照就能上架商品、設定多種規格</li>
            <li>✓ 訂單、出貨、營收一個後台看完</li>
          </ul>
        </div>

        <div className="space-y-4">
          <form onSubmit={submit} className="rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">建立我的商店</h2>
            <label className="mt-4 block text-sm">
              商店名稱
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={20} placeholder="例如：小花手作雜貨"
                className={`mt-1 w-full rounded-sm border px-3 py-2.5 outline-none focus:border-ink ${touched && form.name.trim().length < 2 ? 'border-error-border' : 'border-line'}`} />
              {touched && form.name.trim().length < 2 && <span className="text-xs text-error">商店名稱至少 2 個字</span>}
            </label>
            <div className="mt-3 text-sm">
              商店頭像
              <div className="mt-1 flex flex-wrap gap-1.5">
                {AVATARS.map(a => (
                  <button type="button" key={a} onClick={() => setForm(f => ({ ...f, avatar: a }))} aria-label={`頭像 ${a}`}
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-xl ${form.avatar === a ? 'bg-brand-soft ring-2 ring-brand' : 'bg-canvas'}`}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <label className="mt-3 block text-sm">
              出貨地
              <select value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="mt-1 w-full rounded-sm border border-line bg-white px-3 py-2.5">
                {['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '新竹市', '花蓮縣'].map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              商店簡介
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} maxLength={80} placeholder="一句話介紹你的商店"
                className="mt-1 w-full resize-none rounded-sm border border-line px-3 py-2 outline-none focus:border-ink" />
            </label>
            <button className="mt-4 h-11 w-full rounded-sm bg-brand text-white transition hover:bg-brand-dark">免費開店</button>
          </form>

          <div className="rounded-lg bg-white/95 p-5 shadow-xl">
            <p className="text-sm font-medium">或用示範商店體驗後台</p>
            <ul className="mt-2 divide-y divide-line">
              {shops.map(s => (
                <li key={s.id}>
                  <button onClick={() => loginSeller(s.id)} className="flex w-full items-center gap-3 py-2.5 text-left transition hover:text-brand">
                    <span className="text-2xl">{s.avatar}</span>
                    <span className="flex-1 text-sm">{s.name}</span>
                    <ChevronRight size={16} className="text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
