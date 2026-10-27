import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([aria-disabled="true"]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])';

interface Props {
  titleId: string;
  descId?: string;
  /** 標題元素（tabIndex=-1）：開啟時焦點落在這裡 */
  titleRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/**
 * 底部抽屜（手機）／置中對話框（桌機）的外殼：遮罩、面板、焦點陷阱、Esc 關閉、背景鎖捲動、關閉後把焦點還給原本的元素。
 * 登入、檢舉、結帳的地址與綁卡抽屜共用。減少動態時進場動畫由 index.css 的規則關掉。
 * 面板放在內容欄裡（容器吃 --inset-l／--inset-r，側邊姿態讓開直立軌；遮罩仍蓋全螢幕），底緣是 pb-safe，不為膠囊留位（這些頁不顯示膠囊）。
 * 半折（D13，零偵測）：面板掛 .fold-panel——寬 ≥ 620 的直向只佔下半、超過時面板內捲動；橫向（≥ 760）只佔右半、不跨中線帶；< 620 與外蓋橫向不套用。
 * 桌機網頁（md 以上）是置中對話框，fold-panel 的規則由 md: 的類別蓋掉。
 */
export default function SheetShell({ titleId, descId, titleRef, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = before;
      if (previous?.isConnected) previous.focus();
    };
    // 只在掛載與卸載時處理焦點與捲動鎖；titleRef 是穩定的 ref 物件，列進依賴不會讓它重跑
  }, [titleRef]);

  // Esc 與焦點陷阱掛在 document：焦點掉到 body 時（Safari 點按鈕不會讓按鈕取得焦點、按鈕被換掉）面板內的 onKeyDown 收不到
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    let backwards = false;
    const items = () => [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      backwards = e.shiftKey;
      const list = items();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      // data-step-title：登入面板的 S-10 步驟標題（它不是 titleRef，但同樣是 tabindex=-1 的起點）
      if (e.shiftKey && (active === first || active === titleRef.current || (active instanceof HTMLElement && active.hasAttribute('data-step-title')))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    // Safari 預設 Tab 只停在表單欄位，永遠停不到「最後一個按鈕」，上面的首尾判斷接不住：焦點一跑出面板就拉回來
    const onFocusIn = (e: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel || !(e.target instanceof Node) || panel.contains(e.target)) return;
      const list = items();
      (backwards ? list[list.length - 1] : list[0])?.focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('focusin', onFocusIn); };
  }, [titleRef]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center pl-(--inset-l) pr-(--inset-r) md:items-center md:p-4">
      <div className="animate-fade absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        className={[
          'fold-panel animate-auth-panel relative overflow-y-auto rounded-t-2xl bg-white md:max-w-md md:rounded-lg md:shadow-popover',
          // 寬度與限高只在 fold-panel 不接手的條件下給：< 620 與直向要滿欄寬（直向的限高交給 fold-panel）、橫向的寬度與靠右交給 fold-panel（右緣已由容器的 pr 讓出，故 mr-0）
          'max-[619px]:w-full min-[620px]:portrait:w-full max-[619px]:max-h-[90dvh] min-[620px]:landscape:max-h-[90dvh] min-[620px]:landscape:mr-0',
          // 外蓋橫向（678×466，沒有折線）：fold-panel 的 620 門檻會把面板縮成右半的 231 寬，這個區間改回滿欄寬
          'min-[620px]:max-[759px]:landscape:ml-0 min-[620px]:max-[759px]:landscape:w-full',
          // 桌機對話框：回到置中、滿寬（受 max-w-md 限制）、90dvh 限高
          'md:mx-0 md:w-full md:max-h-[90dvh]',
        ].join(' ')}
      >
        {children}
        {/* 底部安全區用墊高的空元素，不用面板自己的 padding-bottom：sticky 的底部確認鈕會停在捲動容器的 padding 內緣，內容就會從鈕的下方露出來 */}
        <div aria-hidden="true" className="pb-safe" />
      </div>
    </div>
  );
}
