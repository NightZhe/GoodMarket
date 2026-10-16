import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useRefreshOnVisible, useReviews } from '../../store/ReviewsContext';
import { useToast } from '../../components/Toast';
import Banner from '../../components/import/Banner';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline } from '../../components/import/ui';
import { EditableItemCard, ReadonlyItemCard } from '../../components/reviews/ReviewItemCards';
import { EmptyBlock, InlineError } from '../../components/reviews/states';
import { useLightbox } from '../../components/reviews/useLightbox';
import { submitReviews } from '../../lib/reviews/api';
import {
  NICKNAME_HINT_ERROR, ReviewError, needsStatusRefresh, submitErrorMessage, SUBMIT_FALLBACK,
} from '../../lib/reviews/errors';
import { confirmSummary, ratedItems, readyMessage, submitBlocker, type Blocker } from '../../lib/reviews/form';
import { deadlineDateTime } from '../../lib/reviews/format';
import { maskNickname, validateNickname } from '../../lib/reviews/nickname';
import { formGate, partitionItems } from '../../lib/reviews/status';
import type { OrderReviewStatus } from '../../lib/reviews/types';
import { stateHasInput, toSubmitItems, useReviewEditor } from './reviewEditor';

/** 評價表單 #/orders/:orderId/review：先確認這張訂單的憑證與狀態，再顯示表單或說明 */
export default function ReviewForm() {
  const { orderId = '' } = useParams();
  const { orderKeys, myOrders, myOrdersLoaded } = useStore();
  const { statusState, statusOf, refreshStatus } = useReviews();
  const [retrying, setRetrying] = useState(false);
  const status = statusOf(orderId);
  const key = orderKeys.find(k => k.id === orderId);

  useRefreshOnVisible(() => { void refreshStatus(true); });
  useEffect(() => { void refreshStatus(true); }, [refreshStatus]);

  let content: React.ReactNode;
  if (!key) {
    content = <Notice icon="🧾" title="找不到這筆訂單" description="這支手機（瀏覽器）裡沒有這筆訂單的資料。評價要用下單時的瀏覽器開啟；換過手機或清除過瀏覽資料，就無法評價了。" />;
  } else if (!status && statusState === 'error') {
    content = (
      <div className="mt-2 bg-white md:mt-3 md:rounded-md">
        <InlineError
          title="載入失敗" retrying={retrying}
          onRetry={() => { setRetrying(true); void refreshStatus().finally(() => setRetrying(false)); }}
        />
        <p className="pb-6 text-center text-sm"><Link to="/orders" className="underline underline-offset-2">回我的訂單</Link></p>
      </div>
    );
  } else if (!status) {
    const order = myOrders.find(o => o.id === orderId);
    if (statusState === 'loading' || !myOrdersLoaded) content = <FormSkeleton />;
    else if (order?.status === 'cancelled') content = <Notice icon="🧾" title="這筆訂單已取消" description="已取消的訂單無法評價。" />;
    else if (order) content = <Notice icon="🧾" title="訂單完成後才能評價" description="確認收到商品並按下「完成訂單」後，就可以評價了。" />;
    else content = <Notice icon="🧾" title="找不到這筆訂單" description="這支手機（瀏覽器）裡沒有這筆訂單的資料。評價要用下單時的瀏覽器開啟；換過手機或清除過瀏覽資料，就無法評價了。" />;
  } else {
    const gate = formGate(status);
    if (gate.kind === 'expiredEmpty') {
      content = <Notice icon="🧾" title="評價期限已過" description={`這筆訂單的評價期限是 ${deadlineDateTime(status.deadline_date)}，已經無法評價。`} />;
    } else if (gate.kind === 'empty') {
      content = <Notice icon="🧾" title="這筆訂單沒有可以評價的商品" />;
    } else {
      content = <FormBody key={orderId} status={status} token={key.token} editable={gate.kind === 'form'} />;
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-36 md:px-4 md:pb-10 md:pt-6">
      <header className="bg-white md:rounded-t-md">
        <div className="flex items-center gap-1 px-2">
          <Link to="/orders" aria-label="回到我的訂單" className="flex h-11 w-11 items-center justify-center">
            <ArrowLeft size={22} aria-hidden="true" />
          </Link>
          <h1 className="text-base font-medium md:text-lg">評價商品</h1>
        </div>
        {status && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            訂單編號 <span className="font-mono text-ink">{status.order_no}</span>
            <span className="ml-3 inline-block">評價期限：{deadlineDateTime(status.deadline_date)}</span>
          </p>
        )}
      </header>
      {content}
    </div>
  );
}

