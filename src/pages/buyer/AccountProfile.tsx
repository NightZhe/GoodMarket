import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleX } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import LoginRequired from '../../components/auth/LoginRequired';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import Identity from '../../components/account/Identity';
import { useRelogin, useRestoreFormDraft } from '../../components/account/useFormDraft';
import { Bone, FieldError, SubHeader, SubPage, Spinner, bigBtn, fieldCls, savingBtn, helpCls, labelCls, sectionTitleCls } from '../../components/account/ui';
import { DISPLAY_NAME_ERROR, nicknameDirty } from '../../lib/account/nickname';
import { fetchNickname, saveNickname } from '../../lib/account/profile';
import { toAccountError } from '../../lib/account/errors';
import { loginProviderOf, providerLabel } from '../../lib/auth/identity';
import { maskNickname, validateNickname } from '../../lib/reviews/nickname';
import { NICKNAME_MAX, NICKNAME_MIN } from '../../lib/reviews/types';
import { useOnline } from '../../lib/useOnline';

/** 個人檔案 #/account/profile（S-12）。暱稱欄位對使用者叫「顯示名稱」（D12：賣家在聊聊看全名、評價頁遮罩）。sticky：登入在填寫途中過期時，頁面不被換掉，輸入不消失（R-A16） */
export default function AccountProfile() {
  return (
    <LoginRequired kind="account" sticky>
      <ProfileView />
    </LoginRequired>
  );
}

type Load = 'loading' | 'ready' | 'error';

