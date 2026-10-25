import type { Ref } from 'react';
import { Link } from 'react-router-dom';
import { pillButton, pillButtonPrimary } from '../pillButton';

/**
 * 被封鎖店家的提示（design §3.4、§3.5）。
 * shop：店家頁商品區的說明塊（沿用評價區「還沒有評價」的 canvas 卡）；
 * page：商品頁／評價總覽整頁取代，不渲染任何商品名、價格、照片、評價。
 * 標題可接焦點（tabIndex=-1）：封鎖或取消封鎖後焦點要落在還存在的元素上。
 */
export default function BlockedShopPanel(props:
  | { variant: 'shop'; titleRef?: Ref<HTMLHeadingElement>; onUnblock: () => void }
  | { variant: 'page'; shopName: string; titleRef?: Ref<HTMLHeadingElement>; onUnblock: () => void },
) {
  if (props.variant === 'shop') {
    return (
      <div className="mx-5 rounded-card bg-canvas p-4 md:mx-0">
        <h3 ref={props.titleRef} tabIndex={-1} className="text-headline font-semibold text-ink outline-none">你已封鎖這家店</h3>
        <p className="mt-0.5 text-subhead text-muted">這台裝置上不會顯示它的商品。</p>
        <button type="button" onClick={props.onUnblock} className={`${pillButtonPrimary} mt-3`}>取消封鎖</button>
      </div>
    );
  }
  // 與 EmptyState 同版型；標題改成 h1 並允許斷字（店名可能很長又沒有空白，共用元件的 <p> 會被撐出版面）
  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <div className="flex flex-col items-center justify-center gap-3 bg-white px-6 py-20 text-center">
        <h1 ref={props.titleRef} tabIndex={-1} className="max-w-full break-words text-headline font-semibold text-ink outline-none">
          你已封鎖這家店（{props.shopName}）
        </h1>
        <p className="max-w-xs text-subhead text-muted">這件商品屬於你封鎖的店家，所以沒有顯示內容。</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={props.onUnblock} className={pillButtonPrimary}>取消封鎖</button>
          <Link to="/" className={pillButton}>回首頁</Link>
        </div>
      </div>
    </div>
  );
}
