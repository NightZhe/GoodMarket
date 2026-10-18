/**
 * 閘門換成頁面內容之後，把焦點移到頁面的 h1（R-9：登入成功後焦點不能落在 body）。沒有看得到的 h1（例如手機版購物車的 h1 是隱藏的）就移到 main。
 * 登入狀態要過一下才會讓頁面換掉，所以每 50ms 找一次，最多找 1 秒；閘門自己的步驟標題還在（data-step-title）時不算數。
 * 已經有別的東西搶到焦點（例如賣家的開店表單自己聚焦標題）就不再動。
 */
export function focusPageHeading(): void {
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const stillGate = document.querySelector('[data-step-title]');
    const h1 = [...document.querySelectorAll<HTMLElement>('h1')].find(h => h.getClientRects().length > 0);
    const target = h1 ?? document.querySelector<HTMLElement>('main');
    if (!stillGate && target) {
      clearInterval(timer);
      if (document.activeElement && document.activeElement !== document.body) return;
      if (!target.hasAttribute('tabindex')) { target.setAttribute('tabindex', '-1'); target.style.outline = 'none'; }
      target.focus({ preventScroll: true });
    } else if (tries >= 20) {
      clearInterval(timer);
    }
  }, 50);
}
