import { useEffect, useState } from 'react';
import { fetchNickname } from './profile';

export type SavedNickname =
  | { state: 'loading' }
  /** nickname：null＝沒設；undefined＝讀取失敗，評價表單退回現況（Google 名稱或空白），不擋寫評價 */
  | { state: 'done'; nickname: string | null | undefined };

/** 評價表單預填用：讀一次個人檔案的暱稱。表單要等它回來才掛載，因為預填值只在表單建立時使用 */
export function useSavedNickname(): SavedNickname {
  const [result, setResult] = useState<SavedNickname>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    fetchNickname().then(
      nickname => { if (alive) setResult({ state: 'done', nickname }); },
      () => { if (alive) setResult({ state: 'done', nickname: undefined }); },
    );
    return () => { alive = false; };
  }, []);
  return result;
}
