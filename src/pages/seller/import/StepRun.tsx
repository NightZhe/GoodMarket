import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import Banner from '../../../components/import/Banner';
import Progress from '../../../components/import/Progress';
import { btnOutline, btnPrimary } from '../../../components/import/ui';
import { callErrorExplanation } from '../../../lib/import/errors';
import { OFFLINE_MESSAGE, type ImportRunner } from '../../../lib/import/runner';
import { n, useFocusOnMount } from './shared';

/** 30 秒沒有任何數字前進，提示「好像有點慢」（不是錯誤，不停止、不要求操作） */
const STALL_MS = 30_000;

interface Props {
  runner: ImportRunner;
  announce: (text: string) => void;
  onRestart: () => void;
  onDone: () => void;
}

const pct = (done: number, total: number) => (total === 0 ? 0 : (done / total) * 100);

export default function StepRun({ runner, announce, onRestart, onDone }: Props) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const [now, setNow] = useState(() => Date.now());

  const active = snap.phase === 'preparing' || snap.phase === 'running' || snap.phase === 'finishing';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  // 完成就進結果頁
  useEffect(() => { if (snap.phase === 'done') onDone(); }, [snap.phase, onDone]);

  // 進度只在 25／50／75 % 朗讀，避免逐筆念個不停
  const productPct = pct(snap.products.done, snap.products.total);
  const bucket = Math.floor(productPct / 25);
  useEffect(() => {
    if (bucket >= 1 && bucket <= 3) announce(`匯入進度 ${bucket * 25}%`);
  }, [bucket, announce]);

  const interrupted = snap.phase === 'interrupted' || snap.phase === 'fatal';
  const stalled = snap.phase === 'running' && now - snap.lastProgressAt > STALL_MS;
  const preparing = snap.phase === 'preparing';
  const noImages = snap.images.total === 0 && !preparing;
  const written = snap.created + snap.updated;

  const imageKind = interrupted ? 'interrupted' : preparing ? 'preparing' : noImages || snap.images.done >= snap.images.total ? 'done' : 'running';
  const productKind = interrupted ? 'interrupted' : preparing ? 'preparing' : snap.products.done >= snap.products.total ? 'done' : 'running';

  return (
    <section aria-labelledby="step3-title" className="space-y-4">
      <div>
        <h2 id="step3-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">匯入中</h2>
        <p className="mt-1 text-sm text-muted">
          正在把 {n(snap.products.total)} 件商品搬進好物集。
          {snap.priorDone > 0 && `這是接續上次的匯入，上次已完成 ${n(snap.priorDone)} 件。`}
        </p>
      </div>

      {active && (
        <Banner kind="warning" title="可以的話請不要關閉這個頁面" role="none">
          圖片是在這個瀏覽器分頁裡轉存的，關掉分頁或重新整理，匯入就會停住。萬一中斷了，已寫入的商品會保留；之後把同一批檔案再放進來，就會從沒做完的地方接著做。
        </Banner>
      )}

      {snap.phase === 'interrupted' && (
        <Banner
          kind="error" title="匯入中斷了"
          actions={(
            <>
              <button type="button" className={btnPrimary} onClick={() => void runner.run()}>重新嘗試</button>
              <Link to="/seller/products" className={btnOutline}>先離開</Link>
            </>
          )}
        >
          <p>{snap.message && snap.message !== OFFLINE_MESSAGE ? '匯入停住了' : OFFLINE_MESSAGE}。已寫入 {n(written)} 件商品、轉存 {n(snap.images.done)} 張圖片，都會保留。按「重新嘗試」會從沒做完的地方接著做。</p>
          {snap.message && snap.message !== OFFLINE_MESSAGE && <p className="mt-1 text-xs text-muted">{snap.message}</p>}
          <p className="mt-1 text-xs text-muted">中斷了也沒關係：先離開的話，之後把同一批檔案再放進來，就會從沒做完的地方接著做。</p>
        </Banner>
      )}

      {snap.phase === 'fatal' && (
        <Banner
          kind="error" title="匯入無法繼續"
          actions={<button type="button" className={btnPrimary} onClick={onRestart}>回到步驟 1</button>}
        >
          <p>
            {snap.errorCode ? callErrorExplanation(snap.errorCode) : '發生了預期之外的錯誤'}
            {snap.errorCode && `（代碼 ${snap.errorCode}）`}。已寫入的商品會保留。
          </p>
          {snap.message && !snap.errorCode && <p className="mt-1 text-xs text-muted">{snap.message}</p>}
        </Banner>
      )}

      {snap.phase === 'finish-failed' && (
        <Banner
          kind="warning" title="幾乎完成了" role="alert"
          actions={(
            <>
              <button type="button" className={btnPrimary} onClick={() => void runner.retryFinish()}>重新儲存紀錄</button>
              <button type="button" className={btnOutline} onClick={() => runner.skipFinish()}>直接看結果</button>
            </>
          )}
        >
          <p>商品都已寫入，但匯入紀錄沒有存成功。這不影響已匯入的商品。</p>
          <p className="mt-1 text-xs text-muted">按「重新儲存紀錄」再試一次；沒存成功的話，下次進精靈會看到這次顯示為「未完成」，把同一批檔案再放進來就能收尾。</p>
        </Banner>
      )}

      {stalled && (
        <Banner kind="info" title="好像有點慢，仍在進行中…" role="none">
          網路較慢、或這個分頁在背景時，轉存會比較久。請先不要關閉頁面。
        </Banner>
      )}

      <div className="space-y-5 rounded-lg border border-line bg-white p-4 md:p-6">
        <Progress
          kind={imageKind} label="圖片轉存"
          valueText={preparing ? '準備中…' : noImages ? '不需要轉存' : `${n(snap.images.done)}／${n(snap.images.total)} 張`}
          percent={noImages ? 100 : pct(snap.images.done, snap.images.total)}
          note={noImages ? '圖片都已在好物集' : undefined}
        />
        <Progress
          kind={productKind} label="商品寫入"
          valueText={preparing ? '準備中…' : `${n(snap.products.done)}／${n(snap.products.total)} 件`}
          percent={productPct}
        />
        <p className="text-sm text-muted tabular-nums">
          {snap.batch.total > 0 && `第 ${snap.batch.current}／${snap.batch.total} 批　`}
          新增 {n(snap.created)}・更新 {n(snap.updated)}・失敗 {n(snap.failed)}・略過圖片 {n(snap.skippedImages)} 張
        </p>
        {snap.phase === 'finishing' && <p role="status" className="text-sm text-muted">正在儲存匯入紀錄…</p>}
      </div>
    </section>
  );
}
