import { Banknote, ChevronRight, Plus } from 'lucide-react';
import { CardIcon } from './CardLabel';
import CardLabel from './CardLabel';
import { expiryOf } from '../../lib/payment/cards';
import type { PayChoice } from '../../lib/payment/plan';
import type { PaymentMethodRow } from '../../lib/payment/types';

interface Props {
  cards: PaymentMethodRow[];
  /** null＝沒有選（重新付款頁：沒有可預選的卡） */
  value: PayChoice | null;
  onChange: (c: PayChoice) => void;
  /** 開綁卡抽屜 */
  onNew: () => void;
  /** 結帳頁有「貨到付款」這一組；重新付款頁沒有 */
  withCod?: boolean;
  /** 剛剛這張沒有通過（重新付款頁）：不預選，副行換成提示 */
  failedCardId?: string | null;
  /** 付款中：整組 inert，不可改選 */
  busy?: boolean;
  /** 清單載入中的骨架 */
  loading?: boolean;
  /** false＝信用卡這一組不顯示（這次沒有任何店能線上付款、或讀不到卡片）：只剩貨到付款 */
  showCards?: boolean;
  /** radiogroup 的標題 id（頁面上的「付款方式」h2） */
  labelledBy: string;
  name?: string;
}

const GROUP_TITLE = 'px-4 pb-2 text-sm font-bold md:px-6';
const LIST = 'divide-y divide-line border-y border-line';
const ROW = 'flex min-h-14 items-start gap-3 px-4 py-3 active:bg-canvas md:px-6';

/** 結帳與重新付款共用的付款方式選擇：信用卡分組（含「用其他信用卡付款」）＋貨到付款分組。原生 radio，整列 label 承擔點擊 */
export default function CardRadioList({ cards, value, onChange, onNew, withCod = false, failedCardId = null, busy = false, loading = false, showCards = true, labelledBy, name = 'pay-choice' }: Props) {
  const selectedCard = value?.kind === 'card' ? value.cardId : null;
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-busy={loading || busy || undefined} inert={busy} className="-mx-4 md:-mx-6">
      {showCards && <p className={GROUP_TITLE}>信用卡</p>}
      {showCards && <ul className={LIST}>
        {loading && (
          <li aria-hidden="true" className="flex gap-3 px-4 py-3 md:px-6">
            <span className="h-9 w-12 shrink-0 rounded-sm bg-line" />
            <span className="flex-1 space-y-2 pt-1"><span className="block h-4 w-40 rounded-sm bg-line" /><span className="block h-3 w-24 rounded-sm bg-line" /></span>
          </li>
        )}
        {cards.map(c => {
          const expired = c.expired || expiryOf(c.exp_year, c.exp_month).expired;
          const checked = selectedCard === c.id;
          return (
            <li key={c.id} className={checked ? 'bg-brand-soft' : ''}>
              <label className={`${ROW} ${expired ? 'text-muted' : ''}`}>
                <input
                  type="radio" name={name} checked={checked} disabled={expired}
                  onChange={() => onChange({ kind: 'card', cardId: c.id })}
                  className="mt-2 h-5 w-5 shrink-0 accent-brand"
                />
                <CardLabel card={c} variant="choice" note={c.id === failedCardId ? '剛剛這張沒有通過' : undefined} />
              </label>
            </li>
          );
        })}
        <li>
          <button
            type="button" aria-haspopup="dialog" onClick={onNew}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-base active:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand md:px-6"
          >
            <CardIcon icon={Plus} />
            <span className="min-w-0 flex-1">
              <span className="block">用其他信用卡付款</span>
              <span className="block text-sm text-muted">先綁定這張卡，綁好後會自動選用</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
          </button>
        </li>
      </ul>}

      {withCod && (
        <>
          <p className={`${GROUP_TITLE} ${showCards ? 'pt-4' : ''}`}>貨到付款</p>
          <ul className={LIST}>
            <li className={value?.kind === 'cod' ? 'bg-brand-soft' : ''}>
              <label className={ROW}>
                <input
                  type="radio" name={name} checked={value?.kind === 'cod'}
                  onChange={() => onChange({ kind: 'cod' })}
                  className="mt-2 h-5 w-5 shrink-0 accent-brand"
                />
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <CardIcon icon={Banknote} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base">貨到付款</span>
                    <span className="mt-0.5 block text-sm text-ink">收到商品時再付款</span>
                  </span>
                </span>
              </label>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
