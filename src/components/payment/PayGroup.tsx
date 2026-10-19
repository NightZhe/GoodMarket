import type { ReactNode } from 'react';
import { PayTag } from './PayTag';
import { money } from '../../lib/format';

interface Props {
  kind: 'online' | 'cod';
  /** 線上組標題裡的卡名，例如「Visa •••• 4242」 */
  cardName?: ReactNode;
  subtotal: number;
  shopCount: number;
  /** 組內的店家區塊 */
  children: ReactNode;
  id: string;
}

/**
 * 結帳頁的付款分組（設計 3.2、8.2）：標題塊（白底 ink 字，灰底上的 muted 對比不過）→ 組內店家區塊 → 小計塊。
 * 線上組超過一家店時，小計下加一句帳單說明
 */
export default function PayGroup({ kind, cardName, subtotal, shopCount, children, id }: Props) {
  const online = kind === 'online';
  return (
    <section aria-labelledby={id} className="space-y-2 md:space-y-4">
      <div className="bg-white px-4 py-3 md:rounded-md md:px-6">
        <h2 id={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
          <PayTag kind={online ? 'online' : 'cod'} />
          <span className="font-normal">{online ? cardName : '收到商品時再付'}</span>
        </h2>
      </div>
      {children}
      <div className="bg-white px-4 py-3 md:rounded-md md:px-6">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm font-medium">
          <span className="min-w-0">{online ? '現在付款（含運費）' : '貨到付款（含運費）'}</span>
          <span className="tabular-nums">{money(subtotal)}</span>
        </p>
        {online && shopCount > 1 && (
          <p className="mt-1 text-sm text-muted text-pretty">按一次付款，每家店各授權一筆，全部成功才會請款。你的信用卡帳單會有 {shopCount} 筆。</p>
        )}
      </div>
    </section>
  );
}
