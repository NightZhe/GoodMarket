-- 賣家手動更新物流節點（不改訂單狀態，只往歷程追加一筆）
-- 只有該店店主能呼叫；節點代碼限定清單，避免寫入任意內容
create or replace function public.add_order_event(p_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_events jsonb;
begin
  if p_code not in ('handed_over', 'in_transit', 'out_for_delivery', 'arrived_store', 'picked_up') then
    raise exception '不支援的物流節點';
  end if;

  update public.orders o
  set events = coalesce(o.events, '[]'::jsonb)
               || jsonb_build_object('status', p_code, 'at', now(),
                                     'carrier', o.carrier, 'trackingNo', o.tracking_no)
  where o.id = p_id
    and exists (select 1 from public.shops s where s.id = o.shop_id and s.owner_id = auth.uid())
  returning o.events into v_events;

  if v_events is null then
    raise exception '找不到訂單，或你不是這家店的店主';
  end if;
  return v_events;
end $$;

grant execute on function public.add_order_event(uuid, text) to authenticated;
