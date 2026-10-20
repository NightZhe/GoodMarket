-- 刪帳號時同步向綠界刪卡（.work/account-payment-methods/spec-account-delete-cards.md 工單 B-1；decisions.md D33＝A＋C、D37＝A）
--
-- 前提：已套 20261019200000_ecpay_payments.sql（沒套會直接中止，不做任何事）。
-- 只做相容的新增，不改任何既有表、欄位、函式、權限：
--   · admin_revoke_account_begin(p_user)：管理刪卡的第一步（Edge Function payment-admin-revoke-account-cards 用 service role 呼叫）。
--       有付款或綁卡正在進行就拒絕、什麼都不改（D37＝A）；否則把這個帳號所有 active 的卡標成 revoking（從這一刻起不能再扣款，R-4），
--       回傳會員代號與每張卡（含 BindCardID，只給 Edge Function，不會出現在它的回應裡）。
--   · method_revoke_failed(p_id)：向綠界刪卡失敗時，revoke_failures 原子加 1（卡留在 revoking）。
--   · auth.users 的 before delete trigger（D33 的 C，安全網）：這個帳號還有任何 payment_methods 列，就不准刪除帳號，
--       擋住 Supabase 後台 Delete user、Auth Admin API 等繞過刪帳號流程的路徑。它自己不刪卡。
--       付款資料表不存在時（例如完整回滾後）直接放行，不會讓所有刪帳號都失敗。
-- 權限：三個函式只有 service_role 能執行（trigger 函式誰都不能直接呼叫），anon／authenticated 沒有權限；最後有自我檢查。
-- 可重複執行；整個檔案一個交易。回滾：.work/account-payment-methods/tools/pb/rollback-account-delete-cards.sql
begin;

do $$
begin
  if to_regclass('public.payment_methods') is null or to_regclass('public.payment_members') is null then
    raise exception '請先套 20261019200000_ecpay_payments.sql（找不到 payment_methods／payment_members），整個交易回滾';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 管理刪卡：開始（D37 檢查＋全部標成 revoking）
-- ═══════════════════════════════════════════════════════════════════════
-- 回傳 {ok:false, code, message, retryAfter} 時什麼都沒改；{ok:true, memberId, cards:[{id,bindCardId,card6,card4,statusBefore,revokeFailures}]}。
-- 「進行中的綁卡」＝ created／confirming 且開始不到 35 分鐘（綁卡驗證碼的有效期，bindFlow.ts BIND_TOKEN_TTL_MS）。
--   更舊的那種綁卡已經不可能再綁出新卡；就算當年綁出了本站不知道的卡，也會在反查綠界清單時當成孤兒卡一起刪。
create or replace function public.admin_revoke_account_begin(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_member text; v_until timestamptz; v_cards jsonb;
begin
  if not exists (select 1 from auth.users where id = p_user) then
    return jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND', 'message', '找不到這個帳號', 'retryAfter', null);
  end if;
  -- 鎖住這個帳號的卡：同一個帳號同時只會有一個管理刪卡在動，也擋住同時進行的買家刪卡
  perform 1 from public.payment_methods where user_id = p_user for update;

  -- D37＝A：付款確認中／處理中
  if exists (select 1 from public.payment_groups where user_id = p_user and status in ('processing', 'confirming')) then
    select greatest(coalesce(max(lease_until), now()), now()) + interval '2 minutes' into v_until
      from public.payment_groups where user_id = p_user and status in ('processing', 'confirming');
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_IN_PROGRESS',
      'message', '這個帳號有付款正在處理或確認中，請等排程處理完再重試（預估時間僅供參考）', 'retryAfter', v_until);
  end if;
  -- D37＝A：還沒過期的待付款群組（最多 30 分鐘）
  select max(expires_at) into v_until from public.payment_groups where user_id = p_user and status = 'pending' and expires_at > now();
  if v_until is not null then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_IN_PROGRESS',
      'message', '這個帳號有待付款的訂單，請等它逾時作廢後再重試', 'retryAfter', v_until);
  end if;
  -- D37＝A：進行中的綁卡（最多 35 分鐘）
  select max(created_at) + interval '35 minutes' into v_until from public.ecpay_bind_attempts
   where user_id = p_user and status in ('created', 'confirming') and created_at > now() - interval '35 minutes';
  if v_until is not null then
    return jsonb_build_object('ok', false, 'code', 'BIND_IN_PROGRESS',
      'message', '這個帳號有綁卡正在進行，請等綁卡驗證碼過期後再重試', 'retryAfter', v_until);
  end if;

  select merchant_member_id into v_member from public.payment_members where user_id = p_user;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'bindCardId', m.bind_card_id, 'card6', m.card6, 'card4', m.card4,
                                               'statusBefore', m.status, 'revokeFailures', m.revoke_failures) order by m.created_at, m.id), '[]'::jsonb)
    into v_cards from public.payment_methods m where m.user_id = p_user;
  -- R-4：一進入刪卡步驟就全部不能扣款；之後刪卡失敗也不會變回 active（只有買家重新綁卡才會出現新的 active 列）
  update public.payment_methods set status = 'revoking', is_default = false, updated_at = now() where user_id = p_user and status = 'active';
  return jsonb_build_object('ok', true, 'memberId', v_member, 'cards', v_cards);
