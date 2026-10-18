import { UserRound } from 'lucide-react';
import { accountLabel, loginProviderOf, providerLabel } from '../../lib/auth/identity';
import type { UserLike } from '../../lib/auth/identity';

/** 登入方式與帳號標籤（帳號頁、個人檔案頁共用）。不顯示 Google 大頭貼：R-13 帳號資訊不外露，也跟 Apple（拿不到頭像）一致 */
export default function Identity({ user }: { user: UserLike }) {
  const provider = loginProviderOf(user);
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><UserRound size={24} /></span>
      <div className="min-w-0">
        <p className="font-medium">{provider === 'google' || provider === 'apple' ? `使用 ${providerLabel(provider)} 登入中` : '已登入'}</p>
        <p className="break-all text-sm text-muted">{accountLabel(user)}</p>
      </div>
    </div>
  );
}