function Notice({ icon, title, description }: { icon: string; title: string; description?: string }) {
  return (
    <div className="mt-2 bg-white md:mt-3 md:rounded-md">
      <EmptyBlock
        icon={icon} title={title} description={description}
        action={<Link to="/orders" className={`${btnOutline} mt-2`}>回我的訂單</Link>}
      />
    </div>
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" className="mt-2 space-y-2 md:mt-3 md:space-y-3">
      <p role="status" className="sr-only">載入中</p>
      {[0, 1].map(i => (
        <div key={i} aria-hidden="true" className="flex gap-3 bg-white p-4 md:rounded-md">
          <span className="h-16 w-16 shrink-0 rounded-sm bg-line motion-safe:animate-pulse" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3.5 w-3/4 rounded-sm bg-line motion-safe:animate-pulse" />
            <div className="h-3 w-1/3 rounded-sm bg-line motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

interface BodyProps { status: OrderReviewStatus; token: string; editable: boolean }

function FormBody({ status, token, editable }: BodyProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const { refreshStatus, refreshSummary } = useReviews();
  const online = useOnline();
  const { open, done } = partitionItems(status.items);
  const lightbox = useLightbox();

  const handleFatal = useCallback((e: ReviewError) => {
    if (needsStatusRefresh(e.code)) void refreshStatus(true);
  }, [refreshStatus]);

  const ed = useReviewEditor({
    orderId: status.order_id, token, productIds: open.map(i => i.product_id), onFatal: handleFatal,
  });
  const { state } = ed;

  const [nickTouched, setNickTouched] = useState(false);
  const [serverNickError, setServerNickError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const allowLeave = useRef(false);
  const submittingRef = useRef(false);

  const nick = validateNickname(state.nickname);
  const nickError = (nickTouched && !nick.ok) || serverNickError ? (nick.ok ? NICKNAME_HINT_ERROR : nick.message) : null;

  const editorItems = open.map(i => {
    const s = state.items[i.product_id];
    return { productId: i.product_id, rating: s?.rating ?? 0, content: s?.content ?? '', photos: s?.photos ?? [] };
  });
  const blocker = submitBlocker(editorItems, nick.ok);
  const ratedCount = ratedItems(editorItems).length;
  const photoCount = ratedItems(editorItems).reduce((n, i) => n + i.photos.filter(p => p.status === 'done').length, 0);
  const dirty = editable && stateHasInput(state);

  // 離開保護：有任何輸入時，站內導覽先經過確認；關分頁／重新整理另外掛 beforeunload
  const leave = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const focusTarget = (b: Blocker) => {
    const t = b.target;
    if (!t) return;
    let el: HTMLElement | null = null;
    if (t.type === 'nickname') el = document.getElementById('nickname-input');
    else if (b.kind === 'noRating') el = document.querySelector<HTMLElement>(`#item-${CSS.escape(t.productId)} input[type=radio]`);
    else if (b.kind === 'tooLong') el = document.getElementById(`content-${t.productId}`);
    else el = document.getElementById(`photos-${t.productId}`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const onSubmitClick = () => {
    if (submitting) return;
    if (blocker) {
      if (blocker.kind === 'nickname') setNickTouched(true);
      focusTarget(blocker);
      return;
    }
    setConfirming(true);
  };

  const showError = (message: string) => {
    setSubmitError(message);
    requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ block: 'center' }));
  };

  const doSubmit = async () => {
    if (submittingRef.current) return; // 連點只會送一次（AC-18）
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setServerNickError(false);
    const nickname = nick.ok ? nick.value : null;
    const rated = ratedItems(editorItems).map(i => i.productId);
    try {
      try {
        await submitReviews(status.order_id, token, nickname, toSubmitItems(state));
      } catch (e) {
        if (!(e instanceof ReviewError) || e.code !== 'UPLOAD_EXPIRED') throw e;
        // 上傳位置在送出前過期：自動重新申請、重傳一次，再送一次（AC-72）
        const paths = await ed.reuploadAll(rated);
        if (!paths) throw e;
        await submitReviews(status.order_id, token, nickname, toSubmitItems(state, paths));
      }
    } catch (e) {
      const code = e instanceof ReviewError ? e.code : null;
      setConfirming(false);
      if (code === 'NICKNAME_INVALID') setServerNickError(true);
      showError(code ? submitErrorMessage(code) : SUBMIT_FALLBACK);
      if (needsStatusRefresh(code)) void refreshStatus(true);
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }
    ed.discardDraft();
    allowLeave.current = true;
    await Promise.all([refreshStatus(true), refreshSummary()]); // 回到訂單列表時，卡片已經是新狀態（AC-22）
    toast('評價已送出，謝謝你！');
    navigate('/orders', { replace: true });
  };

  const stay = () => { if (leave.state === 'blocked') leave.reset(); };
  const leaveNow = () => {
    ed.discardDraft();
    allowLeave.current = true;
    if (leave.state === 'blocked') leave.proceed();
  };

  const message = blocker ? blocker.message : readyMessage(ratedCount);

  return (
    <>
      {ed.notice.restored && editable && (
        <div className="mt-2 px-2 md:mt-3 md:px-0">
          <Banner kind="info" title="已還原你上次填寫的內容" role="status">
            {ed.notice.dropped > 0 ? `有 ${ed.notice.dropped} 張照片已經失效，需要重新選取。` : '已上傳的照片也還在。'}
          </Banner>
        </div>
      )}
      {editable && !online && (
        <div className="mt-2 px-2 md:mt-3 md:px-0">
          <Banner kind="warning" title="目前沒有網路連線" role="status">
            你填的內容和照片都還在，連上網路後再按一次「送出評價」。
          </Banner>
        </div>
      )}
      {!editable && (
        <div className="mt-2 px-2 md:mt-3 md:px-0">
          {status.expired
            ? <Banner kind="info" title="評價期限已過" role="none">只能查看已送出的評價。</Banner>
            : <Banner kind="success" title="這筆訂單的商品都評價過了" role="none" />}
        </div>
      )}
      <div ref={bannerRef} className="scroll-mt-24">
        {submitError && <div className="mt-2 px-2 md:mt-3 md:px-0"><Banner kind="error" title={submitError} /></div>}
      </div>

      {editable && open.map(item => {
        const s = state.items[item.product_id];
        return (
          <EditableItemCard
            key={item.product_id} item={item}
            rating={s?.rating ?? 0} content={s?.content ?? ''} photos={s?.photos ?? []}
            onRating={n => ed.setRating(item.product_id, n)}
            onContent={t => ed.setContent(item.product_id, t)}
            onAddFiles={files => ed.addFiles(item.product_id, files)}
            onRemovePhoto={k => ed.removePhoto(item.product_id, k)}
            onRetryPhoto={k => ed.retry(item.product_id, k)}
          />
        );
      })}

      {done.length > 0 && (
        <>
          {editable && <h2 className="px-4 pt-4 text-sm font-medium md:px-0">已評價的商品</h2>}
          {done.map(item => <ReadonlyItemCard key={item.product_id} item={item} onOpenPhoto={lightbox.open} />)}
        </>
      )}

      {editable && (
        <>
          <section className="mt-2 bg-white p-4 md:mt-3 md:rounded-md md:p-6">
            <label htmlFor="nickname-input" className="text-sm font-medium">
              暱稱<span className="font-normal text-muted">（選填，這張訂單的評價共用）</span>
            </label>
            <input
              id="nickname-input" type="text" value={state.nickname} placeholder="例如：小花貓"
              autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
              aria-invalid={nickError ? true : undefined} aria-describedby="nickname-help nickname-error"
              onChange={e => { ed.setNickname(e.target.value); setServerNickError(false); }}
              onBlur={() => setNickTouched(true)}
              className={`mt-2 block h-11 w-full scroll-mt-20 rounded-sm border px-3 text-base outline-none placeholder:text-muted ${nickError ? 'border-error-border' : 'border-line focus:border-ink'}`}
            />
            <div className="mt-1.5 flex items-start justify-between gap-3 text-xs">
              <p id="nickname-help" className="text-muted">暱稱會以遮罩方式公開（例：小*****貓），請勿使用真實姓名</p>
              <span className="shrink-0 tabular-nums text-muted">{Array.from(state.nickname.trim()).length} / 12</span>
            </div>
            <p id="nickname-error" role={nickError ? 'alert' : undefined} className="mt-1 text-xs text-error-text">{nickError}</p>
            {!nickError && (
              <p className="mt-1 text-xs">
                {nick.ok && nick.value
                  ? <>公開時顯示為「<strong>{maskNickname(nick.value)}</strong>」</>
                  : '沒填暱稱的話，公開時顯示「匿名買家」'}
              </p>
            )}
            <div className="mt-4">
              <Banner kind="info" title="賣家可以看到這則評價的訂單編號。" role="none">
                如果你填了暱稱，賣家也會看到完整的暱稱，公開頁面只顯示遮罩後的樣子。
              </Banner>
            </div>
          </section>

          <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white shadow-bar-top md:static md:mt-3 md:rounded-md md:border-0 md:shadow-none">
            <div className="px-4 py-3 md:flex md:items-center md:justify-between md:gap-6 md:p-6">
              <p role="status" className="mb-2 text-center text-xs text-muted md:mb-0 md:text-left md:text-sm">{message}</p>
              <button
                type="button" onClick={onSubmitClick} aria-disabled={blocker ? true : undefined}
                className={`h-12 w-full rounded-sm text-base font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:w-56 md:shrink-0 ${blocker ? 'bg-disabled' : 'bg-brand hover:bg-brand-dark'}`}
              >
                送出評價
              </button>
            </div>
          </div>
        </>
      )}

      {confirming && (
        <LeaveDialog
          title="確定送出評價？"
          description={
            <>
              <p className="text-ink">{confirmSummary(ratedCount, photoCount)}</p>
              <p className="mt-2 font-medium text-ink">送出後無法修改或刪除。</p>
              <p className="mt-2 text-xs">賣家可以看到這則評價的訂單編號。</p>
            </>
          }
          stayLabel="返回修改" leaveLabel="確定送出" leaveTone="primary"
          busy={submitting} busyLabel="送出中…"
          onStay={() => setConfirming(false)} onLeave={() => void doSubmit()}
        />
      )}
      {leave.state === 'blocked' && (
        <LeaveDialog
          title="要離開嗎？" description="你填寫的評價還沒送出，離開後內容會消失。"
          stayLabel="留在這裡" leaveLabel="離開" onStay={stay} onLeave={leaveNow}
        />
      )}
      {lightbox.element}
    </>
  );
}
