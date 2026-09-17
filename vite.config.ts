import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base 用相對路徑，GitHub Pages 子路徑（/GoodMarket/）才能正確載入資源
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: '0.0.0.0' },
});
