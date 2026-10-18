import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CircleAlert, LoaderCircle } from 'lucide-react';

// 帳號子頁（個人檔案、地址）共用的 class 與小元件。class 逐字取自設計稿 1.2；只用 index.css 現有 token。

export const labelCls = 'block text-sm font-medium';
/**
 * 輸入框 class。邊框色與聚焦樣式依有沒有錯誤二選一（錯誤態優先於聚焦態，不要兩組同時下）；
 * 同一個屬性不會從兩組 class 同時出現（Tailwind 以產生順序而不是 class 順序決定誰贏）。
 * zip：唯讀的衍生值（郵遞區號），淡框淡底，不是互動元件。
 */
export type FieldKind = 'input' | 'select' | 'textarea' | 'zip';
const FOCUS_OK = 'border-muted focus:border-ink focus:outline focus:outline-1 focus:-outline-offset-1 focus:outline-ink';
const FOCUS_BAD = 'border-error-text focus:outline focus:outline-1 focus:-outline-offset-1 focus:outline-error-text';
export function fieldCls(bad: boolean, kind: FieldKind = 'input', empty = false): string {
  const base = 'block w-full rounded-sm px-3 text-base outline-none placeholder:text-muted';
  if (kind === 'zip') return `${base} h-12 border border-line bg-subtle tabular-nums text-ink`;
  const edge = bad ? FOCUS_BAD : FOCUS_OK;
  if (kind === 'textarea') return `${base} min-h-[6.75rem] resize-none border bg-white py-3 leading-6 text-ink read-only:bg-subtle ${edge}`;
  if (kind === 'select') {
    return `${base} h-12 appearance-none border bg-white pr-10 ${empty ? 'text-muted' : 'text-ink'} disabled:border-line disabled:bg-subtle disabled:text-muted ${edge}`;
  }
  return `${base} h-12 border bg-white text-ink read-only:bg-subtle ${edge}`;
}
/** 儲存中的主按鈕：維持品牌色（btnPrimary 的 aria-disabled 會變灰，那是「不能按」，這裡是「處理中」） */
export const savingBtn = 'inline-flex min-h-11 cursor-wait items-center justify-center gap-1.5 rounded-sm bg-brand px-4 text-sm font-medium text-white';
export const helpCls = 'mt-1 text-sm text-muted';
/** 主、次按鈕的尺寸與按壓回饋 */
export const pressCls = 'transition-transform duration-150 motion-safe:active:scale-[0.98]';
export const bigBtn = `h-12 w-full text-base ${pressCls}`;
/** 列內文字動作（編輯、設為預設、刪除）：高度 44 */
export const textActionCls = 'inline-flex min-h-11 items-center px-2 text-sm font-medium transition-transform duration-150 motion-safe:active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1 flex items-start gap-1.5 text-sm text-error-text">
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** 返回（確定的 Link，不用 history.back）＋標題的白色標題列 */
export function SubHeader({ to, backLabel, title }: { to: string; backLabel: string; title: string }) {
  return (
    <header className="flex items-center gap-1 bg-white px-2 pr-4 md:rounded-md">
      <Link to={to} aria-label={backLabel} className="flex h-11 w-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand">
        <ArrowLeft size={22} aria-hidden="true" />
      </Link>
      <h1 className="min-w-0 text-base font-medium md:text-lg">{title}</h1>
    </header>
  );
}

/** 子頁外層。noTabBar：新增／編輯頁藏起底部分頁，頁尾要自己補安全區域 */
export function SubPage({ children, noTabBar = false }: { children: ReactNode; noTabBar?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl md:px-4 md:pt-6">
      {children}
      {noTabBar ? <div className="pb-safe"><div className="h-6" /></div> : <div className="h-6" />}
    </div>
  );
}

/** 區塊標題列的 h2（灰底、粗體 ink） */
export const sectionTitleCls = 'px-4 pb-2 pt-5 text-sm font-bold md:px-0 md:pt-6';

export function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle size={size} className="motion-safe:animate-spin" aria-hidden="true" />;
}

/** 載入中的骨架條：靜態，不閃爍 */
export const Bone = ({ className }: { className: string }) => <span aria-hidden="true" className={`block rounded-sm bg-line ${className}`} />;

/** 勾選框列：整列 label 承擔點擊與讀屏（原生框只有 20px，列高 ≥44）；說明字是 label 的一部分，聚焦時會讀出 */
export function CheckRow({ id, checked, disabled = false, onChange, label, note }: {
  id: string; checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; label: string; note?: string;
}) {
  return (
    <label htmlFor={id} className={`mt-4 flex min-h-11 items-start gap-3 py-2 ${disabled ? 'text-muted' : ''}`}>
      <input
        id={id} type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange?.(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
      />
      <span className="min-w-0">
        <span className="block text-base">{label}</span>
        {note && <span className="mt-0.5 block text-sm text-muted">{note}</span>}
      </span>
    </label>
  );
}
