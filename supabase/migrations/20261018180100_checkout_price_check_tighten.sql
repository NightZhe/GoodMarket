-- 結帳比價：收緊舊的下單函式（.work/checkout-price-check/spec.md v0.2 第 7.3 節第 6 步；decisions.md D-7g＝B）
--
-- 這是「收回」性質，跟 20261018180000_checkout_price_check.sql 上線時機不同：
--   要等新前端（呼叫 place_checked_order）已上線、使用者實機驗過之後，另給使用者清單確認才套用（runbook 最後一步）。
--
-- 做什麼：place_account_order 的內文改成一律回 CLIENT_OUTDATED「網站已更新，請重新整理頁面後再下單」。
--   · 不比價的舊前端分頁（GitHub Pages 已開著的分頁會一直跑舊版 JS）從此不能下單，改請買家重新整理（拿到新前端）。
--   · 簽名、回傳型別、權限都不變：刻意「不」revoke。理由：
--       1. 舊前端把 42501 歸類成登入失效（src/lib/account/errors.ts），會跳登入面板而不是請買家重新整理；
--          有 hint 的錯誤則直接顯示 message，所以舊前端會照實顯示這段中文。
--       2. buyer_accounts_m2 的自我檢查寫死 place_account_order(jsonb,jsonb,text,boolean) 要能被 anon、authenticated 執行。
--   · 連登入檢查都不做：沒登入的舊分頁也一樣請它重新整理（重新整理後新前端會自己處理登入）。
--   · 第一行就 raise，早於任何讀寫，所以沒有任何寫入。
--   · _place_order_core 不動（函式本體留著，還原時用；新函式不依賴它）。
--
-- 還原：.work/checkout-price-check/tools/rollback-tighten.sql（把內文還原成 20261017120000_buyer_accounts_m1.sql 的版本）。
-- 可重複執行。整個檔案包在一個交易裡。
begin;

create or replace function public.place_account_order(
  p_items jsonb, p_buyer jsonb, p_payment text, p_from_cart boolean default false
) returns setof public.buyer_order
language plpgsql security definer set search_path = public as $$
begin
  perform public._rv_raise('CLIENT_OUTDATED', '網站已更新，請重新整理頁面後再下單');
end $$;

-- 自我檢查：權限沒有被動到、新函式不受影響
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not has_function_privilege(r, 'public.place_account_order(jsonb,jsonb,text,boolean)', 'execute') then
      raise exception '收緊自我檢查失敗：% 不能執行 place_account_order（不該收回），整個交易回滾', r;
    end if;
    if not has_function_privilege(r, 'public.place_checked_order(jsonb,jsonb,text,boolean,jsonb)', 'execute') then
      raise exception '收緊自我檢查失敗：% 不能執行 place_checked_order（新函式要先套），整個交易回滾', r;
    end if;
  end loop;
  if pg_get_functiondef('public.place_account_order(jsonb,jsonb,text,boolean)'::regprocedure) not like '%CLIENT_OUTDATED%' then
    raise exception '收緊自我檢查失敗：place_account_order 的內文沒有換掉，整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
