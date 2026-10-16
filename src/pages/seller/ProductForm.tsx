import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ImagePlus, Info, Link2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { CATEGORIES } from '../../data/seed';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import EmptyState from '../../components/EmptyState';
import { uid } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { CategoryId, Product } from '../../types';

const MAX_IMAGES = 9;
const MAX_DESCRIPTION = 3000;
const DESCRIPTION_WARN_FROM = 2700;
const thousands = (n: number) => n.toLocaleString('en-US');

/** 字數以 code point 計（等同資料庫 char_length），不用 UTF-16 的 string.length */
const cpLength = (s: string) => [...s].length;

interface VariantRow { id: string; name: string; price: string; original: string; stock: string }

/** 照片先在瀏覽器縮到 800px JPEG 再上傳，省頻寬也省儲存空間 */
const compress = (file: File) =>
  new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', 0.8);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

/** 上傳到 Supabase Storage，回傳公開網址 */
const upload = async (file: File, shopId: string) => {
  const blob = await compress(file);
  const path = `${shopId}/${uid('img')}.jpg`;
  const { error } = await supabase.storage.from('product-images')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
};

export default function ProductForm() {
  const { id } = useParams();
  const { myShop, getProduct, saveProduct } = useStore();
  const existing = id ? getProduct(id) : undefined;

  if (id && (!existing || existing.shopId !== myShop?.id)) {
    return <EmptyState icon="📦" title="找不到這件商品" action={<Link to="/seller/products" className="text-brand">回商品列表</Link>} />;
  }
  return <Form key={id ?? 'new'} existing={existing} shopId={myShop!.id} location={myShop!.location} onSave={saveProduct} />;
}

