-- 訂單追蹤：好記的訂單編號、物流方式與單號、狀態時間軸

alter table public.orders
  add column if not exists order_no    text,
  add column if not exists carrier     text,
  add column if not exists tracking_no text,
  add column if not exists events      jsonb not null default '[]'::jsonb;

-- 狀態只要變動就自動補一筆事件，不依賴前端記得寫，歷程不會有缺口
create or replace function public.track_order_event()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.order_no := to_char(now() at time zone 'Asia/Taipei', 'YYMMDD')
                    || upper(substr(replace(new.id::text, '-', ''), 1, 8));
    new.events := jsonb_build_array(jsonb_build_object('status', 'placed', 'at', now()));
  elsif new.status is distinct from old.status then
    new.events := coalesce(old.events, '[]'::jsonb) || jsonb_build_object(
      'status', new.status,
      'at', now(),
      'carrier', new.carrier,
      'trackingNo', new.tracking_no
    );
  end if;
  return new;
end $$;

drop trigger if exists orders_track_event on public.orders;
create trigger orders_track_event
  before insert or update on public.orders
  for each row execute function public.track_order_event();

-- 買家查單時一併帶回編號、物流與歷程（回傳欄位變了，必須先 drop）
drop function if exists public.get_my_orders(jsonb);
create or replace function public.get_my_orders(p_keys jsonb)
returns table (id uuid, order_no text, shop_id uuid, lines jsonb, shipping_fee integer, total integer,
               status text, payment text, carrier text, tracking_no text, events jsonb, created_at timestamptz)
language sql security definer set search_path = public as $$
  select o.id, o.order_no, o.shop_id, o.lines, o.shipping_fee, o.total, o.status, o.payment,
         o.carrier, o.tracking_no, o.events, o.created_at
  from public.orders o
  join jsonb_array_elements(p_keys) k on (k->>'id')::uuid = o.id and k->>'token' = o.access_token
  order by o.created_at desc;
$$;

grant execute on function public.get_my_orders(jsonb) to anon, authenticated;

-- 既有訂單補上編號與第一筆事件
update public.orders set
  order_no = coalesce(order_no, to_char(created_at at time zone 'Asia/Taipei', 'YYMMDD')
             || upper(substr(replace(id::text, '-', ''), 1, 8))),
  events = case when events = '[]'::jsonb
                then jsonb_build_array(jsonb_build_object('status', 'placed', 'at', created_at))
                else events end
where order_no is null or events = '[]'::jsonb;