end $$;

-- 向綠界刪卡失敗：原子加 1（排程 payment-sweep 仍會在 revoke_failures < 20 時重試這張卡）
create or replace function public.method_revoke_failed(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.payment_methods set revoke_failures = revoke_failures + 1, updated_at = now() where id = p_id and status = 'revoking';
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_revoke_account_begin(uuid)', 'method_revoke_failed(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 安全網：還有綁卡的帳號不准刪（D33 的 C）
-- ═══════════════════════════════════════════════════════════════════════
-- security definer（擁有者 postgres）：從 Supabase 後台刪使用者時是 supabase_auth_admin 在刪，它沒有 payment_methods 的權限。
-- 用動態 SQL＋to_regclass：付款資料表被完整回滾刪掉後，這個 trigger 自動變成放行，不會讓所有刪帳號都失敗。
create or replace function public._auth_users_block_if_cards() returns trigger
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if to_regclass('public.payment_methods') is null then return old; end if;
  execute 'select count(*) from public.payment_methods where user_id = $1' into n using old.id;
  if n > 0 then
    raise exception '這個帳號還有 % 張綁定的信用卡（含撤銷中），不能直接刪除帳號：請走刪帳號流程，先向綠界刪卡', n
      using hint = 'HAS_PAYMENT_METHODS';
  end if;
  return old;
end $$;
revoke all on function public._auth_users_block_if_cards() from public, anon, authenticated;

drop trigger if exists auth_users_block_if_cards on auth.users;
create trigger auth_users_block_if_cards before delete on auth.users
  for each row execute function public._auth_users_block_if_cards();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 自我檢查：權限或 trigger 不如預期就整個回滾
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['admin_revoke_account_begin(uuid)', 'method_revoke_failed(uuid)', '_auth_users_block_if_cards()'] loop
      if has_function_privilege(r, 'public.' || t, 'execute') then
        raise exception '刪卡自我檢查失敗：% 可以執行 %，整個交易回滾', r, t;
      end if;
    end loop;
  end loop;
  foreach t in array array['admin_revoke_account_begin(uuid)', 'method_revoke_failed(uuid)'] loop
    if not has_function_privilege('service_role', 'public.' || t, 'execute') then
      raise exception '刪卡自我檢查失敗：service_role 不能執行 %，整個交易回滾', t;
    end if;
  end loop;
  foreach t in array array['admin_revoke_account_begin', 'method_revoke_failed', '_auth_users_block_if_cards'] loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = t) <> 1 then
      raise exception '刪卡自我檢查失敗：% 有多載，整個交易回滾', t;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'auth_users_block_if_cards'
                   and tgenabled = 'O' and not tgisinternal) then
    raise exception '刪卡自我檢查失敗：auth.users 上沒有啟用的 auth_users_block_if_cards trigger，整個交易回滾';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
