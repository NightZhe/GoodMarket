import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';

export type BannerKind = 'info' | 'warning' | 'error' | 'success';

const STYLE: Record<BannerKind, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'border-info/40 bg-info-bg', icon: 'text-info-text', Icon: Info },
  warning: { box: 'border-warning-border bg-warning-bg', icon: 'text-warning-text', Icon: TriangleAlert },
  error: { box: 'border-error-border bg-error-bg', icon: 'text-error-text', Icon: CircleAlert },
  success: { box: 'border-success/40 bg-success-soft', icon: 'text-success-text', Icon: CircleCheck },
};

interface Props {
  kind: BannerKind;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** 錯誤橫幅預設 role="alert"（立刻朗讀），其餘不主動朗讀 */
  role?: 'alert' | 'status' | 'none';
}

/** 內文一律用 ink：語意色的字放在語意底色上對比不夠（error-text 對 error-bg 只有 4.41:1） */
export default function Banner({ kind, title, children, actions, role }: Props) {
  const { box, icon, Icon } = STYLE[kind];
  const r = role ?? (kind === 'error' ? 'alert' : undefined);
  return (
    <div role={r === 'none' ? undefined : r} className={`flex gap-3 rounded-md border p-3 md:p-4 ${box}`}>
      <Icon size={20} className={`mt-0.5 shrink-0 ${icon}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-ink">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-sm">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
