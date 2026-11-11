import { Component, type ErrorInfo, type ReactNode } from 'react';
import EmptyState from './EmptyState';
import { pillButton, pillButtonPrimary } from './pillButton';

interface Props {
  children: ReactNode;
  /** 出錯時顯示的內容；null＝這塊直接不顯示（例如單張商品卡） */
  fallback: ReactNode | ((reset: () => void) => ReactNode);
  /** 記錄用的名稱 */
  name?: string;
}

interface State { failed: boolean }

/** 子樹 render 丟例外時只替換這一塊，其餘畫面照常。 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name ?? 'unnamed'}]`, error.message, info.componentStack);
  }

  reset = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === 'function' ? fallback(this.reset) : fallback;
  }
}

/** 整頁錯誤畫面：根部 boundary 與路由的 errorElement 共用 */
export function CrashScreen() {
  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto max-w-xl">
        <EmptyState
          title="頁面發生問題"
          description="很抱歉，這一頁暫時無法顯示。請重新整理再試一次。"
          action={
            <button type="button" onClick={() => window.location.reload()} className={pillButtonPrimary}>
              重新整理
            </button>
          }
        />
      </div>
    </div>
  );
}

/** 區塊級替代內容 */
export function SectionFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      title="這個區塊暫時無法顯示"
      description="頁面其他內容不受影響。"
      action={<button type="button" onClick={onRetry} className={pillButton}>再試一次</button>}
    />
  );
}

/** 包住商品列表區塊（貨架、格狀列表）：壞了只換掉這一塊 */
export function SectionBoundary({ children, name }: { children: ReactNode; name?: string }) {
  return (
    <ErrorBoundary name={name} fallback={reset => <SectionFallback onRetry={reset} />}>
      {children}
    </ErrorBoundary>
  );
}

/** 根部：整頁替代畫面 */
export function RootBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary name="root" fallback={<CrashScreen />}>{children}</ErrorBoundary>;
}

/** 單張卡片：壞了就只少這一張 */
export function ItemBoundary({ children, name }: { children: ReactNode; name?: string }) {
  return <ErrorBoundary name={name} fallback={null}>{children}</ErrorBoundary>;
}
