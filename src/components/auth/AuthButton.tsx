import { LoaderCircle } from 'lucide-react';
import { AppleLogo, GoogleLogo } from './brandLogos';

// 登入按鈕：兩顆同尺寸、同字級、同等顯眼（Google、Apple 兩家規範都要求）。
// 配色是使用者拍板的 D20（兩顆白底外框），順序是 D21（Apple 在上、Google 在下）；順序只要改 PROVIDER_ORDER。
// Google、Apple 的官方指定色只寫在這裡，不進 @theme（這是設計系統「不新增顏色」的例外，設計稿 10-1）。
//
// 排版（兩家官方規範）：
//   Google web：G 左側 12px、G 與文字之間 10px、文字右側 12px，G 20px。
//   Apple HIG：標誌檔高度＝按鈕高度（48px）、不裁切、不加垂直 padding、靠按鈕左側；標誌是黑色，所以用白底外框那一種。
//   兩顆的文字都從左側 42px 開始、靠左對齊（Google：12＋20＋10；Apple：標誌 34＋8），上下看起來是同一條線。
//   字級統一 18px：Google（35%）與 Apple（43%）規範的字級比例不同，同一張面板放兩顆要一樣大，取折衷（設計稿 2.3）。

export type AuthProvider = 'google' | 'apple';

export const PROVIDER_ORDER: AuthProvider[] = ['apple', 'google'];

const BUTTON_HEIGHT = 48;
const TEXT_START = 42;

// 外框用 ::after 畫在標誌上面（after:border-*）：Apple 標誌檔要跟按鈕一樣高，如果外框是按鈕本身的 border，
// 標誌會比內側高 2px、蓋住上下外框
const STYLE: Record<AuthProvider, string> = {
  google: 'after:border-[#747775] bg-white text-[#1f1f1f]',
  apple: 'after:border-black bg-white text-black',
};

const NAME: Record<AuthProvider, string> = { google: 'Google', apple: 'Apple' };

export type AuthButtonState = 'idle' | 'busy' | 'disabled';

const BASE = 'relative flex min-h-12 w-full items-center overflow-hidden rounded-sm py-2 pr-3 after:pointer-events-none after:absolute after:inset-0 after:rounded-sm after:border text-left text-lg font-medium leading-snug focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:opacity-80 aria-disabled:cursor-not-allowed';

export function AuthButton({ provider, state = 'idle', onClick }: { provider: AuthProvider; state?: AuthButtonState; onClick: () => void }) {
  const name = NAME[provider];
  const busy = state === 'busy';
  // aria-disabled 不用 disabled：iOS 上 disabled 的按鈕按了沒反應，讀屏也找不到它
  const inactive = state !== 'idle';
  const spinner = <LoaderCircle size={20} className="motion-safe:animate-spin" aria-hidden="true" />;
  return (
    <button
      type="button"
      aria-disabled={inactive || undefined}
      onClick={inactive ? undefined : onClick}
      style={{ paddingLeft: TEXT_START }}
      className={`${BASE} ${STYLE[provider]} ${state === 'disabled' ? 'opacity-50' : ''}`}
    >
      {/* 標誌放在文字起點左邊的固定位置；按鈕因文字換行變高時，標誌垂直置中 */}
      <span className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center" style={{ height: BUTTON_HEIGHT }}>
        {provider === 'google'
          ? <span className="ml-3 flex">{busy ? spinner : <GoogleLogo />}</span>
          : busy ? <span className="ml-3 flex">{spinner}</span> : <AppleLogo height={BUTTON_HEIGHT} />}
      </span>
      {busy ? (
        <span>前往 {name}…</span>
      ) : (
        // 縮放 200% 時換行落在「透過 X」與「繼續」之間，不會把「繼續」拆成兩半
        <span><span className="whitespace-nowrap">透過 {name}</span> <span className="whitespace-nowrap">繼續</span></span>
      )}
    </button>
  );
}

/** 兩顆按鈕＋讀屏用的狀態宣告。busy＝正在前往的那一顆，另一顆跟著停用。providers＝要顯示哪幾顆 */
export function AuthButtons({ busy, onSelect, providers = PROVIDER_ORDER }: {
  busy: AuthProvider | null; onSelect: (p: AuthProvider) => void; providers?: AuthProvider[];
}) {
  return (
    <div role="group" aria-label="選擇登入方式" className="flex flex-col gap-3">
      {PROVIDER_ORDER.filter(p => providers.includes(p)).map(p => (
        <AuthButton key={p} provider={p} state={busy === null ? 'idle' : busy === p ? 'busy' : 'disabled'} onClick={() => onSelect(p)} />
      ))}
      <p role="status" className="sr-only">{busy ? `正在前往 ${NAME[busy]} 登入` : ''}</p>
    </div>
  );
}

