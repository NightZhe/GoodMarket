import { Children, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { ChevronUp } from 'lucide-react';
import { usePosture } from '../../lib/layout/posture';
import { TabCell, useTabLabels, type TabItem } from './tabs';
import { RAIL_CAP_W } from './railGeometry';
import { RAIL_GAP, pickRailLevel } from './railLevel';
import { reportRailTools, useRailToolsHeight } from './railRoom';

type Common = {
  /** 這組膠囊的名稱（VoiceOver 唸）：工具組「頁面工具」、分頁組「主要分頁」「賣家中心分頁」 */
  label: string;
};

type Props = Common & (
  /** 工具組（上方，有名稱的 <nav>）：children 放 GlassButton，由上而下。順序由呼叫端決定（C1：返回 → 購物車 → 分享；賣家：只有一顆「回到買家首頁」）。永不壓縮 */
  | { children: ReactNode; tabs?: never }
  /** 分頁組（下方）：5 格（買家、賣家同一份）。層級 L0／L1／L2 依可用高度自動選，呼叫端不必管 */
  | { tabs: TabItem[]; children?: never }
);

/** 標籤可用寬度＝軌寬扣左右各 4（§7.3） */
const LABEL_ROOM = RAIL_CAP_W - 8;

/**
 * 側邊姿態的直立玻璃軌（design-spec §3.2）。一條軌＝兩個獨立膠囊：工具組（貼 --rail-top）與分頁組（貼 --rail-bottom），
 * 中間的空白是畫面本身。兩者各自掛在 DOM 該在的位置（工具組在頁首、分頁組在最後），VoiceOver 順序不因姿態改變。
 * 軌在系統欄同一側（data-bars 決定左右）；起點與底緣依姿態實測，數字在 index.css 的 html[data-rail]（外螢幕三姿態不同，X9）。
 * 只在側邊姿態出現；bottom 姿態自己回傳 null（改由 TabPill／各頁自己的位置負責）。
 * 工具組與分頁組各是一個有名稱的 <nav>（AC-15：沒有分頁組的第二層頁，控制欄也要是導覽區域）；分頁組高度不夠時 L0（圖示＋標籤）→ L1（純圖示）→ L2（一顆「目前分頁」鈕，點開成 L1 浮層）。
 */
export function GlassCapsule(props: Props) {
  if (usePosture() === 'bottom') return null;
  return props.tabs
    ? <TabsBody label={props.label} tabs={props.tabs} />
    : <ToolsBody label={props.label}>{props.children}</ToolsBody>;
}

function ToolsBody({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  // 把自己的高度報給分頁組（它要扣掉才知道自己有多少高度）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => reportRailTools(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => { ro.disconnect(); reportRailTools(0); };
  }, []);
  // 只有一顆（例如首頁購物車）時外殼是 48×48 圓，不是 48×56 膠囊（X11）
  const solo = Children.toArray(children).length === 1;
  return <nav ref={ref} aria-label={label} className={`glass glass-capsule glass-capsule--tools ${solo ? 'glass-capsule--solo' : ''}`}>{children}</nav>;
}

function TabsBody({ label, tabs }: { label: string; tabs: TabItem[] }) {
  const { ref: navRef, fit } = useTabLabels(LABEL_ROOM);
  const toolsHeight = useRailToolsHeight();
  const { pathname } = useLocation();
  const popId = useId();

  // 軌的區間（--rail-top 到 --rail-bottom）用隱形探針量：幾何全在 CSS，這裡不重複數字，姿態、字級、安全區變了它自己會動
  const probeRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY); // 量到之前先當作放得下，layout effect 在繪製前就會改
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const measure = () => setRoom(probe.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(probe);
    return () => ro.disconnect();
  }, []);

  const level = pickRailLevel({
    available: room - (toolsHeight > 0 ? toolsHeight + RAIL_GAP : 0),
    count: tabs.length,
    labelsFit: fit,
  });

  // L2 浮層的開關。記下「在哪一頁打開的」：換頁（含返回鍵）就自然視為關閉，不必用 effect 回頭關
  const [openAt, setOpenAt] = useState<string | null>(null);
  // 離開 L2（旋轉、字級讓高度變夠）就把「打開過」清掉：否則同一頁 L2→L0→L2 時浮層會自己重新展開。
  // 用 render 期間調整 state（React 建議的寫法），不用 effect，不多繪一格
  const [prevLevel, setPrevLevel] = useState(level);
  if (prevLevel !== level) {
    setPrevLevel(level);
    if (level !== 'L2') setOpenAt(null);
  }
  const expanded = level === 'L2' && openAt === pathname;
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpenAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenAt(null);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKey); };
  }, [expanded]);

  // 沒有任何分頁對得上（例如店家頁）就拿第一格當「目前」，與設計稿一致
  const current = tabs.find(t => matchPath({ path: t.to, end: !!t.end }, pathname)) ?? tabs[0];
  const labeled = level === 'L0';

  return (
    <div ref={wrapRef} data-level={level} className="glass-rail-tabs">
      {level === 'L2' && (
        <button
          ref={triggerRef}
          type="button"
          aria-label={`分頁：${current.label}`}
          aria-expanded={expanded}
          aria-controls={popId}
          onClick={() => setOpenAt(expanded ? null : pathname)}
          className="glass glass-rail-trigger text-brand"
        >
          <span aria-hidden="true" className="flex">{current.iconActive ?? current.icon}</span>
          <ChevronUp size={12} strokeWidth={3} aria-hidden="true" className="absolute bottom-1 right-1 text-muted" />
        </button>
      )}
      {/* 同一個 <nav> 與格子在三個層級都在 DOM 裡（L2 收起時只是看不見、不可聚焦），標籤寬度才量得到，字級縮回來時也能自己回到 L0 */}
      <nav
        ref={navRef}
        id={popId}
        aria-label={label}
        data-open={expanded}
        inert={level === 'L2' && !expanded}
        onClick={() => {
          if (!expanded) return;
          // 點浮層內的分頁：浮層收起後 <nav> 會 inert，焦點若還在裡面會掉到 body，所以先交回 L2 鈕（Esc 路徑同樣做法）
          setOpenAt(null);
          triggerRef.current?.focus();
        }}
        className={`glass glass-rail-body ${level === 'L2' ? 'glass-rail-pop' : ''}`}
      >
        {tabs.map(item => <TabCell key={item.to} item={item} kind="rail" labeled={labeled} compact={!labeled} />)}
      </nav>
      <div ref={probeRef} aria-hidden="true" className="glass-rail-room" />
    </div>
  );
}
