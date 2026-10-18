/**
 * 給 supabase-js 呼叫加逾時：時間到就 abort（請求真的被取消，不像 withTimeout 只是不等了）。
 * 逾時後 run 丟出的錯誤（通常是 AbortError）吞掉、回 { value: null, timedOut: true }，由呼叫端決定怎麼說；
 * 沒逾時就丟出的錯誤照樣丟出去。
 */
export async function withAbortTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => PromiseLike<T>,
): Promise<{ value: T | null; timedOut: boolean }> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  try {
    const value = await run(ctl.signal);
    return { value, timedOut };
  } catch (e) {
    if (timedOut) return { value: null, timedOut: true };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
