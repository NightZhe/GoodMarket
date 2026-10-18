import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CircleAlert, Store } from 'lucide-react';
import ProductImage from '../ProductImage';
import { btnOutline, btnPrimary } from '../import/ui';
import { pressCls } from '../account/ui';
import Clauses from './Clauses';
import { money } from '../../lib/format';
import {
  groupRejections, itemAriaLabel, primaryAction, priceTrend, rejectionNotes, rejectionSentence, shippingAriaText, stockParts,
  type RejectedItem,
} from '../../lib/account/priceCheck';
import type { CheckoutRejection } from '../../types';

interface Props {
  changes: CheckoutRejection[];
  fromCart: boolean;
  /** 這次送出的商店，依第一次出現的順序（結帳頁的分組順序） */
  shopOrder: string[];
  /** 這次送出的商品（直接購買只有一件；只有運費變動時主要按鈕回這件） */
  submittedProductIds: string[];
  shopName: (shopId: string) => string | undefined;
  imageOf: (productId: string) => string | undefined;
}

const footPrimary = `${btnPrimary} ${pressCls} h-12 w-full text-base lg:h-11 lg:w-auto lg:min-w-44 lg:text-sm`;
const footSecondary = `${btnOutline} ${pressCls} h-12 w-full text-base lg:h-11 lg:w-auto lg:min-w-32 lg:text-sm`;
const barPrimary = `${btnPrimary} ${pressCls} h-12 w-full text-base`;

/** 「原本 $X」一行（muted）＋「現在 $Y」一行（粗體 ink），標籤跟在「現在」後面 */
function TwoLine({ seen, current, tag }: { seen: number; current: number; tag?: ReactNode }) {
  return (
    <>
      <span className="block text-muted">原本 {money(seen)}</span>
      <span className="flex flex-wrap items-center gap-x-2"><span className="font-semibold text-ink">現在 {money(current)}</span>{tag}</span>
    </>
  );
}

