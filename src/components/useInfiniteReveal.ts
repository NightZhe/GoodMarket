import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigationType } from 'react-router-dom';
import { hasMore, initialShown, nextShown, showBackToTop, type RevealNav } from '../lib/ui/revealPolicy';
import { scrollPageToTop } from '../lib/ui/scroll';

/**
 * 列表無限捲動（首頁「全部商品」與逛逛結果共用）：滑近底部自動多畫一批，規則在 revealPolicy。
 * 整頁捲動，不建立內層捲動容器。資料仍是進站一次抓全部，所以多畫一批是瞬間完成，不放 spinner。
 *
 * - 哨兵（sentinelRef）放在列表最後一件之後；用 IntersectionObserver 觀察，rootMargin 一個視窗高，
 *   提前畫好所以看不到空白。每次件數變動會重新觀察，哨兵仍在範圍內就會連續補批。
 * - 沒有 IntersectionObserver（舊瀏覽器、靜態渲染）時回報 showFallback，頁面畫原本的「顯示更多商品」按鈕。
 * - 件數與捲動位置寫在 sessionStorage（key＝記憶 key）。只有「返回」（POP）才還原；其餘導覽從第一批、頂端開始。
 * - 背景重讀讓 items 變少時，畫出的件數自動截短（不寫回 state，資料又變多時能回來）。
 */
export function useInfiniteReveal<T>(items: T[], memoryKey: string) {
  const nav: RevealNav = useNavigationType() === 'POP' ? 'back' : 'go';
  const total = items.length;
  const observable = typeof IntersectionObserver !== 'undefined';

  // state 存「想畫幾件」，不先截到總件數：資料暫時變少又變多時不會把使用者的進度弄丟
  const [state, setState] = useState(() => ({ key: memoryKey, want: startWant(memoryKey, nav) }));
  let want = state.want;
  if (state.key !== memoryKey) {
    // 篩選條件變了：換記憶 key，從第一批開始（返回到舊條件則還原）。在 render 中更新，不會閃一下舊件數
    want = startWant(memoryKey, nav);
    setState({ key: memoryKey, want });
  }
  const shown = Math.min(want, total);
  const more = hasMore(total, shown);

  // 最近一次的捲動位置。離開時要寫進記憶，但元件卸載時新頁面可能已經把文件高度縮短、捲動位置被瀏覽器夾住，所以平時就追蹤
  const scrollY = useRef(0);
  useEffect(() => {
    const onScroll = () => { scrollY.current = window.scrollY; };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 件數變動就記下來
  useEffect(() => { remember(memoryKey, { shown }); }, [memoryKey, shown]);

  // 進頁（返回）：畫面提交後再把捲動位置設回去，高度才夠。換 key 時：前往 → 捲到頂；返回 → 還原。
  // 離開（卸載或換 key）時，cleanup 先把捲動位置寫進舊 key 的記憶，再輪到新 key 去捲動
  const first = useRef(true);
  useLayoutEffect(() => {
    const isFirst = first.current;
    first.current = false;
    if (nav === 'back') {
      const y = recall(memoryKey)?.scrollY;
      if (y !== undefined) window.scrollTo(0, y);
    } else if (!isFirst) {
      window.scrollTo(0, 0);
    }
    return () => remember(memoryKey, { scrollY: scrollY.current });
    // nav 只在進頁與換 key 那一刻讀，它自己變動（例如同一頁的下一次導覽）不該觸發捲動
  }, [memoryKey]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!observable || !el || !more) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setState(s => ({ key: s.key, want: nextShown(total, Math.min(s.want, total)) }));
        }
      },
      { rootMargin: '100% 0px 100% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [observable, more, shown, total]);

  return {
    /** 這次要畫的子陣列 */
    visible: items.slice(0, shown),
    /** 掛在列表最後一件之後的零高度元素（aria-hidden） */
    sentinelRef,
    /** 畫到最後一件且超過一批：顯示「回到頂端」 */
    showBackToTop: showBackToTop(total, shown),
    /** 沒有 IntersectionObserver 時退回「顯示更多商品」按鈕 */
    showFallback: !observable && more,
    showMore: () => setState(s => ({ key: s.key, want: nextShown(total, Math.min(s.want, total)) })),
    backToTop: scrollPageToTop,
  };
}

interface Memory { shown?: number; scrollY?: number }

function recall(key: string): Memory | undefined {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
    if (!raw) return undefined;
    const m: unknown = JSON.parse(raw);
    if (typeof m !== 'object' || m === null) return undefined;
    const { shown, scrollY } = m as Record<string, unknown>;
    return {
      shown: typeof shown === 'number' && Number.isFinite(shown) ? shown : undefined,
      scrollY: typeof scrollY === 'number' && Number.isFinite(scrollY) ? scrollY : undefined,
    };
  } catch {
    // 記憶只是加分功能：無痕模式或內容壞掉時當作沒有記憶，從第一批開始
    return undefined;
  }
}

function remember(key: string, patch: Memory) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...recall(key), ...patch }));
  } catch {
    // 儲存空間滿了或被禁用：下次返回只是從頂端第一批開始，不影響當下使用
  }
}

/** 起始想畫件數：不截到總件數（Infinity），截斷交給 render 時的 min */
function startWant(key: string, nav: RevealNav) {
  return initialShown(Infinity, nav, recall(key)?.shown);
}
