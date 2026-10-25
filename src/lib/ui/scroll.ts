/** 使用者系統設定了「減少動態效果」（同 PhotoLightbox 的判斷） */
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 整頁捲回最頂端；減少動態時瞬間跳轉，否則平滑捲動 */
export function scrollPageToTop() {
  window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}
