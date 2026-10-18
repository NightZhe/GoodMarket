import type { User } from '@supabase/supabase-js';
import { UserRound } from 'lucide-react';
import MaskedPhone from '../auth/MaskedPhone';
import { useLoginProvider } from '../auth/useLoginProvider';
import { accountLabel, phoneOf, providerLabel } from '../../lib/auth/identity';
import { maskTwPhone } from '../../lib/auth/phone';

/**
 * 登入方式與帳號標籤（帳號頁、個人檔案頁共用）。不顯示 Google 大頭貼：R-13 帳號資訊不外露，也跟 Apple（拿不到頭像）一致。
 * 手機登入：第一行「使用手機登入中」、第二行遮罩門號；用 Google／Apple 登入但綁了手機：多一行「已綁定手機 0912-***-678」（R-26）。
 * 「這一次」用什麼登入要讀 session 的 amr（簡訊登入不會更新身分的登入時間），讀到之前先用身分判斷。
 */
export default function Identity({ user }: { user: User }) {
  const provider = useLoginProvider(user);
  const p = provider ?? 'other';
  const label = accountLabel(user, p);
  const phone = phoneOf(user);
  const labelIsPhone = phone !== null && label === maskTwPhone(phone);
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><UserRound size={24} /></span>
      <div className="min-w-0">
        <p className="font-medium">
          {p === 'phone' ? '使用手機登入中' : p === 'google' || p === 'apple' ? `使用 ${providerLabel(p)} 登入中` : '已登入'}
        </p>
        <p className="break-all text-sm text-muted">{labelIsPhone && phone ? <MaskedPhone national={phone} /> : label}</p>
        {phone && !labelIsPhone && <p className="text-sm text-muted">已綁定手機 <MaskedPhone national={phone} /></p>}
      </div>
    </div>
  );
}
