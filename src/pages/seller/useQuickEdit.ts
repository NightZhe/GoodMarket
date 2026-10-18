import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../../store/StoreContext';
import { wholeNumber } from '../../lib/products/variants';
import {
  QuickEditError, changesKey, collectQuickEdit, fieldError, fieldKey, invalidToErrors, needsConfirm,
  type ConfirmLine, type QuickChange, type QuickConflict, type QuickEditFailureKind, type QuickEditOk, type QuickField, type QuickRow,
} from '../../lib/products/quickEdit';
import type { Product, Variant } from '../../types';

/** 送出超過這麼久還沒回，讀屏要被告知「儲存中」（design 7.2） */
const SLOW_MS = 1500;

export type QuickPhase =
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'confirm'; lines: ConfirmLine[] }
  | { kind: 'conflict'; conflicts: QuickConflict[]; current: Variant[] }
  | { kind: 'failed'; failure: QuickEditFailureKind };

export interface SavedInfo { result: QuickEditOk; changes: QuickChange[] }

export interface UseQuickEditArgs {
  product: Product;
  /** 這個編輯區能改哪些欄位：桌機一次一種；手機面板兩種一起 */
  fields: QuickField[];
  onSaved: (info: SavedInfo) => void;
  /** 商品或規格已經不存在（資料庫回 PRODUCT_NOT_FOUND／VARIANT_NOT_FOUND）：外層重抓列表 */
  onGone: (kind: 'not_found' | 'variant_missing') => void;
  /** 取消、或沒有任何修改就按儲存：外層收起編輯區並把焦點還回去 */
  onClose: () => void;
  /** 有沒有還沒儲存的修改、是不是正在送出：外層用來決定能不能切換格子、離開頁面要不要確認 */
  onStatusChange: (status: { dirty: boolean; busy: boolean }) => void;
}

/** focusReq 的特殊鍵：焦點要去決策區的主按鈕，不是輸入框 */
export const FOCUS_CONFLICT = 'focus:conflict';
export const FOCUS_CONFIRM = 'focus:confirm';
export const FOCUS_FAILED = 'focus:failed';

export const inputId = (productId: string, variantId: string, field: QuickField) => `qe-${productId}-${variantId}-${field}`;

const toRows = (variants: Variant[]): QuickRow[] => variants.map(v => ({
  id: v.id, name: v.name, originalPrice: v.originalPrice, seen: { price: v.price, stock: v.stock },
}));

