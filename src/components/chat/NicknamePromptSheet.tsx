import { useId, useRef, useState } from 'react';
import SheetShell from '../SheetShell';
import { btnOutline, btnPrimary } from '../import/ui';
import { FieldError, Spinner, bigBtn, fieldCls, helpCls, savingBtn } from '../account/ui';
import { toAccountError } from '../../lib/account/errors';
import { saveNickname } from '../../lib/account/profile';
import { NICKNAME_PROMPT_DESC, NICKNAME_PROMPT_TITLE } from '../../lib/chat/nicknamePrompt';
import { NICKNAME_ERROR, maskNickname, validateNickname } from '../../lib/reviews/nickname';
import { NICKNAME_MAX, NICKNAME_MIN } from '../../lib/reviews/types';

interface Props {
  /** 儲存成功（值已存進 profiles.nickname） */
  onSaved: (nickname: string) => void;
  /** 略過、Esc、點遮罩：呼叫端記住「不再問」並關閉 */
  onSkip: () => void;
}

/**
 * 顯示名稱邀請（D11、spec B5）：買家在聊聊送出第一則訊息成功後、還沒有顯示名稱時彈一次。
 * 標題「設個顯示名稱，賣家才認得你」＋說明＋輸入（規則同個人檔案的暱稱：validateNickname）＋「儲存」／「略過」。
 * 儲存走 set_my_nickname（同個人檔案頁）；規則不合由伺服器回 NICKNAME_INVALID 時顯示同一句錯誤。外殼是 SheetShell（手機抽屜／桌機置中對話框）
 */
export default function NicknamePromptSheet({ onSaved, onSkip }: Props) {
  const titleId = useId();
  const descId = useId();
  const inputId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverInvalid, setServerInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const check = validateNickname(input);
  const hasText = input.trim() !== '';
  const fieldError = (touched && hasText && !check.ok) || serverInvalid ? NICKNAME_ERROR : null;
  const canSave = hasText && check.ok && !saving;

  const change = (v: string) => {
    setInput(v);
    setServerInvalid(false);
    setSaveFailed(false);
  };

  const submit = async () => {
    if (saving) return;
    if (!hasText || !check.ok || !check.value) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    try {
      const next = await saveNickname(check.value);
      if (next) onSaved(next);
      else setSaveFailed(true);
    } catch (e) {
      const err = toAccountError(e);
      if (err.code === 'NICKNAME_INVALID') { setServerInvalid(true); inputRef.current?.focus(); }
      else setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetShell titleId={titleId} descId={descId} titleRef={titleRef} onClose={onSkip}>
      <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }} className="px-5 pb-4 pt-5">
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-headline font-semibold text-ink outline-none">{NICKNAME_PROMPT_TITLE}</h2>
        <p id={descId} className="mt-1 text-footnote text-muted">{NICKNAME_PROMPT_DESC}</p>

        <label htmlFor={inputId} className="sr-only">顯示名稱</label>
        <input
          id={inputId} ref={inputRef} type="text" value={input} placeholder="例如：小花貓" readOnly={saving}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${inputId}-help${fieldError ? ` ${inputId}-err` : ''}`}
          onChange={e => change(e.target.value)}
          onBlur={() => setTouched(true)}
          className={`${fieldCls(Boolean(fieldError))} mt-4`}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p id={`${inputId}-help`} className={`${helpCls} ${fieldError ? 'sr-only' : ''}`}>
              {hasText && check.ok && check.value
                ? <>評價頁會顯示為「<strong>{maskNickname(check.value)}</strong>」</>
                : <>{NICKNAME_MIN}–{NICKNAME_MAX} 個字，可用中英文、數字、_ 和 -。之後可在「我的 → 個人檔案」修改。</>}
            </p>
            <FieldError id={`${inputId}-err`}>{fieldError ?? undefined}</FieldError>
          </div>
          <span aria-hidden="true" className="mt-1 shrink-0 text-sm tabular-nums text-muted">{[...input.trim()].length} / {NICKNAME_MAX}</span>
        </div>

        {saveFailed && <p role="alert" className="mt-3 text-sm text-error-text">沒有儲存成功，請稍後再試；你填的名稱還在。</p>}
        <p role="status" className="sr-only">{saving ? '正在儲存顯示名稱' : ''}</p>

        <button
          type="submit" aria-disabled={!canSave || undefined} aria-busy={saving || undefined}
          className={`mt-4 ${saving ? savingBtn : canSave ? btnPrimary : btnOutline} ${bigBtn}`}
        >
          {saving && <Spinner />}
          {saving ? '儲存中…' : '儲存'}
        </button>
        <button type="button" onClick={onSkip} aria-disabled={saving || undefined} className={`mt-2 ${btnOutline} ${bigBtn}`}>略過</button>
      </form>
    </SheetShell>
  );
}
