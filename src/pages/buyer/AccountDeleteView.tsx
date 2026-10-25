import type { Ref } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Clock } from 'lucide-react';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { Group, ROW, ROW_IN } from '../../components/account/AccountRows';
import { Bone, Spinner, bigBtn } from '../../components/account/ui';
import type { DeletionRequest } from '../../lib/deletion/api';
import { INTRO, SECTIONS, SHOP_NOTE, buyerOrdersTitle, shopOrdersTitle } from '../../lib/deletion/copy';
import { requestedYmd, slashDate, spokenDate } from '../../lib/deletion/date';
import { hasShopOf, type DeletionView, type Stage } from '../../lib/deletion/status';
import { CONTACT_EMAIL, DELETION_WINDOW } from '../../lib/site';

// 刪除帳號申請頁的畫面部分（不碰 store、登入、網路），讓每個狀態都能單獨渲染測試。流程與狀態機在 AccountDelete.tsx

interface ViewProps {
  stage: Stage;
  view: DeletionView | null;
  online: boolean;
  retrying: boolean;
  justSubmitted: boolean;
  statusRef?: Ref<HTMLHeadingElement>;
  onLogin: () => void;
  onRetry: () => void;
  onApply: () => void;
  onAskCancel: () => void;
}

const ID_ORDERS = 'del-block-orders';
const ID_SHOP = 'del-block-shop';

