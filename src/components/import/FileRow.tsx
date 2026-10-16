import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, FileSpreadsheet, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { focusRing } from './ui';

export type FileRowState = 'empty' | 'parsing' | 'ready' | 'error' | 'notice';

interface Props {
  state: FileRowState;
  title: string;
  /** 機器欄位鍵，如 basic_info（槽位才有） */
  kindKey?: string;
  detail?: ReactNode;
  message?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}

const BOX: Record<FileRowState, string> = {
  empty: 'border-dashed border-disabled bg-white',
  parsing: 'border-line bg-white',
  ready: 'border-line bg-white',
  error: 'border-error-border bg-white',
  notice: 'border-warning-border bg-white',
};

function StateIcon({ state }: { state: FileRowState }) {
  switch (state) {
    case 'ready': return <CircleCheck size={20} className="text-success" aria-hidden="true" />;
    case 'error': return <CircleAlert size={20} className="text-error-text" aria-hidden="true" />;
    case 'notice': return <TriangleAlert size={20} className="text-warning-text" aria-hidden="true" />;
    case 'parsing': return <LoaderCircle size={20} className="text-muted motion-safe:animate-spin" aria-hidden="true" />;
    case 'empty': return <FileSpreadsheet size={20} className="text-disabled" aria-hidden="true" />;
  }
}

const STATE_TEXT: Record<FileRowState, string> = {
  empty: '尚未放入', parsing: '辨識中', ready: '已辨識', error: '有問題', notice: '提示',
};

/** 一個檔案（或一個還空著的槽位）。狀態同時用圖示與文字（sr-only）表達，不只靠顏色 */
export default function FileRow({ state, title, kindKey, detail, message, onRemove, removeLabel }: Props) {
  return (
    <li className={`flex items-start gap-3 rounded-md border p-3 ${BOX[state]}`}>
      <span className="mt-0.5 shrink-0"><StateIcon state={state} /></span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">
          <span className="sr-only">{STATE_TEXT[state]}：</span>
          {title}
          {kindKey && <span className="ml-2 text-xs font-normal text-muted">{kindKey}</span>}
        </p>
        {state === 'empty' && <p className="mt-0.5 text-sm text-muted">尚未放入</p>}
        {state === 'parsing' && <p className="mt-0.5 text-sm text-muted">辨識中…</p>}
        {detail && <p className="mt-0.5 break-words text-sm text-muted">{detail}</p>}
        {message && (
          <div className={`mt-1 text-sm ${state === 'error' ? 'text-error-text' : state === 'notice' ? 'text-warning-text' : 'text-ink'}`}>
            {message}
          </div>
        )}
      </div>
      {onRemove && (
        <button
          type="button" onClick={onRemove} aria-label={removeLabel ?? '移除'}
          className={`-my-1 -mr-1 flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2 text-sm text-muted hover:bg-canvas hover:text-ink ${focusRing}`}
        >
          <X size={16} aria-hidden="true" />
          <span>移除</span>
        </button>
      )}
    </li>
  );
}
