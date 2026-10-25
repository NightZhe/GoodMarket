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
);
