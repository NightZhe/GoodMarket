import { Link } from 'react-router-dom';
import { ChevronRight, MapPin, Truck } from 'lucide-react';
import { focusRing } from '../import/ui';

// 賣場總覽的「尚未設定退貨地址」提示卡與手機常駐「物流設定」入口列（設計 7、決策 D18／N4＝B）。
// 出現條件在 lib/logistics/returnPrompt.ts；這裡只管呈現。188 寬（手機 200% 文字）時藏起裝飾圖示，文字才有空間。

/** 提示卡：整張是連結、不可關閉（D18）。結構同取消申請卡，換 info 色 */
export function ReturnPrompt() {
  return (
    <Link to="/seller/logistics" className={`mt-3 flex min-h-12 items-start gap-3 rounded-md border border-info/40 bg-info-bg p-3 text-sm ${focusRing}`}>
      <MapPin size={20} className="mt-0.5 shrink-0 text-info-text max-[239px]:hidden" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-ink">
        <span className="block font-medium">尚未設定退貨地址</span>
        <span className="mt-0.5 block">買家要退貨時，會在訂單上看到你設定的退貨門市或地址。</span>
      </span>
      <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted max-[239px]:hidden" aria-hidden="true" />
    </Link>
  );
}

/** 常駐入口列（僅手機；桌機有側欄第六項）。底欄只有 5 格，物流設定從這裡進 */
export function LogisticsEntryRow() {
  return (
    <Link to="/seller/logistics" className={`flex min-h-12 items-center gap-3 rounded-lg bg-white px-4 py-2 text-sm md:hidden ${focusRing}`}>
      <Truck size={20} className="shrink-0 text-muted max-[239px]:hidden" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        物流設定
        <span className="block text-xs text-muted">設定買家退貨要寄到哪裡</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted max-[239px]:hidden" aria-hidden="true" />
    </Link>
  );
}
