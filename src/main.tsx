import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// iOS Safari 只有在元素或祖先掛了 touch 監聽時才會觸發 :active（WebKit bug 138816），沒有這行按下狀態不會出現
document.addEventListener('touchstart', () => {}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
