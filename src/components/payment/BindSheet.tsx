import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import SheetShell from '../SheetShell';
import Banner from '../import/Banner';
import { btnOutline } from '../import/ui';
import BindCardPanel, { type BindPanelProps } from './BindCardPanel';
import { CARD_LIMIT } from '../../lib/payment/limits';

/**
 * 「用新的信用卡付款」抽屜（手機）／對話框（桌機）：結帳頁與重新付款頁共用。
 * 說明刻意縮成一段（完整三條在「新增信用卡」頁；抽屜最高 90dvh，在 iPhone SE 上三條會把欄位推出視窗）
 */
export default function BindSheet({ onClose, ...panel }: Omit<BindPanelProps, 'variant' | 'onCancel'> & { onClose: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [blocked, setBlocked] = useState<'CARD_LIMIT' | 'PAYMENT_DISABLED' | null>(null);
  return (
    <SheetShell titleId="bind-sheet-title" descId="bind-sheet-desc" titleRef={titleRef} onClose={onClose}>
      <div className="p-4 md:p-6">
        <div className="flex items-start gap-2">
          <h2 id="bind-sheet-title" ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 pt-px text-lg font-bold outline-none">用新的信用卡付款</h2>
          <button type="button" onClick={onClose} aria-label="關閉" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <p id="bind-sheet-desc" className="mb-3 mt-1 text-sm text-muted text-pretty">
          綁定時銀行會先授權一小筆金額，成功後立刻退刷，不會真的收費。可能需要 3D 驗證，會暫時離開好物集，完成後自動回到這裡。
        </p>
        {blocked ? (
          <Banner
            kind="warning" role="status" title={blocked === 'CARD_LIMIT' ? `已經綁了 ${CARD_LIMIT} 張卡` : '線上付款暫時停用'}
            actions={<button type="button" className={btnOutline} onClick={onClose}>關閉</button>}
          >
            {blocked === 'CARD_LIMIT' ? `最多只能綁 ${CARD_LIMIT} 張。請先到「付款方式」刪除一張，再新增。` : '目前不能綁定信用卡，請改用貨到付款。'}
          </Banner>
        ) : (
          <BindCardPanel variant="sheet" {...panel} onCancel={onClose} onBlocked={code => { setBlocked(code); panel.onBlocked?.(code); }} />
        )}
      </div>
    </SheetShell>
  );
}
