import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ClipboardList, ImageOff, Package } from 'lucide-react';
import Photo from '../Photo';
import { cardPrice, cardSpoken, orderStatusLabel } from '../../lib/chat/cards';
import { money } from '../../lib/format';
import type { ChatCard } from '../../lib/chat/types';

/** 卡片縮圖：載入失敗換成灰底圖示，名稱價格照出 */
export function CardThumb({ src, size = 'size-14' }: { src: string; size?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span aria-hidden="true" className={`${size} grid shrink-0 place-items-center rounded-[8px] bg-canvas text-muted`}>
        <ImageOff size={20} />
      </span>
    );
  }
  return <Photo src={src} alt="" className={`${size} shrink-0 rounded-[8px]`} onError={() => setBroken(true)} />;
}

interface Props {
  card: ChatCard;
  /** 點下去的目標已不存在（商品下架／找不到訂單）：卡片內容仍是送出當時的快照 */
  gone: boolean;
  /** 目標網址 */
  to: string;
  onGone: () => void;
}

const BOX = 'block w-full rounded-card border-[0.5px] border-separator bg-white p-3 text-left transition-colors duration-200 active:bg-press active:duration-0';

/** 對話裡的商品卡／訂單卡（兩端共用）。整張卡是一個連結；目標不存在時是停用樣子的按鈕，點了提示 */
export default function MessageCard({ card, gone, to, onGone }: Props) {
  const label = cardSpoken(card, gone);
  const content = card.type === 'product' ? (
    <>
      <Kicker icon={<Package size={12} aria-hidden="true" />}>商品</Kicker>
      <span className="mt-1.5 flex items-center gap-3">
        <CardThumb src={card.image} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block break-words text-subhead text-ink">{card.title}</span>
          {gone
            ? <span className="mt-0.5 block text-subhead text-muted">商品已下架</span>
            : cardPrice(card) !== null && <span className="mt-0.5 block text-headline font-bold text-ink">{money(cardPrice(card) as number)}</span>}
        </span>
        {!gone && <ChevronRight size={16} strokeWidth={2.4} className="shrink-0 text-chevron" aria-hidden="true" />}
      </span>
    </>
  ) : (
    <>
      <Kicker icon={<ClipboardList size={12} aria-hidden="true" />}>訂單 <span className="font-mono">#{card.order_no}</span></Kicker>
      <span className="mt-1.5 flex items-center gap-3">
        <CardThumb src={card.image} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-subhead text-ink">{card.title}</span>
          <span className="block text-footnote text-muted">共 {card.item_count} 件</span>
          {gone
            ? <span className="mt-0.5 block text-subhead text-muted">找不到訂單</span>
            : <span className="mt-0.5 block"><span className="text-footnote text-muted">訂單金額 </span><span className="text-headline font-bold text-ink">{money(card.total)}</span></span>}
        </span>
        {!gone && <ChevronRight size={16} strokeWidth={2.4} className="shrink-0 text-chevron" aria-hidden="true" />}
      </span>
      <span className="mt-1.5 block text-footnote text-muted">送出時狀態：{orderStatusLabel(card.status)}</span>
    </>
  );

  return gone
    ? <button type="button" aria-disabled="true" aria-label={label} onClick={onGone} className={BOX}>{content}</button>
    : <Link to={to} aria-label={label} className={BOX}>{content}</Link>;
}

function Kicker({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="flex items-center gap-1 text-caption2 font-semibold text-muted">{icon}{children}</span>;
}
