import { useEffect, useRef } from 'react';
import type { FileIntake, FileSetAnalysis, PreviewResult } from '../../../lib/shopee-import/types';
import type { ImportClientFailure, ImportIndex, ImportStartMeta } from '../../../types';
import type { ImportItemDraft } from '../../../lib/shopee-import/types';

/** 步驟 1 放進來的一個檔案：辨識中，或已辨識（成功或各種錯誤） */
export type Entry =
  | { id: string; fileName: string; state: 'parsing' }
  | { id: string; fileName: string; state: 'done'; intake: FileIntake };

/** 步驟 2 按下「開始匯入」時交給執行器的東西 */
export interface StartPayload {
  meta: ImportStartMeta;
  drafts: ImportItemDraft[];
  previewFailures: ImportClientFailure[];
  knownImages: ImportIndex['images'];
  /** 結果頁用：商品 ID → 名稱（失敗清單要顯示名稱） */
  titles: Record<string, string>;
  preview: PreviewResult;
}

/** 目前步驟 1 的分析結果（三檔齊全且沒有阻擋錯誤才可前往） */
export type ReadyAnalysis = FileSetAnalysis & { sheets: NonNullable<FileSetAnalysis['sheets']>; externalShopId: string };

/** 換步驟時把焦點移到該步驟的標題（螢幕閱讀器與鍵盤使用者才知道頁面變了） */
export function useFocusOnMount<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => { if (enabled) ref.current?.focus(); }, [enabled]);
  return ref;
}

export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const n = (v: number) => v.toLocaleString('en-US');
