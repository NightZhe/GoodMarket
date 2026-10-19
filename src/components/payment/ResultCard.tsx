import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  /** 按鈕區：整寬、主要在上 */
  actions?: ReactNode;
  /** 取得焦點的元素 key：每次換成別種結果都重新朗讀（h1 取得焦點並被朗讀，R-A17 同做法） */
  focusKey: string;
}

/** 付款結果、綁卡結果共用的卡片：一個圖示、一個 h1、一段話、按鈕。沒有動畫、沒有自動跳轉 */
export default function ResultCard({ icon, title, children, actions, focusKey }: Props) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    h1.current?.focus({ preventScroll: true });
  }, [focusKey]);
  return (
    <div className="mx-auto max-w-lg p-3 pb-safe md:py-12">
      <div className="rounded-md bg-white px-5 py-10 text-center md:px-8">
        <div className="flex justify-center" aria-hidden="true">{icon}</div>
        <h1 ref={h1} tabIndex={-1} className="mt-3 text-xl font-bold outline-none">{title}</h1>
        {children && <div className="mt-2 text-sm leading-6 text-muted text-pretty">{children}</div>}
        {actions && <div className="mt-6 flex flex-col gap-2 text-left">{actions}</div>}
      </div>
    </div>
  );
}
