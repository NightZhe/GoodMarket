import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './native.css';
import { isNative } from './lib/native/platform';

// 原生殼（iOS／Android App）才載入：安全區樣式、返回鍵、登入回跳監聽。網頁版這段不會執行
if (isNative()) void import('./lib/native/shell').then(m => m.initNativeShell());

// iOS Safari 只有在元素或祖先掛了 touch 監聽時才會觸發 :active（WebKit bug 138816），沒有這行按下狀態不會出現
document.addEventListener('touchstart', () => {}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
