// ESLint flat config。範圍只有 src/**/*.{ts,tsx}：
// supabase/functions 是 Deno、scripts/ 是一次性工具、android/ ios/ 是原生專案，都不 lint。
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'android/**', 'ios/**', 'supabase/**', 'scripts/**', '.work/**', '.claude/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // 與 tsc 的 noUnusedLocals 一致：`const { [k]: _gone, ...rest } = obj` 這種丟棄用的解構不算未使用
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // 暫時降級（2026-10-25）：這個檔同時被排隊中的 PR #9／#10／#11 改到，lint 的修正等它們合併後再開小 PR 清掉。
    // 目前的既有問題：useMemo(() => Date.now(), [products]) 被判「多列 products」，但那是刻意要在商品變動時重讀時鐘。
    files: ['src/pages/buyer/Home.tsx'],
    rules: { 'react-hooks/exhaustive-deps': 'warn' },
  },
);
