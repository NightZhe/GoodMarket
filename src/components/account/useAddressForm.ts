import { useCallback, useRef, useState } from 'react';
import { validateAddress, type AddressDraft, type AddressErrors, type AddressField } from '../../lib/account/address';

export const FIELD_ORDER: readonly AddressField[] = ['recipient', 'phone', 'city', 'district', 'detail'];

/**
 * 地址表單的欄位值與錯誤。錯誤出現的時機（設計 6.4）：
 * - 離開欄位（blur）：只檢查「有字但不合規則」的欄位，空白不報；下拉不在 blur 檢查。blurValidate=false（結帳頁）時完全不做。
 * - 按儲存：validateAll 全部檢查。
 * - 欄位變合法：錯誤立刻消失，不等下一次送出。
 */
export function useAddressForm(initial: AddressDraft, blurValidate = true) {
  const [draft, setDraftState] = useState(initial);
  const [errors, setErrors] = useState<AddressErrors>({});
  const draftRef = useRef(draft);

  const change = useCallback((next: AddressDraft) => {
    draftRef.current = next;
    setDraftState(next);
    const now = validateAddress(next);
    setErrors(prev => {
      const kept: AddressErrors = {};
      for (const k of Object.keys(prev) as AddressField[]) if (now[k]) kept[k] = now[k];
      return kept;
    });
  }, []);

  /** 整份換掉（還原草稿、重置），並清掉所有錯誤 */
  const reset = useCallback((next: AddressDraft) => {
    draftRef.current = next;
    setDraftState(next);
    setErrors({});
  }, []);

  const blur = useCallback((field: AddressField) => {
    if (!blurValidate || field === 'city' || field === 'district') return;
    const d = draftRef.current;
    if (d[field].trim() === '') return;
    const message = validateAddress(d)[field];
    if (message) setErrors(prev => ({ ...prev, [field]: message }));
  }, [blurValidate]);

  const validateAll = useCallback((): AddressErrors => {
    const all = validateAddress(draftRef.current);
    setErrors(all);
    return all;
  }, []);

  const setFieldError = useCallback((field: AddressField, message: string) => {
    setErrors(prev => ({ ...prev, [field]: message }));
  }, []);

  return { draft, errors, change, reset, blur, validateAll, setFieldError };
}

/** 把焦點移到第一個有錯的欄位（念出標籤＋說明＋錯誤）；回傳是否找到 */
export function focusFirstError(errors: AddressErrors, idPrefix: string): boolean {
  const field = FIELD_ORDER.find(f => errors[f]);
  if (!field) return false;
  document.getElementById(`${idPrefix}-${field}`)?.focus();
  return true;
}