function ItemRow({ item, image }: { item: RejectedItem; image: string | undefined }) {
  const thumb = 'w-14 shrink-0 rounded-sm border border-line max-[319px]:hidden';
  const [want, left] = item.stock ? stockParts(item.stock) : ['', ''];
  return (
    <li>
      <Link
        to={`/product/${item.productId}`} aria-label={itemAriaLabel(item)}
        className="group flex items-start gap-3 px-4 py-3 hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand md:px-6 max-[319px]:px-3"
      >
        {image ? <ProductImage src={image} alt="" size="sm" className={thumb} /> : <span className={`aspect-square bg-canvas ${thumb}`} aria-hidden="true" />}
        <div className="min-w-0 flex-1" aria-hidden="true">
          <p className="line-clamp-2 text-sm text-ink max-[319px]:line-clamp-none max-[319px]:break-words">{item.title}</p>
          {item.variantName && <p className="mt-0.5 break-words text-xs text-muted">規格：{item.variantName}</p>}
          <dl className="mt-2 space-y-1.5 text-sm">
            {item.price && (
              <div className="flex items-baseline gap-3">
                <dt className="w-7 shrink-0 text-xs text-muted">價格</dt>
                <dd className="min-w-0 flex-1">
                  <TwoLine
                    seen={item.price.seen} current={item.price.current}
                    tag={priceTrend(item.price) === '降價'
                      ? <span className="rounded-sm bg-success-soft px-1.5 text-xs font-medium leading-5 text-success-text">降價</span>
                      : <span className="rounded-sm bg-warning-bg px-1.5 text-xs font-medium leading-5 text-warning-text">漲價</span>}
                  />
                </dd>
              </div>
            )}
            {item.stock && (
              <div className="flex items-baseline gap-3">
                <dt className="w-7 shrink-0 text-xs text-muted">庫存</dt>
                <dd className="min-w-0 flex-1">
                  {want && <span>{want}</span>}<span className="font-semibold text-error-text">{left}</span>
                </dd>
              </div>
            )}
          </dl>
        </div>
        <ChevronRight size={18} className="mt-0.5 shrink-0 self-center text-muted group-hover:text-ink" aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * 下單被擋（D-7e＝A）：結帳頁整頁換成這個畫面。全部問題一次列出，導回一律用站內連結、不自動跳轉、沒有動畫。
 * 版面與 class 照 .work/checkout-price-check/design.md 第 4、6 節
 */
export default function CheckoutRejected({ changes, fromCart, shopOrder, submittedProductIds, shopName, imageOf }: Props) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const idBase = useId();
  useEffect(() => {
    window.scrollTo(0, 0);
    h1.current?.focus();
  }, []);

  const groups = groupRejections(changes, shopOrder);
  const notes = rejectionNotes({ shopCount: shopOrder.length, fromCart });
  const primary = primaryAction(changes, { fromCart, submittedProductIds });

  return (
    <>
      <div className="mx-auto max-w-lg px-3 pt-3 pb-28 md:pt-12 lg:pb-12 max-[319px]:px-0 max-[319px]:pt-0 max-[319px]:pb-0">
        <div className="rounded-md bg-white max-[319px]:rounded-none">
          <div className="flex flex-col items-center px-5 pt-8 pb-6 text-center md:px-8 md:pt-10 max-[319px]:px-3 max-[319px]:pt-6">
            <CircleAlert size={48} strokeWidth={1.5} className="text-error-text" aria-hidden="true" />
            <h1 ref={h1} tabIndex={-1} className="mt-3 text-xl font-bold text-ink outline-none">
              <span className="inline-block">下單失敗，</span><span className="inline-block">請重新購買</span>
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              {rejectionSentence(changes).map((part, i) => <span key={i} className="inline-block">{part}</span>)}
            </p>
            {notes.map(note => <p key={note} className="mt-1 text-sm leading-6 text-muted"><Clauses text={note} /></p>)}
          </div>

          <div className="divide-y divide-line border-t border-line">
            {groups.map((g, gi) => {
              const name = shopName(g.shopId) ?? g.shopName ?? '';
              const headingId = `${idBase}-shop-${gi}`;
              return (
                <section key={g.shopId} aria-labelledby={headingId}>
                  <h2 id={headingId} className="flex items-center gap-1.5 px-4 pt-4 pb-1 text-sm font-medium text-ink md:px-6 max-[319px]:px-3">
                    <Store size={16} className="shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{name}</span>
                  </h2>
                  {g.items.length > 0 && (
                    <ul>{g.items.map(item => <ItemRow key={`${item.productId}|${item.variantId}`} item={item} image={imageOf(item.productId)} />)}</ul>
                  )}
                  {g.shipping && (
                    <div className="flex items-baseline gap-3 border-t border-dashed border-line bg-subtle px-4 py-3 text-sm md:px-6 max-[319px]:px-3">
                      <p className="sr-only">{shippingAriaText(name, g.shipping)}</p>
                      <span className="w-7 shrink-0 text-xs text-muted" aria-hidden="true">運費</span>
                      <span className="min-w-0 flex-1" aria-hidden="true"><TwoLine seen={g.shipping.seen} current={g.shipping.current} /></span>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 border-t border-line p-4 md:px-6 lg:flex-row-reverse lg:justify-center lg:gap-3 lg:py-6 max-[319px]:px-3">
            <div className="hidden lg:block max-[319px]:block">
              <Link to={primary.to} state={primary.state} className={footPrimary}>{primary.label}</Link>
            </div>
            <Link to="/" className={footSecondary}>繼續購物</Link>
          </div>
        </div>
      </div>

      {/* 手機：主要按鈕固定在底部（剛才「下訂單」的位置）；188 寬（放大 200%）改回卡片內 */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white lg:hidden max-[319px]:hidden">
        <div className="mx-auto max-w-lg px-4 py-3">
          <Link to={primary.to} state={primary.state} className={barPrimary}>{primary.label}</Link>
        </div>
      </div>
    </>
  );
}
