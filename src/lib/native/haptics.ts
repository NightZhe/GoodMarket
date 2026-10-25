import { isNative } from './platform';

// 觸覺回饋（decisions D-7c）：只在 App 內動態載入外掛，網頁 bundle 不帶。
// 成功＝系統「成功」通知震動（加入購物車、快改儲存）；錯誤＝「錯誤」通知震動（下單失敗畫面）。
// 失敗一律吞掉：沒有震動元件的裝置、模擬器都不該影響流程。

export async function hapticSuccess(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Success });
  } catch { /* 裝置不支援就算了 */ }
}

export async function hapticError(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Error });
  } catch { /* 裝置不支援就算了 */ }
}
