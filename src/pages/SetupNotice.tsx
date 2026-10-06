/** 還沒設定 Supabase 金鑰時顯示，避免整站壞在看不懂的錯誤訊息上 */
export default function SetupNotice() {
  return (
    <div className="mx-auto max-w-xl px-6 py-20">
      <h1 className="text-xl font-bold">🛠️ 尚未連上後端</h1>
      <p className="mt-3 text-sm leading-7 text-muted">
        這個網站的商品與訂單存在 Supabase。請先設定環境變數再重新建置：
      </p>
      <pre className="mt-4 overflow-x-auto rounded-md bg-ink p-4 text-xs leading-6 text-white">
{`# 專案根目錄建立 .env
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
      </pre>
      <p className="mt-4 text-sm text-muted">
        金鑰在 Supabase 後台的 Project Settings → API。
        資料表與權限規則請先跑 <code className="rounded-sm bg-canvas px-1">supabase/schema.sql</code>。
      </p>
    </div>
  );
}
