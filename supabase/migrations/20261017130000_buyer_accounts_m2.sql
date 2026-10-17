-- 買家註冊登入 M2：收回權限（.work/buyer-auth/spec.md v0.2 第 9.3、13 節；decisions.md D4、D16）
--
-- 做兩件事，都是「收回」，所以照 CLAUDE.md 的例外規則：先推新前端，再套這個檔案。
--   1. place_order（舊的匿名下單）：沒登入一律回 NOT_AUTHENTICATED「請先登入再下單」（D4 資料庫層強制登入）。
--      簽名與回傳型別不變；登入的人仍可呼叫（寫 buyer_id、擋自購，同 M1）。
--      刻意「不」收回 anon 的 execute：留著讓舊前端的遊客得到中文錯誤，而不是英文的 permission denied。
--      擋下的位置在函式最前面，早於任何扣庫存、加已售數的動作，所以拒絕時資料完全不變。
--   2. 6 支憑證 RPC（D16 淘汰）：收回 PUBLIC、anon、authenticated 的 execute。
--        get_my_orders(jsonb)、cancel_my_order(uuid,text)、complete_my_order(uuid,text)、
--        get_my_review_status(jsonb)、request_review_upload(uuid,text,uuid,integer)、submit_reviews(uuid,text,text,jsonb)
--      函式本體保留（M3 才 drop），方便回滾：回滾指令見 .work/buyer-auth/tools/m2-rollback.sql。
--      收回後呼叫會得到 permission denied（42501，HTTP 403）。
--      注意 cancel_my_order、complete_my_order、get_my_orders 原本是開給 PUBLIC 的（proacl 有 =X），
--      所以一定要連 public 一起收；只 revoke anon、authenticated 是收不乾淨的。
--
-- 沒有動：orders 的欄位權限、帳號版 RPC、購物車、access_token 欄位（M3 才刪）。
-- 可重複執行（再套一次不會出錯、結果相同）。套用在 M3 之前；M3 之後不要再套（函式已不存在）。
-- 整個檔案包在一個交易裡：任何一步失敗就整個回滾，不會停在「收回一半」。

begin;

-- 1. place_order：匿名 → NOT_AUTHENTICATED
create or replace function public.place_order(p_items jsonb, p_buyer jsonb, p_payment text)
returns table(id uuid, access_token text, shop_id uuid, lines jsonb, shipping_fee integer, total integer, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid('請先登入再下單');   -- 沒登入（含 session 過期）→ 這裡就丟錯，後面一行都不會執行
begin
  return query
    select o.id, o.access_token, o.shop_id, o.lines, o.shipping_fee, o.total, o.created_at
      from public._place_order_core(p_items, p_buyer, p_payment, v_uid, false) o;
end $$;

-- 2. 6 支憑證 RPC：收回 execute
revoke execute on function public.get_my_orders(jsonb)                                   from public, anon, authenticated;
revoke execute on function public.cancel_my_order(uuid, text)                            from public, anon, authenticated;
revoke execute on function public.complete_my_order(uuid, text)                          from public, anon, authenticated;
revoke execute on function public.get_my_review_status(jsonb)                            from public, anon, authenticated;
revoke execute on function public.request_review_upload(uuid, text, uuid, integer)       from public, anon, authenticated;
revoke execute on function public.submit_reviews(uuid, text, text, jsonb)                from public, anon, authenticated;

-- 3. 自我檢查：收完之後，這 6 支對 anon、authenticated 都必須是「不能執行」；帳號版 8 支仍可執行。
do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.get_my_orders(jsonb)', 'public.cancel_my_order(uuid,text)', 'public.complete_my_order(uuid,text)',
    'public.get_my_review_status(jsonb)', 'public.request_review_upload(uuid,text,uuid,integer)',
    'public.submit_reviews(uuid,text,text,jsonb)'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception 'M2 自我檢查失敗：% 仍可執行 %，整個交易回滾', r, f;
      end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.place_account_order(jsonb,jsonb,text,boolean)', 'public.add_to_cart(uuid,text,integer)',
    'public.get_account_orders()', 'public.cancel_account_order(uuid)', 'public.complete_account_order(uuid)',
    'public.get_account_review_status()', 'public.request_account_review_upload(uuid,uuid,integer)',
    'public.submit_account_reviews(uuid,text,jsonb)', 'public.place_order(jsonb,jsonb,text)'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if not has_function_privilege(r, f, 'execute') then
        raise exception 'M2 自我檢查失敗：% 不能執行 %（不該被收回），整個交易回滾', r, f;
      end if;
    end loop;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