/** 單格編輯（桌機）與底部面板（手機）共用的狀態機：草稿、驗證、大幅改價確認、送出、衝突、失敗 */
export function useQuickEdit({ product, fields, onSaved, onGone, onClose, onStatusChange }: UseQuickEditArgs) {
  const { quickEditProduct, syncProductSnapshot } = useStore();
  const [rows, setRows] = useState<QuickRow[]>(() => toRows(product.variants));
  const [drafts, setDrafts] = useState<Record<string, Record<QuickField, string>>>(() =>
    Object.fromEntries(product.variants.map(v => [v.id, { price: String(v.price), stock: String(v.stock) }])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<QuickPhase>({ kind: 'editing' });
  const [slow, setSlow] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [announce, setAnnounce] = useState<{ id: number; text: string } | null>(null);
  const [focusReq, setFocusReq] = useState<{ key: string; n: number } | null>(null);

  const pending = useRef<QuickChange[]>([]);
  /** 賣家確認過的那一組大幅改價；值一變（指紋不同）就要重新確認 */
  const confirmedKey = useRef<string | null>(null);
  const sending = useRef(false);
  /** 衝突時資料庫回的目前值；取消時寫回列表，不然列表停在舊值、下次又撞衝突 */
  const snapshot = useRef<{ variants: Variant[]; status: Product['status'] } | null>(null);

  const changedIds = useMemo(
    () => new Set(rows.filter(r => fields.some(f => wholeNumber(drafts[r.id]?.[f] ?? '') !== r.seen[f])).map(r => r.id)),
    [rows, drafts, fields],
  );
  const conflictIds = useMemo(
    () => new Set(phase.kind === 'conflict' ? phase.conflicts.map(c => c.variantId) : []),
    [phase],
  );
  const dirty = changedIds.size > 0;
  const busy = phase.kind === 'saving';

  useEffect(() => { onStatusChange({ dirty, busy }); }, [dirty, busy, onStatusChange]);

  const requestFocus = useCallback((key: string) => setFocusReq(prev => ({ key, n: (prev?.n ?? 0) + 1 })), []);
  const say = useCallback((text: string) => setAnnounce(prev => ({ id: (prev?.id ?? 0) + 1, text })), []);
  /** 依規格順序、欄位順序，第一個有錯的輸入框 */
  const firstErrorKey = useCallback(
    (errs: Record<string, string>) => rows.flatMap(r => fields.map(f => fieldKey(r.id, f))).find(k => k in errs),
    [rows, fields],
  );

  const setDraft = useCallback((variantId: string, field: QuickField, raw: string) => {
    const value = raw.replace(/\D/g, '');
    setDrafts(prev => ({ ...prev, [variantId]: { ...prev[variantId], [field]: value } }));
    setUnsaved(false);
    // 第一次送出失敗之後，這個輸入框每次輸入就重新檢查，修好了訊息立刻消失（不做 blur 驗證）
    const key = fieldKey(variantId, field);
    setErrors(prev => {
      if (!(key in prev)) return prev;
      const row = rows.find(r => r.id === variantId);
      const msg = row ? fieldError(row, field, value) : null;
      if (msg) return { ...prev, [key]: msg };
      const { [key]: _gone, ...rest } = prev;
      return rest;
    });
  }, [rows]);

  const send = useCallback(async (changes: QuickChange[]) => {
    if (sending.current) return;
    sending.current = true;
    setPhase({ kind: 'saving' });
    setErrors({});
    setUnsaved(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    try {
      const res = await quickEditProduct(product.id, changes);
      if (res.outcome === 'ok') {
        onSaved({ result: res, changes });
      } else if (res.outcome === 'conflict') {
        pending.current = changes;
        snapshot.current = { variants: res.variants, status: res.status };
        setPhase({ kind: 'conflict', conflicts: res.conflicts, current: res.variants });
        requestFocus(FOCUS_CONFLICT);
      } else {
        const errs = invalidToErrors(res.errors);
        if (errs) {
          setErrors(errs);
          setPhase({ kind: 'editing' });
          const first = firstErrorKey(errs);
          if (first) requestFocus(first);
        } else {
          setPhase({ kind: 'failed', failure: 'server' });
          requestFocus(FOCUS_FAILED);
        }
      }
    } catch (e) {
      const kind = e instanceof QuickEditError ? e.kind : 'server';
      if (kind === 'not_found' || kind === 'variant_missing') onGone(kind);
      else { setPhase({ kind: 'failed', failure: kind }); requestFocus(FOCUS_FAILED); }
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      sending.current = false;
    }
  }, [quickEditProduct, product.id, onSaved, onGone, requestFocus, firstErrorKey]);

  const cancel = useCallback(() => {
    if (snapshot.current) syncProductSnapshot(product.id, snapshot.current.variants, snapshot.current.status);
    onClose();
  }, [syncProductSnapshot, product.id, onClose]);

  /** 按儲存或 Enter：先驗證、沒改動就當取消、大幅改價（這一組值還沒確認過）先確認，最後才送出 */
  const submit = useCallback(() => {
    if (sending.current || (phase.kind !== 'editing' && phase.kind !== 'failed')) return;
    const { errs, changes, big } = collectQuickEdit(rows, drafts, fields);
    setUnsaved(false);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const first = firstErrorKey(errs);
      if (first) requestFocus(first);
      return;
    }
    setErrors({});
    if (changes.length === 0) { cancel(); return; }
    if (needsConfirm(big, changesKey(changes), confirmedKey.current)) {
      setPhase({ kind: 'confirm', lines: big });
      requestFocus(FOCUS_CONFIRM);
      return;
    }
    void send(changes);
  }, [phase.kind, rows, drafts, fields, cancel, requestFocus, firstErrorKey, send]);

  const confirmSave = useCallback(() => {
    const { changes } = collectQuickEdit(rows, drafts, fields);
    confirmedKey.current = changesKey(changes);
    void send(changes);
  }, [rows, drafts, fields, send]);

  const backToEdit = useCallback(() => {
    confirmedKey.current = null;
    setPhase({ kind: 'editing' });
    const { big } = collectQuickEdit(rows, drafts, fields);
    const first = big[0];
    if (first) requestFocus(fieldKey(first.variantId, 'price'));
  }, [rows, drafts, fields, requestFocus]);

  /** 衝突後：把衝突的欄位換成資料庫目前的值，當成新的比對基準 */
  const adoptCurrent = useCallback((conflicts: QuickConflict[], current: Variant[]) => {
    setRows(prev => prev.map(r => {
      const cur = current.find(v => v.id === r.id);
      const seen = { ...r.seen };
      for (const c of conflicts) {
        if (c.variantId === r.id && (c.field === 'price' || c.field === 'stock') && typeof c.current === 'number') seen[c.field] = c.current;
      }
      return { ...r, seen, originalPrice: cur ? cur.originalPrice : r.originalPrice };
    }));
  }, []);

  const refill = useCallback(() => {
    if (phase.kind !== 'conflict') return;
    adoptCurrent(phase.conflicts, phase.current);
    setDrafts(prev => {
      const next = { ...prev };
      for (const c of phase.conflicts) {
        if ((c.field === 'price' || c.field === 'stock') && typeof c.current === 'number') {
          next[c.variantId] = { ...next[c.variantId], [c.field]: String(c.current) };
        }
      }
      return next;
    });
    setPhase({ kind: 'editing' });
    const first = phase.conflicts.find(c => c.field === 'price' || c.field === 'stock');
    if (first) requestFocus(fieldKey(first.variantId, first.field as QuickField));
    say('已帶入目前的值，請確認後再儲存');
  }, [phase, adoptCurrent, requestFocus, say]);

  const forceSave = useCallback(() => {
    if (phase.kind !== 'conflict') return;
    adoptCurrent(phase.conflicts, phase.current);
    const changes = pending.current.map(c => {
      const hit = phase.conflicts.find(x => x.variantId === c.variantId && x.field === c.field);
      return hit && typeof hit.current === 'number' ? { ...c, expected: hit.current } : c;
    });
    void send(changes);
  }, [phase, adoptCurrent, send]);

  const flagUnsaved = useCallback(() => setUnsaved(true), []);

  /** Esc：大幅改價確認時是「返回修改」（退一層），其餘是取消；送出中無效 */
  const onEscape = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (phase.kind === 'confirm') backToEdit();
    else cancel();
  }, [busy, phase.kind, backToEdit, cancel]);

  return {
    rows, drafts, errors, phase, slow, busy, dirty, unsaved, announce, focusReq, changedIds, conflictIds,
    setDraft, submit, confirmSave, backToEdit, refill, forceSave, flagUnsaved, onEscape, cancel,
  };
}