function ProfileView() {
  const { user } = useStore();
  const toast = useToast();
  const online = useOnline();
  const relogin = useRelogin();
  const inputRef = useRef<HTMLInputElement>(null);

  const [load, setLoad] = useState<Load>('loading');
  const [saved, setSaved] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const edited = useRef(false);
  const [touched, setTouched] = useState(false);
  const [serverInvalid, setServerInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const read = useCallback(async () => {
    // 明確離線：不必等讀取逾時（supabase-js 會自己重試好幾秒），直接進失敗狀態；連線回來時自動重讀
    if (navigator.onLine === false) { setLoad('error'); return; }
    setLoad('loading');
    try {
      const nickname = await fetchNickname();
      setSaved(nickname);
      if (!edited.current) setInput(nickname ?? '');
      setLoad('ready');
    } catch {
      setLoad('error');
    }
  }, []);

  useEffect(() => { void read(); }, [read]);
  const loadRef = useRef<Load>(load);
  loadRef.current = load;
  useEffect(() => { if (online && loadRef.current === 'error') void read(); }, [online, read]);

  useRestoreFormDraft('profile', d => {
    if (d.kind !== 'profile') return;
    edited.current = true;
    setInput(d.nickname);
    setReauth(true);
  });

  const check = validateNickname(input);
  const hasText = input.trim() !== '';
  const fieldError = (touched && hasText && !check.ok) || serverInvalid ? DISPLAY_NAME_ERROR : null;
  const dirty = nicknameDirty(input, saved);
  const readOnly = saving || !online;
  const canSave = dirty && online && !saving && load === 'ready';
  const provider = user ? loginProviderOf(user) : 'other';

  const change = (v: string) => {
    edited.current = true;
    setInput(v);
    setServerInvalid(false);
    setSaveFailed(false);
  };

  const clear = () => {
    change('');
    inputRef.current?.focus();
  };

  const submit = async () => {
    if (!canSave) return;
    if (!check.ok) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    if (!user) { relogin({ kind: 'profile', nickname: input }); return; }
    setSaving(true);
    setSaveFailed(false);
    setReauth(false);
    try {
      const next = await saveNickname(check.value);
      setSaved(next);
      setInput(next ?? '');
      edited.current = false;
      setTouched(false);
      toast(next ? '已儲存顯示名稱' : '已清除顯示名稱');
    } catch (e) {
      const err = toAccountError(e);
      if (err.kind === 'auth') relogin({ kind: 'profile', nickname: input });
      else if (err.code === 'NICKNAME_INVALID') { setServerInvalid(true); inputRef.current?.focus(); }
      else setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const retryRead = async () => {
    setRetrying(true);
    await read();
    setRetrying(false);
  };

  const preview = hasText && check.ok && check.value
    ? <>評價公開時顯示為「<strong>{maskNickname(check.value)}</strong>」</>
    : provider === 'google' ? '沒設定的話，寫評價時會預填你的 Google 名稱。' : '沒設定的話，寫評價時要自己填。';

  return (
    <SubPage>
      <SubHeader to="/account" backLabel="回到我的帳號" title="個人檔案" />

      {reauth && (
        <div className="mt-2 md:mt-3">
          <Banner kind="info" role="status" title="已重新登入" actions={<button type="button" className={btnOutline} onClick={() => setReauth(false)}>知道了</button>}>
            你填的顯示名稱還在，請再按一次儲存。
          </Banner>
        </div>
      )}

      <h2 className={sectionTitleCls}>登入方式</h2>
      <section className="bg-white rounded-card">
        <div className="px-4 py-4 md:px-6">{user && <Identity user={user} />}</div>
        <p className="border-t border-line px-4 py-3 text-sm text-muted md:px-6">
          登入方式與帳號由 {provider === 'google' || provider === 'apple' ? providerLabel(provider) : '登入服務'} 管理，這裡不能修改。
        </p>
      </section>

      <h2 className={sectionTitleCls}>個人資料</h2>
      <section className="bg-white p-4 rounded-card md:p-6" aria-busy={load === 'loading' || undefined}>
        {load === 'loading' && (
          <div>
            <p role="status" className="sr-only">載入中</p>
            <Bone className="h-4 w-16" />
            <Bone className="mt-2 h-3 w-full" />
            <Bone className="mt-1.5 h-3 w-2/3" />
            <Bone className="mt-3 h-12 w-full" />
          </div>
        )}

        {load === 'error' && (
          <Banner
            kind="error" title="讀不到你的顯示名稱"
            actions={<button type="button" className={btnOutline} aria-disabled={retrying || undefined} onClick={() => { if (!retrying) void retryRead(); }}>{retrying ? '重試中…' : '重試'}</button>}
          >
            請檢查網路後再試一次。
          </Banner>
        )}

        {load === 'ready' && (
          <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }}>
            {!online && (
              <div className="mb-4">
                <Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能修改顯示名稱。</Banner>
              </div>
            )}
            <label htmlFor="nick" className={labelCls}>顯示名稱<span className="font-normal text-muted">（選填）</span></label>
            <p id="nick-help" className={helpCls}>
              {NICKNAME_MIN}–{NICKNAME_MAX} 個字，可用中英文、數字、_ 和 -。賣家在聊聊會看到這個名稱；評價頁會遮罩顯示。寫評價時也會先幫你填好。
            </p>
            <div className="relative mt-2">
              <input
                id="nick" ref={inputRef} type="text" value={input} placeholder="未設定（例如：小花貓）" readOnly={readOnly}
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={`nick-help nick-preview${fieldError ? ' nick-err' : ''}`}
                onChange={e => change(e.target.value)}
                onBlur={() => setTouched(true)}
                className={`${fieldCls(Boolean(fieldError))} pr-12`}
              />
              {input !== '' && !readOnly && (
                <button
                  type="button" aria-label="清空顯示名稱" onClick={clear}
                  className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                >
                  <CircleX size={20} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="mt-1 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <p id="nick-preview" className={fieldError ? 'sr-only' : ''}>{preview}</p>
                <FieldError id="nick-err">{fieldError ?? undefined}</FieldError>
              </div>
              <span aria-hidden="true" className="shrink-0 tabular-nums text-muted">{[...input.trim()].length} / {NICKNAME_MAX}</span>
            </div>

            {saveFailed && (
              <div className="mt-4">
                <Banner kind="error" title="沒有儲存成功">請檢查網路後再試一次，你填的顯示名稱還在。</Banner>
              </div>
            )}

            <p role="status" className="sr-only">{saving ? '正在儲存顯示名稱' : ''}</p>
            <button
              type="submit" aria-disabled={!canSave || undefined} aria-busy={saving || undefined}
              className={`mt-4 ${saving ? savingBtn : canSave ? btnPrimary : btnOutline} ${bigBtn}`}
            >
              {saving && <Spinner />}
              {saving ? '儲存中…' : '儲存'}
            </button>
          </form>
        )}
      </section>
    </SubPage>
  );
}
