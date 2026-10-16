// 匯入精靈共用的 class 字串（專案沒有 Button 元件，沿用既有按鈕的樣式與 token）
const base = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-sm px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export const btnPrimary = `${base} bg-brand text-white hover:bg-brand-dark aria-disabled:cursor-not-allowed aria-disabled:bg-disabled aria-disabled:hover:bg-disabled`;
export const btnOutline = `${base} border border-line bg-white text-ink hover:bg-canvas`;
export const btnPrimaryLg = `${btnPrimary} px-6 text-base`;
export const btnDangerText = `${base} border border-line bg-white text-error-text hover:bg-error-bg`;

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
