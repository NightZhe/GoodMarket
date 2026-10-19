/**
 * 讓一個可能永遠等不到回應的請求在時間到時放棄等待，回傳 onTimeout() 的值（請求本身取消不了，supabase-js 的 auth 呼叫不收 signal）。
 * 手機登入的傳送、驗證、綁定都要用：iPhone 4G 斷斷續續時，沒有逾時會讓按鈕卡在「傳送中…」而且按不了。
 */
export function raceTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    work.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}
