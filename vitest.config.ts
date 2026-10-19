import { defineConfig } from 'vitest/config';

// 只跑 src 與 supabase/functions（Edge Function 的純邏輯，不依賴 Deno）底下、用自編小檔的單元測試。
// 用真實匯出檔的驗證放 .work/（不進版控），見 .work/shopee-import/。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
});
