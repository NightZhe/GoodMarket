import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { CircleX, Info } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useRefreshOnVisible, useReviews } from '../../store/ReviewsContext';
import { useToast } from '../../components/Toast';
import Banner from '../../components/import/Banner';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { EditableItemCard, ReadonlyItemCard } from '../../components/reviews/ReviewItemCards';
import { EmptyBlock, InlineError } from '../../components/reviews/states';
import { useLightbox } from '../../components/reviews/useLightbox';
import { GlassTray, TrayButton } from '../../components/glass';
import { submitAccountReviews } from '../../lib/reviews/api';
import LoginRequired from '../../components/auth/LoginRequired';
import { accountLabel, nicknamePrefillFor } from '../../lib/auth/identity';
import { resolveNicknamePrefill } from '../../lib/account/nickname';
import { useSavedNickname } from '../../lib/account/useSavedNickname';
import {
  NICKNAME_HINT_ERROR, ReviewError, needsStatusRefresh, submitErrorMessage, SUBMIT_FALLBACK,
} from '../../lib/reviews/errors';
import { confirmSummary, ratedItems, readyMessage, submitBlocker, type Blocker } from '../../lib/reviews/form';
import { deadlineDateTime } from '../../lib/reviews/format';
import { maskNickname, validateNickname } from '../../lib/reviews/nickname';
import { formGate, partitionItems } from '../../lib/reviews/status';
import type { OrderReviewStatus } from '../../lib/reviews/types';
import { toSubmitItems, useReviewEditor } from './reviewEditor';
import { TRAY_DIMMED, TRAY_RIGHT_HALF } from '../../lib/layout/trayPlacement';
import { trayReserveStyle, useTrayHeightReport } from '../../lib/layout/trayReserve';

/** 評價表單 #/orders/:orderId/review：要先登入；訂單要屬於目前登入的帳號（別人的訂單一律「找不到」，不透露存在與否） */
export default function ReviewForm() {
  return (
    <LoginRequired kind="review">
      <ReviewFormView />
    </LoginRequired>
  );
}