/** 頁面內容（不含頁首與對話框）：A 區狀態、導言、說明、有店提示、C 區動作。只看 props，方便逐狀態測試 */
export function AccountDeleteView({ stage, view, online, retrying, justSubmitted, statusRef, onLogin, onRetry, onApply, onAskCancel }: ViewProps) {
  const hasShop = hasShopOf(view);
  const pending = view?.kind === 'pending' ? view.request : null;
  const blocked = view?.kind === 'blocked_orders' ? view : null;
  const buyerBlock = blocked !== null && blocked.buyerOrders > 0;
  const shopBlock = blocked !== null && blocked.shopOrders > 0;

  return (
    <>
      {stage === 'login_expired' && (
        <div className="mt-2">
          <Banner kind="info" role="status" title="登入已過期">請重新登入。</Banner>
        </div>
      )}
      {pending && <DeletionStatusCard request={pending} justSubmitted={justSubmitted} online={online} titleRef={statusRef} onCancel={onAskCancel} />}
      {(buyerBlock || shopBlock) && (
        <div className="mt-2 space-y-2">
          {buyerBlock && (
            <div id={ID_ORDERS}>
              <Banner kind="warning" title={buyerOrdersTitle(blocked.buyerOrders)} actions={<Link to="/orders" className={btnOutline}>前往我的訂單</Link>}>
                完成或取消後才能申請刪除帳號。
              </Banner>
            </div>
          )}
          {shopBlock && (
            <div id={ID_SHOP}>
              <Banner kind="warning" title={shopOrdersTitle(blocked.shopOrders)} actions={<Link to="/seller/orders" className={btnOutline}>前往賣家中心的訂單管理</Link>}>
                處理完成後才能申請刪除帳號。
              </Banner>
            </div>
          )}
        </div>
      )}
      {stage === 'error' && (
        <div className="mt-2">
          {online ? (
            <Banner kind="error" title="讀不到刪除申請的狀態" actions={<RetryButton busy={retrying} onClick={onRetry} />}>請檢查網路後再試一次。</Banner>
          ) : (
            <Banner kind="warning" role="status" title="目前沒有網路" actions={<RetryButton busy={retrying} onClick={onRetry} />}>連上網路後才能申請刪除帳號。</Banner>
          )}
        </div>
      )}
      {stage === 'backend_missing' && (
        <div className="mt-2">
          <Banner kind="warning" role="status" title="刪除帳號申請暫時無法在這裡送出">
            你可以來信{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="-my-3 inline-flex min-h-11 items-center px-0.5 text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >{CONTACT_EMAIL}</a>
            {' '}申請，我們會在 {DELETION_WINDOW}處理。
          </Banner>
        </div>
      )}

      <section className="mt-2 rounded-card bg-white p-4">
        <p className="text-body text-ink text-pretty">{INTRO}</p>
      </section>
      <DeletionSections />

      {hasShop && (
        <div className="mt-3">
          <Banner kind="warning" title="你有開店">{SHOP_NOTE}</Banner>
        </div>
      )}

      {(stage === 'login' || stage === 'login_expired') && (
        <>
          <button type="button" onClick={onLogin} className={`${btnPrimary} ${bigBtn} mt-6`}>{stage === 'login_expired' ? '重新登入' : '登入後申請'}</button>
          <p className="mt-2 px-5 text-center text-footnote text-muted">請用你要刪除的那個帳號登入。</p>
        </>
      )}
      {stage === 'loading' && (
        <div aria-busy="true" className="mt-6">
          <p role="status" className="sr-only">載入中</p>
          <Bone className="h-12 w-full" />
        </div>
      )}
      {stage === 'can_apply' && (
        <div className="-mx-4 mt-6">
          <Group footer="按下後會先請你確認一次，確認前不會送出。">
            <ApplyRow disabled={!online} onClick={onApply} />
          </Group>
        </div>
      )}
      {stage === 'blocked_orders' && (
        <div className="-mx-4 mt-6">
          <Group>
            <ApplyRow disabled describedBy={[buyerBlock ? ID_ORDERS : '', shopBlock ? ID_SHOP : ''].filter(Boolean).join(' ')} />
          </Group>
        </div>
      )}
    </>
  );
}

/** 導言以外的四段說明。內文用 ink 不用 muted：這是做決定前必讀的條件 */
export function DeletionSections() {
  return (
    <div className="mt-3 rounded-card bg-white px-4 [&>section+section]:border-t-[0.5px] [&>section+section]:border-separator">
      {SECTIONS.map(s => (
        <section key={s.title} className="py-4">
          <h2 className="text-headline font-semibold">{s.title}</h2>
          <p className="mt-1 text-subhead text-ink text-pretty">{s.body}</p>
        </section>
      ))}
    </div>
  );
}

/** 「申請刪除帳號」列：跟帳號頁「登出」列同結構，紅字只放在白底上。停用＝仍可聚焦（aria-disabled），原因在上方的 Banner／toast */
function ApplyRow({ disabled = false, describedBy, onClick }: { disabled?: boolean; describedBy?: string; onClick?: () => void }) {
  return (
    <li>
      <button
        type="button" onClick={onClick} aria-disabled={disabled || undefined} aria-describedby={describedBy || undefined}
        className={`${ROW} min-h-12 justify-center pl-0 ${disabled ? 'text-muted-2' : 'text-error-text'}`}
      >
        <span data-row="" className={`${ROW_IN} min-h-12 justify-center pl-3`}>申請刪除帳號</span>
      </button>
    </li>
  );
}

/** 成功畫面（justSubmitted）與處理中共用。日期畫面上寫 2026/11/04，讀屏念口語版，避免斜線被念出來 */
export function DeletionStatusCard({ request, justSubmitted, online, titleRef, onCancel }: {
  request: DeletionRequest; justSubmitted: boolean; online: boolean; titleRef?: Ref<HTMLHeadingElement>; onCancel: () => void;
}) {
  const applied = requestedYmd(request.requested_at);
  const Icon = justSubmitted ? CircleCheck : Clock;
  return (
    <section aria-labelledby="del-status-title" className="mt-2 rounded-card bg-white p-4">
      <div className="flex items-start gap-3">
        <Icon size={24} className={`mt-0.5 shrink-0 ${justSubmitted ? 'text-success-text' : 'text-info-text'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="del-status-title" ref={titleRef} tabIndex={-1} className="scroll-mt-[calc(env(safe-area-inset-top)+--spacing(14))] text-title3 font-bold outline-none">
            {justSubmitted ? '已收到你的刪除申請' : '刪除申請處理中'}
          </h2>
          <dl className="mt-3 space-y-1 text-body">
            {applied && <DateRow term="申請日" ymd={applied} suffix="" />}
            {slashDate(request.due_date) && <DateRow term="預計完成日" ymd={request.due_date} suffix=" 前完成" />}
          </dl>
          <p className="mt-3 text-subhead text-muted">處理完成前，你可以隨時回到這一頁取消。</p>
        </div>
      </div>
      <button type="button" onClick={onCancel} aria-disabled={!online || undefined} className={`${btnOutline} ${bigBtn} mt-4`}>取消申請</button>
    </section>
  );
}

function DateRow({ term, ymd, suffix }: { term: string; ymd: string; suffix: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-muted">{term}</dt>
      <dd>
        <span aria-hidden="true">{slashDate(ymd)}{suffix}</span>
        <span className="sr-only">{spokenDate(ymd)}{suffix.trim()}</span>
      </dd>
    </div>
  );
}

function RetryButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={btnOutline} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => { if (!busy) onClick(); }}>
      {busy && <Spinner size={16} />}
      {busy ? '重試中…' : '重試'}
    </button>
  );
}
