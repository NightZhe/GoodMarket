import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary, { CrashScreen, ItemBoundary, SectionBoundary, SectionFallback } from './ErrorBoundary';

// 測試環境沒有 DOM（node），伺服器端渲染也不會走 boundary 的錯誤路徑。
// 所以這裡直接驅動 class 的生命週期：先確認子元件確實會丟例外，
// 再用 getDerivedStateFromError 得到的 state 取得 boundary 實際渲染的內容。

const Boom = (): ReactNode => { throw new Error('壞掉的子元件'); };

/** 模擬 React 的流程：渲染子樹丟例外 → getDerivedStateFromError → 重新 render boundary */
function renderAfterCatch(boundary: ErrorBoundary): ReactNode {
  boundary.state = ErrorBoundary.getDerivedStateFromError();
  return boundary.render();
}

describe('ErrorBoundary', () => {
  it('子元件丟例外時，boundary 改渲染替代內容；兄弟區塊仍在', () => {
    expect(() => renderToStaticMarkup(<Boom />)).toThrow();

    const b = new ErrorBoundary({ children: <Boom />, fallback: <p>替代內容</p> });
    const page = (
      <main>
        <section>{renderAfterCatch(b)}</section>
        <section>兄弟區塊</section>
      </main>
    );
    const html = renderToStaticMarkup(page);
    expect(html).toContain('替代內容');
    expect(html).toContain('兄弟區塊');
    expect(html).not.toContain('壞掉的子元件');
  });

  it('沒有錯誤時原樣渲染子元件', () => {
    const b = new ErrorBoundary({ children: <p>正常</p>, fallback: <p>替代</p> });
    expect(renderToStaticMarkup(<>{b.render()}</>)).toBe('<p>正常</p>');
  });

  it('單張卡片的 boundary 壞了回 null（只少這一張）', () => {
    const b = new ErrorBoundary({ children: <Boom />, fallback: null });
    expect(renderAfterCatch(b)).toBeNull();
    expect(typeof ItemBoundary).toBe('function');
  });

  it('區塊替代內容是繁中，有「再試一次」；reset 會清掉錯誤狀態', () => {
    const html = renderToStaticMarkup(<SectionFallback onRetry={() => {}} />);
    expect(html).toContain('這個區塊暫時無法顯示');
    expect(html).toContain('再試一次');
    expect(html).not.toMatch(/Error|Unexpected/);

    const b = new ErrorBoundary({ children: <p>ok</p>, fallback: reset => <button onClick={reset}>x</button> });
    const setState = vi.fn();
    b.setState = setState;
    b.reset();
    expect(setState).toHaveBeenCalledWith({ failed: false });
  });

  it('SectionBoundary 正常時不影響子元件', () => {
    expect(renderToStaticMarkup(<SectionBoundary><p>列表</p></SectionBoundary>)).toBe('<p>列表</p>');
  });

  it('根部整頁錯誤畫面：繁中文案與「重新整理」', () => {
    const html = renderToStaticMarkup(<CrashScreen />);
    expect(html).toContain('頁面發生問題');
    expect(html).toContain('重新整理');
    expect(html).not.toMatch(/Something went wrong|Unexpected/);
  });
});
