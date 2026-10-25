// 「複製」：先用 navigator.clipboard，不行再退到隱藏 textarea ＋ execCommand（部分內建瀏覽器只支援後者）；
// 兩者都不行回傳 false，由呼叫端顯示失敗提示並請使用者長按選取（設計 6.3）。

interface CopyDeps {
  writeText?: (text: string) => Promise<void>;
  legacyCopy?: (text: string) => boolean;
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  // 移出畫面外；字級 16px 避免 iOS Safari 對焦時放大頁面
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

const browserWriteText = (): CopyDeps['writeText'] =>
  typeof navigator !== 'undefined' && navigator.clipboard?.writeText ? (t: string) => navigator.clipboard.writeText(t) : undefined;

export async function copyText(text: string, deps: CopyDeps = {}): Promise<boolean> {
  const write = 'writeText' in deps ? deps.writeText : browserWriteText();
  if (write) {
    try {
      await write(text);
      return true;
    } catch { /* 權限被拒或環境不支援：改用舊做法 */ }
  }
  return (deps.legacyCopy ?? legacyCopy)(text);
}