function Form({ existing, shopId, location, onSave }: {
  existing?: Product; shopId: string; location: string; onSave: (p: Product) => Promise<void>;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [categoryId, setCategoryId] = useState<CategoryId | ''>(existing?.categoryId ?? '');
  const [images, setImages] = useState<string[]>(existing?.images ?? []);
  const [urlInput, setUrlInput] = useState('');
  const [freeShipping, setFreeShipping] = useState(existing?.freeShipping ?? false);
  const [variants, setVariants] = useState<VariantRow[]>(
    existing?.variants.map(v => ({
      id: v.id, name: v.name, price: String(v.price),
      original: v.originalPrice ? String(v.originalPrice) : '', stock: String(v.stock),
    })) ?? [{ id: uid('v'), name: '標準款', price: '', original: '', stock: '' }],
  );
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const num = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);
  const errors = {
    title: title.trim().length < 5 ? '商品名稱至少 5 個字' : '',
    categoryId: !categoryId ? '請選擇分類' : '',
    images: images.length === 0 ? '至少需要 1 張商品圖片' : '',
    variants: variants.some(v => !v.name.trim() || !(num(v.price) > 0) || Number.isNaN(num(v.stock)))
      ? '每個規格都要填名稱、大於 0 的售價與庫存' : '',
    // 原價是選填，但填了就必須高於該規格自己的售價
    original: variants.some(v => v.original && !(num(v.original) > num(v.price)))
      ? '原價要高於同一列的售價，否則請留空' : '',
  };
  const imagesFull = images.length >= MAX_IMAGES;
  const hasError = Object.values(errors).some(Boolean);
  const descLength = cpLength(description);
  const [descLevel, setDescLevel] = useState<'none' | 'near' | 'full'>('none');
  const [descAnnounce, setDescAnnounce] = useState('');
  const descCountTone = descLength > MAX_DESCRIPTION ? 'font-medium text-warning-text'
    : descLength === MAX_DESCRIPTION ? 'font-medium text-error-text'
    : descLength >= DESCRIPTION_WARN_FROM ? 'text-warning-text' : 'text-muted';
  const err = (k: keyof typeof errors) => touched && errors[k] ? <p className="mt-1 text-xs text-error">{errors[k]}</p> : null;

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_IMAGES - images.length;
    const all = [...files].filter(f => f.type.startsWith('image/'));
    const picked = all.slice(0, room);
    if (all.length > picked.length) toast(`最多 ${MAX_IMAGES} 張，已加入前 ${picked.length} 張，其餘略過`);
    if (!picked.length) return;
    setUploading(true);
    try {
      const urls = await Promise.all(picked.map(f => upload(f, shopId)));
      setImages(prev => [...prev, ...urls].slice(0, MAX_IMAGES));
    } catch (err) {
      toast(err instanceof Error ? `圖片上傳失敗：${err.message}` : '圖片上傳失敗');
    } finally {
      setUploading(false);
    }
  };

  const addUrl = () => {
    const u = urlInput.trim();
    if (!/^https?:\/\//.test(u) || images.length >= MAX_IMAGES) return;
    setImages(prev => [...prev, u]);
    setUrlInput('');
  };

  /** 輸入超過上限時擋掉；既有描述已超過上限時不截斷，只允許不再變長的編輯（刪除、改寫） */
  const changeDescription = (next: string) => {
    const nextLen = cpLength(next);
    let accepted: string | null = null;
    if (nextLen <= MAX_DESCRIPTION || nextLen <= descLength) accepted = next;
    else if (descLength < MAX_DESCRIPTION) accepted = [...next].slice(0, MAX_DESCRIPTION).join('');
    if (accepted === null) return;
    setDescription(accepted);
    // 只在跨進「接近上限」「達上限」的那一刻朗讀一次，不逐字播報
    const len = cpLength(accepted);
    const level = len === MAX_DESCRIPTION ? 'full' : len >= DESCRIPTION_WARN_FROM && len < MAX_DESCRIPTION ? 'near' : 'none';
    if (level !== descLevel) {
      setDescLevel(level);
      setDescAnnounce(level === 'full' ? '已達字數上限' : level === 'near' ? `還能輸入 ${MAX_DESCRIPTION - len} 字` : '');
    }
  };

  const submit = async (status: Product['status']) => {
    setTouched(true);
    if (hasError) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    try {
      await onSave({
      // 編輯頁沒動到的欄位（匯入來的 source、規格的 sourceId／image 等）原樣帶回，不可只寫表單認得的欄位
      ...existing,
      id: existing?.id ?? uid('p'),
      shopId,
      title: title.trim(),
      // 沒改過的描述原樣保留（不 trim、不截斷）；超過 3,000 字的匯入描述靠這行才不會被動到
      description: description === existing?.description ? description : description.trim(),
      categoryId: categoryId as CategoryId,
      images,
        variants: variants.map(v => ({
          ...existing?.variants.find(o => o.id === v.id),
          id: v.id, name: v.name.trim(), price: num(v.price), stock: num(v.stock),
          // 清空原價要真的拿掉；undefined 序列化成 JSON 時會被丟棄
          originalPrice: v.original ? num(v.original) : undefined,
        })),
      freeShipping,
      status,
      sold: existing?.sold ?? 0,
      rating: existing?.rating ?? 5,
      location: existing?.location ?? location,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      toast(status === 'active' ? (existing ? '已儲存並上架' : '商品已上架') : '已儲存（下架中）');
      navigate('/seller/products');
    } catch (err) {
      toast(err instanceof Error ? `儲存失敗：${err.message}` : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const card = 'rounded-lg bg-white p-4 md:p-6';
  const input = 'w-full rounded-sm border border-line px-3 py-2.5 text-sm outline-none focus:border-ink';

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20">
      <h1 className="text-xl font-bold">{existing ? '編輯商品' : '新增商品'}</h1>

      {touched && hasError && (
        <p className="rounded-md bg-error-bg px-4 py-3 text-sm text-error-text">還有欄位沒填好，請檢查標紅的地方。</p>
      )}

      <section className={card}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-medium">商品圖片 <span className="text-xs font-normal text-muted">（最多 {MAX_IMAGES} 張，第一張為封面）</span></h2>
          <span className={`text-xs tabular-nums ${images.length >= MAX_IMAGES ? 'font-medium text-ink' : 'text-muted'}`}>{images.length}/{MAX_IMAGES}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {images.map((src, i) => (
            <div key={i} className="group relative w-24">
              <ProductImage src={src} alt={`圖片 ${i + 1}`} size="sm" className="w-24 rounded-md border border-line" />
              {i === 0 && <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/55 text-center text-[10px] leading-5 text-white">封面</span>}
              <button type="button" aria-label={`移除圖片 ${i + 1}`} onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white">
                <X size={14} />
              </button>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
              className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-brand bg-brand-soft/50 text-xs text-brand transition hover:bg-brand-soft disabled:opacity-60">
              {uploading ? <Loader2 size={24} className="animate-spin" /> : <ImagePlus size={24} strokeWidth={1.5} />}
              {uploading ? '上傳中…' : '上傳照片'}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
        <div className="mt-3 flex gap-2">
          <label className={`flex flex-1 items-center gap-2 rounded-sm border border-line px-3 ${imagesFull ? 'bg-subtle' : ''}`}>
            <Link2 size={16} className="text-muted" />
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
              disabled={imagesFull} aria-label="圖片網址"
              placeholder={imagesFull ? `已達上限 ${MAX_IMAGES} 張` : '或貼上圖片網址 https://…'} className="h-9 flex-1 bg-transparent text-sm outline-none" />
          </label>
          <button type="button" onClick={addUrl} disabled={imagesFull} className="rounded-sm border border-line px-3 text-sm hover:bg-canvas disabled:text-disabled disabled:hover:bg-transparent">加入</button>
        </div>
        {imagesFull && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Info size={16} aria-hidden="true" className="shrink-0" /> 已達上限 {MAX_IMAGES} 張。要新增請先移除一張。</p>
        )}
        {err('images')}
      </section>

      <section className={`${card} space-y-4`}>
        <h2 className="font-medium">基本資訊</h2>
        <label className="block text-sm">
          商品名稱
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="品牌＋商品名稱＋特色，例如：手工陶瓷馬克杯 350ml 可微波" className={`mt-1 ${input}`} />
          <span className="mt-1 block text-right text-xs text-muted">{title.length}/60</span>
          {err('title')}
        </label>
        <label className="block text-sm">
          分類
          <select value={categoryId} onChange={e => setCategoryId(e.target.value as CategoryId)} className={`mt-1 bg-white ${input}`}>
            <option value="">請選擇</option>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          {err('categoryId')}
        </label>
        <div className="text-sm">
          <label htmlFor="product-description">商品描述 <span className="text-muted">（選填）</span></label>
          <textarea id="product-description" value={description} onChange={e => changeDescription(e.target.value)} rows={6}
            placeholder="材質、尺寸、使用方式、注意事項…" className={`mt-1 resize-y ${input}`} />
          <div className="mt-1 flex justify-between gap-3 text-xs">
            <span className={descLength === MAX_DESCRIPTION ? 'text-error-text' : 'text-warning-text'}>
              {descLength === MAX_DESCRIPTION ? '已達字數上限'
                : descLength >= DESCRIPTION_WARN_FROM && descLength < MAX_DESCRIPTION ? `還能輸入 ${MAX_DESCRIPTION - descLength} 字` : ''}
            </span>
            <span className={`tabular-nums ${descCountTone}`}>{thousands(descLength)}/{thousands(MAX_DESCRIPTION)}</span>
          </div>
          <p role="status" className="sr-only">{descAnnounce}</p>
          {descLength > MAX_DESCRIPTION && (
            <p className="mt-2 flex items-start gap-1.5 rounded-sm border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-text">
              <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
              目前 {thousands(descLength)} 字，超過編輯上限 {thousands(MAX_DESCRIPTION)} 字（匯入的描述）。不修改描述可以直接儲存；要增加內容請先刪減。
            </p>
          )}
        </div>
      </section>

      <section className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">規格與庫存</h2>
          <button type="button" onClick={() => setVariants(v => [...v, { id: uid('v'), name: '', price: v[v.length - 1]?.price ?? '', original: v[v.length - 1]?.original ?? '', stock: '' }])}
            className="flex items-center gap-1 text-sm text-brand"><Plus size={16} /> 新增規格</button>
        </div>
        <div className="hidden grid-cols-[1fr_110px_110px_90px_36px] gap-2 text-xs text-muted md:grid">
          <span>規格名稱（如：黑色 / L）</span><span>售價</span><span>原價（選填）</span><span>庫存</span><span />
        </div>
        {variants.map((v, i) => {
          const patch = (p: Partial<VariantRow>) => setVariants(rows => rows.map(r => (r.id === v.id ? { ...r, ...p } : r)));
          return (
            <div key={v.id} className="grid grid-cols-[1fr_1fr_36px] gap-2 rounded-md bg-canvas p-2 md:grid-cols-[1fr_110px_110px_90px_36px] md:bg-transparent md:p-0">
              <input aria-label={`規格 ${i + 1} 名稱`} value={v.name} onChange={e => patch({ name: e.target.value })} placeholder="規格名稱" className={`col-span-3 bg-white md:col-span-1 ${input}`} />
              <input aria-label={`規格 ${i + 1} 售價`} value={v.price} inputMode="numeric" onChange={e => patch({ price: e.target.value.replace(/\D/g, '') })} placeholder="$ 售價" className={`bg-white ${input}`} />
              <input aria-label={`規格 ${i + 1} 原價`} value={v.original} inputMode="numeric" onChange={e => patch({ original: e.target.value.replace(/\D/g, '') })} placeholder="$ 原價" className={`col-span-2 bg-white md:col-span-1 ${input}`} />
              <input aria-label={`規格 ${i + 1} 庫存`} value={v.stock} inputMode="numeric" onChange={e => patch({ stock: e.target.value.replace(/\D/g, '') })} placeholder="庫存" className={`bg-white ${input}`} />
              <button type="button" aria-label="刪除規格" disabled={variants.length === 1} onClick={() => setVariants(rows => rows.filter(r => r.id !== v.id))}
                className="flex items-center justify-center text-muted hover:text-error disabled:opacity-30"><Trash2 size={17} /></button>
            </div>
          );
        })}
        {err('variants')}
        {err('original')}
        <p className="text-xs text-muted">填了原價，商品頁與商品卡就會顯示劃掉的原價與折扣百分比。</p>
        <div className="grid gap-4 border-t border-line pt-4 md:grid-cols-2">
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
            <input type="checkbox" checked={freeShipping} onChange={e => setFreeShipping(e.target.checked)} className="h-4 w-4 accent-brand" />
            這件商品由我吸收運費（免運）
          </label>
        </div>
      </section>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 flex justify-end gap-2 border-t border-line bg-white px-4 py-3 md:left-56 md:px-6">
        <button type="button" onClick={() => navigate(-1)} className="rounded-sm px-4 py-2.5 text-sm text-muted hover:bg-canvas">取消</button>
        <button type="button" disabled={saving || uploading} onClick={() => void submit('hidden')} className="rounded-sm border border-line px-4 py-2.5 text-sm hover:bg-canvas disabled:opacity-50">儲存但不上架</button>
        <button type="button" disabled={saving || uploading} onClick={() => void submit('active')} className="flex items-center gap-2 rounded-sm bg-brand px-6 py-2.5 text-sm text-white hover:bg-brand-dark disabled:bg-disabled">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {existing?.status === 'active' ? '儲存' : '儲存並上架'}
        </button>
      </div>
    </div>
  );
}
