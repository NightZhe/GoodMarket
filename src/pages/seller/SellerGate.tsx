import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useStore } from '../../store/StoreContext';

const AVATARS = ['🏪', '🌸', '🐱', '🍰', '🎮', '👜', '🪴', '📚', '💎', '🧶'];
const CITIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '新竹市', '花蓮縣'];

/** 賣家中心的門口：先登入，再開店。兩關都過了才看得到後台。 */
export default function SellerGate() {
  const { user, authReady, myShop } = useStore();

  if (!authReady) return <Splash />;
  if (!user) return <Shell><AuthForm /></Shell>;
  if (!myShop) return <Shell><ShopForm /></Shell>;
  return <Outlet />;
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand via-[#f46b35] to-[#ff9a5a] text-white">
      <Loader2 className="animate-spin" size={32} />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-br from-brand via-[#f46b35] to-[#ff9a5a]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 text-white">
        <Link to="/" className="flex items-center gap-1.5 text-xl font-bold">
          🛍️ 好物集 <span className="text-base font-normal opacity-90">賣家中心</span>
        </Link>
        <Link to="/" className="text-sm opacity-90 hover:opacity-100">回到購物 →</Link>
      </header>
      <main className="mx-auto grid max-w-5xl items-start gap-6 px-4 pb-12 pt-4 md:grid-cols-[1fr_420px] md:pt-12">
        <div className="text-white">
          <h1 className="text-3xl font-bold leading-tight md:text-5xl">開一家店，<br />只要 3 分鐘</h1>
          <ul className="mt-6 space-y-2 text-sm opacity-95 md:text-base">
            <li>✓ 0 元開店，免上架費</li>
            <li>✓ 上架的商品，全站買家都看得到</li>
            <li>✓ 訂單、出貨、營收一個後台看完</li>
          </ul>
        </div>
        {children}
      </main>
    </div>
  );
}

const inputClass = 'mt-1 w-full rounded-sm border px-3 py-2.5 outline-none focus:border-ink';

function AuthForm() {
  const { signIn, signUp } = useStore();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('密碼至少 6 個字');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'in') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
        setSent(true);
      }
    } catch (err) {
      setError(translate(err instanceof Error ? err.message : '發生錯誤'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">請收信完成註冊 📬</h2>
        <p className="mt-2 text-sm text-muted">
          我們寄了一封確認信到 <span className="text-ink">{email}</span>。
          點信裡的連結啟用帳號後，回來這裡登入就能開店。
        </p>
        <button onClick={() => { setSent(false); setMode('in'); }} className="mt-4 text-sm text-brand">
          已經啟用了，去登入 →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-white p-6 shadow-xl">
      <div className="flex gap-4 border-b border-line">
        {([['in', '登入'], ['up', '註冊開店']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => { setMode(id); setError(''); }}
            className={`-mb-px border-b-2 px-1 pb-2.5 text-sm ${mode === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-sm">
        Email
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          autoComplete="email" placeholder="you@example.com" className={`${inputClass} border-line`} />
      </label>
      <label className="mt-3 block text-sm">
        密碼
        <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          placeholder="至少 6 個字" className={`${inputClass} border-line`} />
      </label>

      {error && <p className="mt-3 rounded-sm bg-error-bg px-3 py-2 text-sm text-error-text">{error}</p>}

      <button disabled={busy} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-brand text-white transition hover:bg-brand-dark disabled:bg-disabled">
        {busy && <Loader2 size={16} className="animate-spin" />}
        {mode === 'in' ? '登入' : '建立帳號'}
      </button>
      <p className="mt-3 text-xs text-muted">
        {mode === 'in' ? '還沒有帳號？點上面的「註冊開店」。' : '註冊後會寄一封確認信到你的信箱。'}
      </p>
    </form>
  );
}

function ShopForm() {
  const { createShop, signOut, user } = useStore();
  const [form, setForm] = useState({ name: '', avatar: AVATARS[0], description: '', location: CITIES[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setError('商店名稱至少 2 個字');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createShop({
        ...form,
        name: form.name.trim(),
        description: form.description.trim() || '歡迎光臨！',
      });
    } catch (err) {
      setError(translate(err instanceof Error ? err.message : '建立失敗'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-lg bg-white p-6 shadow-xl">
      <h2 className="text-lg font-bold">建立我的商店</h2>
      <p className="mt-1 text-xs text-muted">以 {user?.email} 登入中・<button type="button" onClick={() => void signOut()} className="text-brand">換帳號</button></p>

      <label className="mt-4 block text-sm">
        商店名稱
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          maxLength={20} placeholder="例如：小花手作雜貨" className={`${inputClass} border-line`} />
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
        <select value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
          className={`${inputClass} border-line bg-white`}>
          {CITIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </label>

      <label className="mt-3 block text-sm">
        商店簡介
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          rows={2} maxLength={80} placeholder="一句話介紹你的商店"
          className={`${inputClass} resize-none border-line`} />
      </label>

      {error && <p className="mt-3 rounded-sm bg-error-bg px-3 py-2 text-sm text-error-text">{error}</p>}

      <button disabled={busy} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-brand text-white transition hover:bg-brand-dark disabled:bg-disabled">
        {busy && <Loader2 size={16} className="animate-spin" />}
        免費開店
      </button>
    </form>
  );
}

/** Supabase 的英文錯誤訊息換成看得懂的中文 */
function translate(message: string) {
  const map: [RegExp, string][] = [
    [/Invalid login credentials/i, 'Email 或密碼不正確'],
    [/Email not confirmed/i, '帳號還沒啟用，請先收信點確認連結'],
    [/User already registered/i, '這個 Email 已經註冊過了，請改用登入'],
    [/Password should be at least/i, '密碼太短，至少 6 個字'],
    [/duplicate key value.*shops_owner_unique/i, '這個帳號已經有一家店了'],
    [/Failed to fetch|NetworkError/i, '連不上伺服器，請檢查網路'],
  ];
  return map.find(([re]) => re.test(message))?.[1] ?? message;
}