function ReviewFormView() {
  const { orderId = '' } = useParams();
  const { myOrders, myOrdersState, refreshMyOrders, user } = useStore();
  const { statusState, statusOf, refreshStatus } = useReviews();
  const [retrying, setRetrying] = useState(false);
  // 送出托盤在 FormBody 裡，高度（文字放大換行會變高）回報到這裡，外層內容底部預留才跟得上
  const [trayHeight, setTrayHeight] = useState(0);
  const status = statusOf(orderId);
  // 暱稱預填順序：個人檔案的暱稱 → Google 名稱 → 空白。預填值只在表單建立時使用，所以先等個人檔案的暱稱讀回來
  const saved = useSavedNickname();

  useRefreshOnVisible(() => { void refreshStatus(true); });
  useEffect(() => { void refreshStatus(true); }, [refreshStatus]);

  const retry = () => {
    setRetrying(true);
    void Promise.all([refreshStatus(), refreshMyOrders()]).finally(() => setRetrying(false));
  };

  let content: React.ReactNode;
  if (!status && (statusState === 'error' || myOrdersState === 'error')) {
    content = (
      <div className="mt-2 bg-white md:mt-3 md:rounded-md">
        <InlineError title="載入失敗" retrying={retrying} onRetry={retry} />
        <p className="pb-6 text-center text-sm"><Link to="/orders" className="underline underline-offset-2">回我的訂單</Link></p>
      </div>
    );
  } else if (!status) {
    const order = myOrders.find(o => o.id === orderId);
    if (statusState === 'loading' || myOrdersState === 'loading' || myOrdersState === 'idle') content = <FormSkeleton />;
    else if (order?.status === 'cancelled') content = <Notice icon="🧾" title="這筆訂單已取消" description="已取消的訂單無法評價。" />;
    else if (order) content = <Notice icon="🧾" title="訂單完成後才能評價" description="確認收到商品並按下「完成訂單」後，就可以評價了。" />;
    else content = <NotFoundCard account={user ? accountLabel(user) : ''} />;
  } else {
    const gate = formGate(status);
    if (gate.kind === 'expiredEmpty') {
      content = <Notice icon="🧾" title="評價期限已過" description={`這筆訂單的評價期限是 ${deadlineDateTime(status.deadline_date)}，已經無法評價。`} />;
    } else if (gate.kind === 'empty') {
      content = <Notice icon="🧾" title="這筆訂單沒有可以評價的商品" />;
    } else {
      content = saved.state === 'loading'
        ? <FormSkeleton />
        : <FormBody key={orderId} status={status} editable={gate.kind === 'form'} savedNickname={saved.nickname} onTrayHeight={setTrayHeight} />;
    }
  }

  return (
    <div style={trayReserveStyle(false, trayHeight)} className="mx-auto max-w-3xl pb-[calc(var(--tray-reserve)+2rem)] md:px-4 md:pb-10 md:pt-6">
      {/* 返回在外框的導覽列（水平姿態）或直立軌（側邊姿態），頁內不再放返回箭頭 */}
      <header className="bg-white md:rounded-t-md">
        <div className="flex min-h-11 items-center px-4">
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

/** 訂單不在目前登入的帳號裡（S-8b）。文字不說「這是別人的訂單」：不透露訂單是否存在（R-10） */
function NotFoundCard({ account }: { account: string }) {
  return (
    <div className="mt-2 bg-white md:mt-3 md:rounded-md">
      <EmptyBlock
        icon="🧾" title="找不到這筆訂單"
        description="這筆訂單不在你目前登入的帳號裡。請確認登入的是下單時使用的帳號（Google、Apple 或手機號碼）。"
        action={
          <>
            {account && <p className="text-xs text-muted">目前登入：{account}</p>}
            <div className="mt-3 flex w-full max-w-xs flex-col gap-2">
              <Link to="/orders" className={`${btnPrimary} h-12 text-base`}>回我的訂單</Link>
              <Link to="/account" className={`${btnOutline} h-12 text-base`}>到帳號頁切換帳號</Link>
            </div>
          </>
        }
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

interface BodyProps { status: OrderReviewStatus; editable: boolean; savedNickname: string | null | undefined; onTrayHeight: (height: number) => void }

function FormBody({ status, editable, savedNickname, onTrayHeight }: BodyProps) {
  const trayRef = useTrayHeightReport(onTrayHeight);
  const navigate = useNavigate();
  const { user } = useStore();
  const prefill = useMemo(() => resolveNicknamePrefill(savedNickname, nicknamePrefillFor(user)), [savedNickname, user]);
  const toast = useToast();
  const { refreshStatus, refreshSummary } = useReviews();
  const online = useOnline();
  const { open, done } = partitionItems(status.items);
  const lightbox = useLightbox();

  const handleFatal = useCallback((e: ReviewError) => {
    if (needsStatusRefresh(e.code)) void refreshStatus(true);
  }, [refreshStatus]);

  const ed = useReviewEditor({
    orderId: status.order_id, nicknamePrefill: prefill?.value ?? '', productIds: open.map(i => i.product_id), onFatal: handleFatal,
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
  // 預填只發生在載入時（沒有草稿）；使用者改過或清空之後說明就消失，也不會再次預填（R-14）
  const prefillActive = Boolean(prefill) && state.nickname === prefill?.value && !ed.notice.restored;
  const clearNickname = () => {
    ed.setNickname('');
    setServerNickError(false);
    document.getElementById('nickname-input')?.focus();
  };
  const nickError = (nickTouched && !nick.ok) || serverNickError ? (nick.ok ? NICKNAME_HINT_ERROR : nick.message) : null;

  const editorItems = open.map(i => {
    const s = state.items[i.product_id];
    return { productId: i.product_id, rating: s?.rating ?? 0, content: s?.content ?? '', photos: s?.photos ?? [] };
  });
  const blocker = submitBlocker(editorItems, nick.ok);
  const ratedCount = ratedItems(editorItems).length;
  const photoCount = ratedItems(editorItems).reduce((n, i) => n + i.photos.filter(p => p.status === 'done').length, 0);
  const dirty = editable && ed.hasUserInput;

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
        await submitAccountReviews(status.order_id, nickname, toSubmitItems(state));
      } catch (e) {
        if (!(e instanceof ReviewError) || e.code !== 'UPLOAD_EXPIRED') throw e;
        // 上傳位置在送出前過期：自動重新申請、重傳一次，再送一次（AC-72）
        const paths = await ed.reuploadAll(rated);
        if (!paths) throw e;
        await submitAccountReviews(status.order_id, nickname, toSubmitItems(state, paths));
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
            <div className="relative mt-2">
              <input
                id="nickname-input" type="text" value={state.nickname} placeholder="例如：小花貓"
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
                aria-invalid={nickError ? true : undefined}
                aria-describedby={`nickname-help ${prefillActive ? 'nickname-prefill ' : ''}nickname-error`}
                onChange={e => { ed.setNickname(e.target.value); setServerNickError(false); }}
                onBlur={() => setNickTouched(true)}
                className={`block h-11 w-full scroll-mt-20 rounded-sm border pl-3 pr-11 text-base outline-none placeholder:text-muted ${nickError ? 'border-error-border' : 'border-line focus:border-ink'}`}
              />
              {state.nickname !== '' && (
                <button
                  type="button" aria-label="清空暱稱" onClick={clearNickname}
                  className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <CircleX size={20} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-start justify-between gap-3 text-xs">
              <p id="nickname-help" className="text-muted">
                {prefillActive ? '暱稱會以遮罩方式公開，賣家看得到完整暱稱。' : '暱稱會以遮罩方式公開（例：小*****貓），請勿使用真實姓名'}
              </p>
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
            {prefillActive && prefill && (
              <p id="nickname-prefill" className="mt-3 flex gap-2 rounded-sm bg-subtle p-2.5 text-xs leading-5">
                <Info size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                <span>
                  {prefill.source === 'profile'
                    ? '已填入你在個人檔案設定的暱稱。賣家會看到完整暱稱。不想用就直接修改或清空，改的只影響這則評價。'
                    : <>
                        {prefill.adjusted
                          ? `已把你的 Google 名稱「${prefill.original}」調整成符合暱稱規則的格式（去掉空格與符號）。`
                          : '已填入你的 Google 名稱。'}
                        Google 名稱可能是你的真實姓名，賣家會看到完整暱稱。不想用就直接修改或清空。
                      </>}
                </span>
              </p>
            )}
            <div className="mt-4">
              <Banner kind="info" title="賣家可以看到這則評價的訂單編號。" role="none">
                如果你填了暱稱，賣家也會看到完整的暱稱，公開頁面只顯示遮罩後的樣子。
              </Banner>
            </div>
          </section>

          {/* 手機：底部懸浮送出托盤（C5）。桌機（md 以上）維持頁內送出列 */}
          <div ref={trayRef} className={`md:hidden ${TRAY_DIMMED} ${TRAY_RIGHT_HALF}`}>
            <GlassTray label="送出評價">
              <p role="status" className="basis-full text-center text-footnote text-muted">{message}</p>
              <TrayButton tone="primary" onClick={onSubmitClick} aria-disabled={blocker ? true : undefined}>送出評價</TrayButton>
            </GlassTray>
          </div>
          <div className="hidden md:mt-3 md:flex md:items-center md:justify-between md:gap-6 md:rounded-md md:bg-white md:p-6">
            <p role="status" className="text-sm text-muted">{message}</p>
            <button
              type="button" onClick={onSubmitClick} aria-disabled={blocker ? true : undefined}
              className={`h-12 w-56 shrink-0 rounded-sm text-base font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${blocker ? 'bg-disabled' : 'bg-brand hover:bg-brand-dark'}`}
            >
              送出評價
            </button>
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
