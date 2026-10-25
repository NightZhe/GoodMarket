import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CircleUserRound } from 'lucide-react';
import { useBlockedShops } from '../../lib/block/useBlockedShops';
import { slashDate, spokenDate } from '../../lib/deletion/date';

// iOS 設定風分組列表（mock .a-group）：白底圓角 12、左右各 16、列高 44；髮絲線從文字左緣起；
// 按下換 press（按下 0ms、放開 200ms 淡回）；列尾 › 用 chevron 色
export const ROW = 'flex min-h-11 w-full items-center gap-3 pl-4 text-left text-body transition-colors duration-200 active:bg-press active:duration-0';
export const ROW_IN = 'flex min-h-11 min-w-0 flex-1 items-center gap-2 border-separator py-2 pr-3';
const GROUP_UL = 'mx-4 overflow-hidden rounded-card bg-white [&>li+li_[data-row]]:border-t-[0.5px]';
const GROUP_NOTE = 'mx-9 text-pretty text-footnote text-muted';

/** 列尾的 ›。裝飾，整列才是點擊目標 */
const Chevron = () => <ChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-chevron" aria-hidden="true" />;

export function Group({ id, title, footer, children }: { id?: string; title?: string; footer?: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      {title && id && <h2 id={id} className={`${GROUP_NOTE} mb-1.5`}>{title}</h2>}
      <ul aria-labelledby={title ? id : undefined} className={GROUP_UL}>{children}</ul>
      {footer && <p className={`${GROUP_NOTE} mt-1.5`}>{footer}</p>}
    </section>
  );
}

/**
 * 一列可以點的項目。沒有 onGate 是連結；有 onGate（未登入時需要登入的入口）是按鈕：先登入，登入後才到那一頁。
 * children 換掉預設的文字（收款帳戶要加狀態）
 */
export function NavRow({ to, label, onGate, children }: { to: string; label: string; onGate?: (to: string) => void; children?: ReactNode }) {
  const inner = <span data-row="" className={ROW_IN}>{children ?? <span className="min-w-0 flex-1">{label}</span>}<Chevron /></span>;
  return (
    <li>
      {onGate
        ? <button type="button" onClick={() => onGate(to)} className={ROW}>{inner}</button>
        : <Link to={to} className={ROW}>{inner}</Link>}
    </li>
  );
}

/**
 * 「刪除帳號」列。dueDate＝處理中申請的預計完成日（'YYYY-MM-DD'）時改成雙行「刪除申請處理中／預計 YYYY/MM/DD 前完成」；
 * null（沒有申請、讀不到狀態）只顯示「刪除帳號」。畫面寫 2026/11/04，讀屏念口語版，避免斜線被念出來
 */
export function DeleteNavRow({ pending, dueDate }: { pending: boolean; dueDate: string }) {
  const due = slashDate(dueDate);
  return (
    <NavRow to="/account/delete" label="刪除帳號">
      {pending ? (
        <span className="min-w-0 flex-1">
          <span className="block">刪除申請處理中</span>
          {due && (
            <>
              <span aria-hidden="true" className="block text-footnote text-muted">預計 {due} 前完成</span>
              <span className="sr-only">預計 {spokenDate(dueDate)}前完成</span>
            </>
          )}
        </span>
      ) : null}
    </NavRow>
  );
}

/** 「已封鎖的店家」入口（登入前後都有）。封鎖清單存在這台裝置，列尾顯示家數；沒封鎖任何店就不顯示 */
export function BlockedNavRow() {
  const { shops } = useBlockedShops();
  return (
    <NavRow to="/account/blocked" label="已封鎖的店家">
      <span className="min-w-0 flex-1">已封鎖的店家</span>
      {shops.length > 0 && <span className="shrink-0 text-muted">{shops.length} 家</span>}
    </NavRow>
  );
}

/** 還沒登入：登入列、購物、開店、其他。known＝false（登入狀態還在判斷）：頭像位置放灰塊，三個入口直接是連結，由目的頁自己處理登入 */
export function SignedOut({ known, onLogin }: { known: boolean; onLogin: (to: string | null) => void }) {
  const gate = known ? onLogin : undefined;
  return (
    <>
      <Group footer="用 Apple、Google 或手機號碼登入。登入後才能加入購物車、下單和寫評價。">
        <li>
          {known ? (
            <button type="button" onClick={() => onLogin(null)} aria-label="登入或註冊" className={`${ROW} min-h-16 text-brand`}>
              <CircleUserRound size={40} strokeWidth={1.7} className="shrink-0" aria-hidden="true" />
              <span data-row="" className={`${ROW_IN} min-h-16`}>登入或註冊</span>
            </button>
          ) : (
            <div aria-busy="true" className={`${ROW} min-h-16`}>
              <span className="sr-only" role="status">載入中</span>
              <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-full bg-canvas" />
              <span aria-hidden="true" className="h-5 w-32 rounded-sm bg-canvas" />
            </div>
          )}
        </li>
      </Group>
      <Group id="acct-shop" title="購物">
        <NavRow to="/orders" label="我的訂單" onGate={gate} />
        <NavRow to="/cart" label="購物車" onGate={gate} />
        <NavRow to="/account/addresses" label="地址" onGate={gate} />
      </Group>
      <Group id="acct-seller" title="開店">
        <NavRow to="/seller" label="賣家中心" />
      </Group>
      <Group id="acct-other" title="其他">
        <NavRow to="/privacy" label="隱私政策" />
        <BlockedNavRow />
      </Group>
    </>
  );
}
