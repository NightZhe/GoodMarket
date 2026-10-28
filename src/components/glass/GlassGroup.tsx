import { Fragment, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Ellipsis } from 'lucide-react';
import { GlassButton } from './GlassButton';
import { groupWidth, shouldCollapse } from './glassGroupFit';
import { useElementWidth } from './useElementWidth';

export type GlassGroupItem = {
  key: string;
  /** 朗讀名稱，也是收合後浮層那一列的文字 */
  label: string;
  /** 圖示（lucide 22pt、線寬 1.7）。aria-hidden 由元件包 */
  icon: ReactNode;
  /** 前面畫一條細分隔線（例如把破壞性的「登出」隔開）。收合後變成浮層裡的分隔線 */
  separatorBefore?: boolean;
  /** 這項會開對話框：給 aria-haspopup="dialog"（只對 onClick 項有效） */
  hasPopup?: 'dialog';
} & ({ to: string; onClick?: never } | { onClick: () => void; to?: never });

export type GlassGroupHandle = {
  /** 把焦點交給某一項；收合時交給「⋯」鈕（對話框關閉後把焦點還給呼叫的地方） */
  focusItem: (key: string) => void;
  /** 把焦點交給第一個看得到的控制項（左鈕消失時接手） */
  focusFirst: () => void;
};

type Props = {
  /** 群組的名稱（VoiceOver 唸）。群組本身不包 <nav>，由呼叫端把它放進有名稱的 nav */
  label: string;
  items: GlassGroupItem[];
  /** 收合後「⋯」鈕的朗讀名稱 */
  collapseLabel?: string;
  /** 一律收合（忽略寬度判斷） */
  forceCollapse?: boolean;
  handleRef?: Ref<GlassGroupHandle>;
};

/**
 * 水平懸浮玻璃膠囊群組：一顆 .glass 膠囊裡放 n 格 44×44 的圖示鈕（可選細分隔線）。
 * 放進 flex 列裡，自己撐滿剩下的寬度並靠右；「放不放得下」量這個空間的實際寬度（不看機型）：
 * 放得下＝整組露出；放不下＝收成一顆 44 的「⋯」玻璃圓鈕，點開在鈕下方 8 出現同樣各項的浮層（design.md §5、U-9）。
 * 浮層：點項目＝導頁／執行並關；點外面只關（透明遮罩接住那一下，不穿透）；Esc、換頁、回到夠寬、App 回前景都會關；開啟時焦點到第一項，關閉回「⋯」。
 * 減少動態：浮層只淡入淡出（index.css）。
 */
export function GlassGroup({ label, items, collapseLabel = '更多', forceCollapse = false, handleRef }: Props) {
  const popId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const room = useElementWidth(wrapRef);
  const width = groupWidth(items.length, items.filter(i => i.separatorBefore).length);
  const collapsed = shouldCollapse(room, width, forceCollapse);

  const { pathname } = useLocation();
  // 記下「在哪一頁打開的」：換頁就自然視為關閉，不必用 effect 回頭關（同 GlassCapsule 的 L2 浮層）
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = collapsed && openAt === pathname;
  const close = () => setOpenAt(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const collapsedRef = useRef(collapsed);
  useLayoutEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  useImperativeHandle(handleRef, () => ({
    focusItem: key => (collapsedRef.current ? triggerRef.current : cellRefs.current.get(key) ?? wrapRef.current?.querySelector<HTMLElement>('a,button'))?.focus(),
    focusFirst: () => (collapsedRef.current ? triggerRef.current : wrapRef.current?.querySelector<HTMLElement>('a,button'))?.focus(),
  }), []);

  // 離開收合（旋轉、取消縮放）就清掉「打開過」，否則回到窄寬時浮層會自己重新展開
  useEffect(() => { if (!collapsed) setOpenAt(null); }, [collapsed]);

  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenAt(null);
      triggerRef.current?.focus();
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') setOpenAt(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHidden);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHidden); };
  }, [open]);

  return (
    <div ref={wrapRef} className="flex min-w-0 flex-1 justify-end">
      {collapsed ? (
        <div className="pointer-events-auto relative">
          <button
            ref={triggerRef} type="button" aria-label={collapseLabel} aria-expanded={open} aria-controls={popId} aria-haspopup="true"
            onClick={() => setOpenAt(open ? null : pathname)}
            className={`glass glass-btn z-40 flex size-11 items-center justify-center rounded-full text-brand ${open ? 'bg-press-glass' : ''}`}
          >
            <Ellipsis size={22} strokeWidth={1.7} aria-hidden="true" />
          </button>
          {open && <div aria-hidden="true" onClick={close} className="fixed inset-0 z-40" />}
          <div ref={popRef} id={popId} role="group" aria-label={label} data-open={open} inert={!open} className="glass-group-pop z-50">
            {items.map(item => (
              <Fragment key={item.key}>
                {item.separatorBefore && <div aria-hidden="true" className="mx-3.5 my-1 h-[0.5px] bg-separator" />}
                <PopRow item={item} onDone={close} />
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div role="group" aria-label={label} className="glass glass-group pointer-events-auto">
          {items.map(item => (
            <Fragment key={item.key}>
              {item.separatorBefore && <span aria-hidden="true" className="glass-group-sep" />}
              {item.to !== undefined
                ? <GlassButton to={item.to} label={item.label} title={item.label} icon={item.icon} />
                : <GlassButton
                    onClick={item.onClick} label={item.label} title={item.label} icon={item.icon} hasPopup={item.hasPopup}
                    buttonRef={el => { cellRefs.current.set(item.key, el); }}
                  />}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

const ROW = 'flex min-h-12 w-full items-center gap-3 rounded-[14px] px-3.5 text-left text-body text-ink active:bg-press';

function PopRow({ item, onDone }: { item: GlassGroupItem; onDone: () => void }) {
  const body = (
    <>
      <span aria-hidden="true" className="flex shrink-0 text-brand">{item.icon}</span>
      <span className="min-w-0">{item.label}</span>
    </>
  );
  return item.to !== undefined
    ? <Link to={item.to} onClick={onDone} className={ROW}>{body}</Link>
    : <button type="button" onClick={() => { onDone(); item.onClick(); }} aria-haspopup={item.hasPopup} className={ROW}>{body}</button>;
}
