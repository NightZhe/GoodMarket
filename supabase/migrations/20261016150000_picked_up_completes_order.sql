-- 賣家按「買家已取貨」（picked_up）時，運送中的訂單自動轉成「已完成」。
--
-- 為什麼分兩次 UPDATE：orders 的 trigger（track_order_event）在 status 改變時，
-- 是用 old.events 去附加狀態事件。若同一個 UPDATE 既附加 picked_up、又改 status，
-- picked_up 會被 trigger 用 old.events 蓋掉。所以先單獨附加節點，再單獨改 status，
-- trigger 就會在含 picked_up 的 events 後面接上 completed。
-- 最終 events 依序：…, picked_up, completed（評價期限靠最後一筆 completed 的時間算）。
--
-- 另外（使用者拍板）：只有「運送中」（shipping）的訂單可以加物流節點，其他狀態一律拒絕，
-- 不寫入任何資料。店主檢查在前，非店主仍回原本的錯誤訊息。不動 RLS。
--
-- 再加（使用者拍板）：資料庫層鎖死 orders.status 的轉移，見下方 guard_order_status。
--
-- 相容性：函式簽名與回傳值（最新的 events jsonb 陣列）不變；其他節點行為不變；
-- 權限檢查（只有該訂單店鋪的店主）不變。create or replace 會保留既有的 grant。

-- ═══════════════════════════════════════════════════════════════════════
-- 訂單狀態轉移守門員：任何路徑（店主直接 UPDATE、SECURITY DEFINER 的 RPC、之後的物流 API、
-- 手動 SQL）改 orders.status 都要通過。允許：
--   to_ship  -> shipping    （確認出貨）
--   to_ship  -> cancelled   （取消）
--   shipping -> completed   （完成）
-- status 沒變的 UPDATE（只改 carrier／tracking_no／events 等）照常放行。其餘一律拒絕。
-- 原本的缺口：orders_update_own_shop 允許店主直接 UPDATE，買家取消後賣家停在舊畫面按
-- 「確認出貨」會把 cancelled 改回 shipping，而且沒有任何錯誤。
--
-- 觸發順序：同一時機的 BEFORE trigger 依名稱字母序執行。orders_guard_status 排在
-- orders_track_event 前面，所以被拒絕的轉移不會先被記進 events（反正整個陳述式也會 rollback）。
-- 通過守門後，track_order_event 照舊用 old.events 附加狀態事件。
-- 只掛 UPDATE（INSERT 的初始 status 由預設值與 CHECK 約束把關）。
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.guard_order_status()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_label constant jsonb := '{"to_ship":"待出貨","shipping":"運送中","completed":"已完成","cancelled":"已取消"}';
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if (old.status = 'to_ship'  and new.status in ('shipping', 'cancelled'))
     or (old.status = 'shipping' and new.status = 'completed') then
    return new;
  end if;

  raise exception '訂單狀態已變更（目前：%），無法改為%，請重新整理',
    coalesce(v_label->>old.status, old.status),
    coalesce(v_label->>new.status, new.status);
end $$;

revoke all on function public.guard_order_status() from public, anon, authenticated;

drop trigger if exists orders_guard_status on public.orders;
create trigger orders_guard_status
  before update on public.orders
  for each row execute function public.guard_order_status();


create or replace function public.add_order_event(p_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_events jsonb;
begin
  if p_code not in ('handed_over', 'in_transit', 'out_for_delivery', 'arrived_store', 'picked_up') then
    raise exception '不支援的物流節點';
  end if;

  -- 鎖住該列（同時做店主檢查），避免跟買家的 complete_my_order 並行時重複寫 completed
  select o.status into v_status
    from public.orders o
   where o.id = p_id
     and exists (select 1 from public.shops s where s.id = o.shop_id and s.owner_id = auth.uid())
   for update;

  if not found then
    raise exception '找不到訂單，或你不是這家店的店主';
  end if;

  if v_status <> 'shipping' then
    raise exception '只有運送中的訂單可以更新物流進度';
  end if;

  -- 1) 附加物流節點（不動 status，trigger 不會介入）
  update public.orders o
     set events = coalesce(o.events, '[]'::jsonb)
                  || jsonb_build_object('status', p_code, 'at', now(),
                                        'carrier', o.carrier, 'trackingNo', o.tracking_no)
   where o.id = p_id
  returning o.events into v_events;

  -- 2) 買家已取貨 → 轉已完成；trigger 會用含 picked_up 的 events 附加 completed
  if p_code = 'picked_up' then
    update public.orders o
       set status = 'completed'
     where o.id = p_id and o.status = 'shipping'
    returning o.events into v_events;
  end if;

  return v_events;
end $$;


-- ═══════════════════════════════════════════════════════════════════════
-- 既有資料修正（backfill）——可單獨執行
-- 把「狀態仍是運送中，但 events 已經有 picked_up」的訂單改成已完成。
-- 經由 orders 的 trigger 留下 completed 事件（時間＝執行當下，評價期限從此刻起算 30 天）。
-- 套用前先跑 .work/picked-up-complete/backfill-preview.sql 看會動到哪些單。
-- 重跑安全：改完後 status 不再是 shipping，第二次不會再選到。
-- ═══════════════════════════════════════════════════════════════════════
update public.orders
   set status = 'completed'
 where status = 'shipping'
   and exists (select 1 from jsonb_array_elements(coalesce(events, '[]'::jsonb)) e
                where e->>'status' = 'picked_up');
