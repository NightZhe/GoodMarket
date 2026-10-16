import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import LeaveDialog from '../../components/import/LeaveDialog';
import Steps from '../../components/import/Steps';
import { fetchAndCompress, sleepWithSignal, transferImage } from '../../lib/import/images';
import { loadShopeeImport, type ShopeeImportLib } from '../../lib/import/loader';
import { ImportRunner, type RunnerPhase, type RunnerSnapshot } from '../../lib/import/runner';
import { useStore } from '../../store/StoreContext';
import StepFiles, { type LastImport } from './import/StepFiles';
import StepPreview from './import/StepPreview';
import StepResult from './import/StepResult';
import StepRun from './import/StepRun';
import type { Entry, ReadyAnalysis, StartPayload } from './import/shared';

type Step = 1 | 2 | 3 | 4;

/** 匯入進行中（還在寫入）才需要離開確認；已中斷或已完成可以直接離開 */
const BLOCKING_PHASES: readonly RunnerPhase[] = ['preparing', 'running', 'finishing'];

const noopSubscribe = () => () => undefined;
const idleSnapshot = (): RunnerSnapshot | null => null;

function useRunnerSnapshot(runner: ImportRunner | null): RunnerSnapshot | null {
  return useSyncExternalStore(runner ? runner.subscribe : noopSubscribe, runner ? runner.getSnapshot : idleSnapshot);
}

export default function ImportWizard() {
  const { getImportIndex, importApi, uploadImportImage, reload } = useStore();

  const [lib, setLib] = useState<ShopeeImportLib | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [analysis, setAnalysis] = useState<ReadyAnalysis | null>(null);
  const [lastImport, setLastImport] = useState<LastImport>({ state: 'loading' });
  const [run, setRun] = useState<{ runner: ImportRunner; payload: StartPayload } | null>(null);
  const [leftStep1, setLeftStep1] = useState(false);
  const [announcement, setAnnouncement] = useState({ id: 0, text: '' });

  const announce = useCallback((text: string) => setAnnouncement((a) => ({ id: a.id + 1, text })), []);

  const ensureLib = useCallback(async () => {
    const l = await loadShopeeImport();
    setLib(l);
    return l;
  }, []);

  // 進頁就先載入解析工具（約 650 KB）；失敗不在這裡處理，使用者放入檔案時會重試並顯示錯誤
  useEffect(() => { ensureLib().catch(() => undefined); }, [ensureLib]);

  // 步驟 1 要顯示「上次匯入」。讀不到不擋流程
  useEffect(() => {
    if (step !== 1) return;
    const ctl = new AbortController();
    setLastImport({ state: 'loading' });
    getImportIndex(ctl.signal)
      .then((idx) => { if (!ctl.signal.aborted) setLastImport({ state: 'ready', record: idx.lastImport }); })
      .catch(() => { if (!ctl.signal.aborted) setLastImport({ state: 'unavailable' }); });
    return () => ctl.abort();
  }, [step, getImportIndex]);

  // 整個頁面擋掉瀏覽器預設的「把檔案拖進視窗就開啟它」，拖偏了才不會直接跳離頁面
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);

  const runner = run?.runner ?? null;
  const snap = useRunnerSnapshot(runner);
  const blocking = snap !== null && BLOCKING_PHASES.includes(snap.phase);

  // 關分頁、重新整理：瀏覽器原生對話框（文案無法客製）
  useEffect(() => {
    if (!blocking) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [blocking]);

  // 站內導覽（側欄、返回、分頁列、瀏覽器上一頁）
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    blocking && currentLocation.pathname !== nextLocation.pathname
  ));

  // 離開頁面：停掉進行中的請求；已寫入的商品要讓「我的商品」看得到
  const runnerRef = useRef<ImportRunner | null>(null);
  runnerRef.current = runner;
  useEffect(() => () => {
    const r = runnerRef.current;
    if (!r) return;
    r.abort();
    const s = r.getSnapshot();
    if (s.created + s.updated > 0) void reload();
  }, [reload]);

  const reset = () => {
    runner?.abort();
    setRun(null);
    setEntries([]);
    setAnalysis(null);
    setStep(1);
  };

  const handleStart = (payload: StartPayload) => {
    if (!lib) return;
    const r = new ImportRunner(
      { meta: payload.meta, drafts: payload.drafts, previewFailures: payload.previewFailures, knownImages: payload.knownImages },
      {
        api: importApi,
        transfer: (url, signal) => transferImage(url, {
          fetchAndCompress, upload: uploadImportImage, sleep: sleepWithSignal,
        }, signal),
        sleep: sleepWithSignal,
        isOffline: async () => !navigator.onLine || !(await importApi.reachable()),
        coverFailureReason: lib.coverImageFailureReason,
        backendItemReason: lib.backendItemErrorReason,
      },
    );
    setRun({ runner: r, payload });
    setStep(3);
    announce('開始匯入');
    void r.run();
  };

  const handleDone = useCallback(() => {
    setStep(4);
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/seller/products" className="inline-flex min-h-11 items-center gap-1 text-sm hover:text-brand">
        <ArrowLeft size={16} aria-hidden="true" />我的商品
      </Link>
      <h1 className="text-xl font-bold">從蝦皮匯入商品</h1>
      <div className="mt-4"><Steps current={step} /></div>

      <div className="mt-4 rounded-lg bg-white p-4 md:p-6">
        {step === 1 && (
          <StepFiles
            lib={lib} ensureLib={ensureLib} entries={entries} setEntries={setEntries}
            lastImport={lastImport} announce={announce} focusHeading={leftStep1}
            onNext={(a) => { setAnalysis(a); setLeftStep1(true); setStep(2); }}
          />
        )}
        {step === 2 && lib && analysis && (
          <StepPreview lib={lib} analysis={analysis} announce={announce} onBack={() => setStep(1)} onStart={handleStart} />
        )}
        {step === 3 && run && <StepRun runner={run.runner} announce={announce} onRestart={reset} onDone={handleDone} />}
        {step === 4 && run && lib && analysis && (
          <StepResult
            lib={lib} analysis={analysis} outcome={run.runner.getOutcome()}
            skipped={run.payload.meta.skipped} localFailed={run.runner.getSnapshot().failed}
            titles={run.payload.titles} onAgain={reset}
          />
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        <span key={announcement.id}>{announcement.text}</span>
      </div>

      {blocker.state === 'blocked' && (
        <LeaveDialog
          title="要離開嗎？匯入還沒完成"
          description={`現在離開會中斷匯入。已經寫入的 ${((snap?.created ?? 0) + (snap?.updated ?? 0)).toLocaleString('en-US')} 件商品會保留；沒做完的部分，之後再匯入同一批檔案就會接著完成。`}
          stayLabel="留在這裡"
          leaveLabel="離開並中斷"
          onStay={() => blocker.reset()}
          onLeave={() => { runner?.abort(); blocker.proceed(); }}
        />
      )}
    </div>
  );
}
