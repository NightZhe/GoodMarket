import { Share } from '@capacitor/share';
import { nativePlatform } from './platform';

// 系統分享面板（decisions D-7b）：iOS 是 UIActivityViewController、Android 是分享 chooser。
// 只在 App 內由 BuyerLayout 動態載入；網頁版維持 Web Share API／複製連結。
// iOS 只給 url（標題當 subject）：UIActivityViewController 同時收到文字＋網址兩個項目時，部分 App 的分享延伸（例如 LINE）會失敗，
// 單一網址項目最穩，收到的人看到的是連結預覽。Android 的分享 chooser 只吃文字，外掛會把 text 與 url 接成一段。

export type NativeShareResult = 'shared' | 'cancelled' | 'unavailable';

export async function nativeShare(opts: { title: string; url: string }): Promise<NativeShareResult> {
  try {
    const ios = nativePlatform() === 'ios';
    await Share.share({ title: opts.title, ...(ios ? {} : { text: opts.title }), url: opts.url, dialogTitle: '分享' });
    return 'shared';
  } catch (e) {
    // 外掛在使用者關掉面板時 reject "Share canceled"；其他錯誤（對方 App 的分享延伸出錯、沒有可分享的 App）回 unavailable，由呼叫端提示
    return /cancel/i.test(e instanceof Error ? e.message : String(e)) ? 'cancelled' : 'unavailable';
  }
}
