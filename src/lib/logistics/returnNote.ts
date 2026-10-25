// 退貨說明（選填，≤ 200 字）的字數與儲存狀態。規則與資料庫 set_return_note 一致（interface-logistics.md 2.7）。

export const NOTE_MAX = 200;

/** \n 以外的控制字元（Tab、BEL、DEL、C1 如 U+0085）：資料庫回 RETURN_NOTE_INVALID */
const BAD_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

/** 送出前的樣子：CRLF／CR 轉 LF，去頭尾空白與換行 */
export const normalizeNote = (s: string): string => s.replace(/\r\n?/g, '\n').trim();

/** 字數用 code point：資料庫是 char_length，s.length 會把 emoji 算成 2 */
export const noteLength = (s: string): number => [...normalizeNote(s)].length;

export const remainText = (remaining: number): string => (remaining < 0 ? `超過 ${-remaining} 字` : `剩 ${remaining} 字`);

export interface NoteStatus {
  length: number;
  /** 還能打幾字；超過時是負數 */
  remaining: number;
  /** 超過幾字（沒超過＝0） */
  over: number;
  /** 和已存的內容不一樣（頭尾空白不算）；清空已存的說明也算 */
  dirty: boolean;
  canSave: boolean;
  /** 欄位錯誤句；沒有錯就是 null */
  error: string | null;
}

/** draft＝輸入框現在的字；saved＝資料庫目前存的（沒有＝null） */
export function noteStatus(draft: string, saved: string | null): NoteStatus {
  const text = normalizeNote(draft);
  const length = [...text].length;
  const remaining = NOTE_MAX - length;
  const over = remaining < 0 ? -remaining : 0;
  const dirty = text !== normalizeNote(saved ?? '');
  const error = over > 0 ? `退貨說明最多 ${NOTE_MAX} 字，目前多了 ${over} 字`
    : BAD_CONTROL.test(text) ? '退貨說明含有不能使用的字元'
    : null;
  return { length, remaining, over, dirty, canSave: dirty && error === null, error };
}
