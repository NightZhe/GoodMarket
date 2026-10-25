import { Share } from '@capacitor/share';

// 系統分享面板（decisions D-7b）：iOS 是 UIActivityViewController、Android 是分享 chooser。
// 只在 App 內由 BuyerLayout 動態載入；網頁版維持 Web Share API／複製連結。
// text 與 url 都給：iOS 分到訊息／LINE 時會是「標題＋連結」，Android 外掛把兩者接成一段文字。

export type NativeShareResult = 'shared' | 'cancelled' | 'unavailable';

export async function nativeShare(opts: { title: string; url: string }): Promise<NativeShareResult> {
  try {
    await Share.share({ title: opts.title, text: opts.title, url: opts.url, dialogTitle: '分享' });
    return 'shared';
  } catch (e) {
    // 外掛在使用者關掉面板時 reject "Share canceled"；其他錯誤（沒有可分享的 App）退回複製連結
    return /cancel/i.test(e instanceof Error ? e.message : String(e)) ? 'cancelled' : 'unavailable';
  }
}
