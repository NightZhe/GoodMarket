import { Flag } from 'lucide-react';
import { textActionCls } from '../account/ui';

/** 「旗幟圖示＋文字」的檢舉入口（商品頁「檢舉這件商品」、店家頁「檢舉這家店」）。44 高，字用品牌色 */
export default function ReportLink({ label, onClick, className = '' }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" aria-haspopup="dialog" onClick={onClick} className={`${textActionCls} gap-1.5 text-brand ${className}`}>
      <Flag size={16} aria-hidden="true" />{label}
    </button>
  );
}
