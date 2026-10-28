-- 聊聊：買家 ↔ 店家一對一訊息（.work/chat/spec.md v0.4，工單 CH-B1；decisions.md D1～D30、N1＝A、N2＝A、N3＝A）
--
-- 只做相容的新增：三張新表（chat_conversations、chat_messages、chat_upload_slots）、一個私有 Storage bucket（chat-images）、
-- 11 個 RPC、Realtime 廣播觸發器與 realtime.messages 的授權 policy。
-- 不動任何既有的表、欄位、權限、函式（R-M25）；舊前端不呼叫這些，所以先套資料庫、再推前端都安全（AC-M41）。
-- 只依賴 20261025122000 以前就存在的物件：shops／products／orders／profiles、_rv_raise、_rv_trim。
--
-- 設計重點（介面全文見 .work/chat/interface-chat.md）：
--   · 表對 anon、authenticated 零權限（連 select 都沒有），RLS 開著且不建 policy；前端只能經 RPC（SECURITY DEFINER）。
--   · 對話與訊息「不因帳號或店被刪而消失」（R-M20、N3）：對話指向 auth.users／shops 的外鍵是 ON DELETE SET NULL，
--     訊息的發訊者也是 SET NULL；對方為 null ＝ 「已刪除的帳號」／「已關閉的賣場」，伺服器拒送（CANNOT_SEND）。
--     訊息與對話本身不能被 DELETE（trigger 擋，連 service role 也擋）；唯一允許的 UPDATE 是外鍵把帳號 id 清成 null。
--   · 每條對話一個單調遞增的 seq（在對話列的鎖下配發）：訊息排序、分頁游標、已讀位置都用 seq，
--     不用時間戳（交易提交順序與時間戳順序不一致時，時間戳會漏算未讀）。
--   · 傳送者送出訊息 ＝ 該側已讀到最新（所以「有未讀」⇔ 最後一則是對方送的，且 last_seq > 我的已讀位置）。
--   · 封鎖記在對話上，買家側、店家側各一欄；任一欄有值，雙方都送不出（CANNOT_SEND）；只有設欄的那一側能解除。
--     封鎖狀態只回給封鎖方（blocked_by_me），被封鎖方的任何回傳都不含它（R-M17）。
--   · 錯誤格式沿用評價／物流：raise exception '<中文說明>' using hint = '<錯誤碼>'。
--   · Realtime：Broadcast from Database（realtime.send，private=true）到 conversation:<id> 與 user:<uid>，
--     只推 id，不推內容；realtime.messages 只有一條 SELECT policy（雙方才能訂閱），沒有 INSERT policy（客戶端不能自己廣播）。
--     廣播失敗一律吞掉（只留資料庫日誌），不影響訊息寫入。
-- 可重複執行。

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 資料表
-- ═══════════════════════════════════════════════════════════════════════

-- 對話：一個買家對一家店只有一條（唯一鍵）。買家與店在對話建立時一定存在、且買家不是店主（insert trigger 擋）；
-- 之後帳號或店被刪，外鍵把欄位清成 null（對話保留）。
create table if not exists public.chat_conversations (
  id                 uuid primary key default gen_random_uuid(),
  buyer_id           uuid references auth.users(id) on delete set null,
  shop_id            uuid references public.shops(id) on delete set null,
  created_at         timestamptz not null default now(),
  -- 最後一則的 seq（也就是這條對話目前有幾則）；每則訊息在對話列的鎖下 +1
  last_seq           bigint not null default 0,
  last_message_at    timestamptz,
  last_message_side  text,
  -- 列表摘要：{side, text(前 80 字), photo_count, card_type, at}
  last_message       jsonb,
  buyer_read_seq     bigint not null default 0,
  shop_read_seq      bigint not null default 0,
  buyer_hidden_at    timestamptz,
  buyer_blocked_at   timestamptz,
  shop_blocked_at    timestamptz,
  constraint chat_conversations_buyer_shop_key unique (buyer_id, shop_id),
  constraint chat_conversations_side_valid check (last_message_side is null or last_message_side in ('buyer', 'shop')),
  constraint chat_conversations_seq_valid  check (last_seq >= 0 and buyer_read_seq between 0 and last_seq and shop_read_seq between 0 and last_seq)
);
create index if not exists chat_conversations_buyer_idx on public.chat_conversations (buyer_id, last_message_at desc, id desc) where buyer_id is not null;
create index if not exists chat_conversations_shop_idx  on public.chat_conversations (shop_id, last_message_at desc, id desc) where shop_id is not null;

-- 訊息：不撤回、不編輯、不刪除（trigger 擋）。文字去前後空白後 1～1000 字（code point），空就存 null。
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id),
  seq             bigint not null,
  side            text not null,
  sender_id       uuid references auth.users(id) on delete set null,
  client_id       uuid not null,
  body            text,
  card            jsonb,
  photos          text[] not null default '{}',
  created_at      timestamptz not null default clock_timestamp(),
  constraint chat_messages_seq_key       unique (conversation_id, seq),
  constraint chat_messages_client_key    unique (conversation_id, client_id),
  constraint chat_messages_side_valid    check (side in ('buyer', 'shop')),
  constraint chat_messages_body_valid    check (body is null or char_length(body) between 1 and 1000),
  constraint chat_messages_card_valid    check (card is null or (jsonb_typeof(card) = 'object' and card->>'type' in ('product', 'order'))),
  constraint chat_messages_photos_valid  check (cardinality(photos) <= 5),
  constraint chat_messages_nonempty      check (body is not null or card is not null or cardinality(photos) > 0)
);
create index if not exists chat_messages_rate_idx   on public.chat_messages (sender_id, created_at desc) where sender_id is not null;
create index if not exists chat_messages_photos_idx on public.chat_messages using gin (photos);

-- 圖片上傳位置：路徑由伺服器配發（完全隨機），30 分鐘有效，用一次。綁呼叫者，不綁對話（買家側與店家側都用同一支）。
-- 帳號被刪時位置一起消失（沒有保留價值）；已送出的圖片檔留在 Storage，由訊息的 photos 指著。
create table if not exists public.chat_upload_slots (
  path       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chat_upload_slots_user_idx on public.chat_upload_slots (user_id, created_at desc);

-- 權限：三張表對前端完全不開放（連 select 都沒有）。RLS 開著且不建 policy，是第二道鎖。
alter table public.chat_conversations enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.chat_upload_slots  enable row level security;
revoke all on public.chat_conversations from public, anon, authenticated;
revoke all on public.chat_messages      from public, anon, authenticated;
revoke all on public.chat_upload_slots  from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 內部工具函式（不開放給前端）
-- ═══════════════════════════════════════════════════════════════════════

-- 登入的帳號 id；沒登入（遊客，或 session 過期而以 anon 身分執行）→ LOGIN_REQUIRED
create or replace function public._chat_uid()
returns uuid language plpgsql stable set search_path = public as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    perform public._rv_raise('LOGIN_REQUIRED', '請先登入');
  end if;
  return v;
end $$;
revoke all on function public._chat_uid() from public, anon, authenticated;

-- 這個使用者在這條對話是哪一側：buyer／shop／null（不是參與者）。店家側 ＝ 該店的店主。
create or replace function public._chat_side(c public.chat_conversations, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_uid is null then null
    when c.buyer_id = p_uid then 'buyer'
    when exists (select 1 from public.shops s where s.id = c.shop_id and s.owner_id = p_uid) then 'shop'
    else null
  end;
$$;
revoke all on function public._chat_side(public.chat_conversations, uuid) from public, anon, authenticated;

-- 封鎖是否生效（任一側封鎖都算）。訊息 trigger 與 chat_send 共用這一個判斷。
create or replace function public._chat_block_active(c public.chat_conversations)
returns boolean language sql immutable set search_path = public as $$
  select c.buyer_blocked_at is not null or c.shop_blocked_at is not null;
$$;
revoke all on function public._chat_block_active(public.chat_conversations) from public, anon, authenticated;

-- 取得對話並確認呼叫者是參與者（否則 NOT_PARTICIPANT；對話不存在也一樣，不洩漏存在與否）。p_lock＝鎖列。
create or replace function public._chat_participant(p_id uuid, p_uid uuid, p_lock boolean default false)
returns public.chat_conversations language plpgsql security definer set search_path = public as $$
declare
  c public.chat_conversations;
begin
  if p_lock then
    select * into c from public.chat_conversations where id = p_id for update;
  else
    select * into c from public.chat_conversations where id = p_id;
  end if;
  if not found or public._chat_side(c, p_uid) is null then
    perform public._rv_raise('NOT_PARTICIPANT', '找不到這個對話');
  end if;
  return c;
end $$;
revoke all on function public._chat_participant(uuid, uuid, boolean) from public, anon, authenticated;

-- 取得（或建立）買家對這家店的唯一一條對話。競態安全：靠唯一鍵，輸的一方等贏的一方提交後讀到同一列。
create or replace function public._chat_get_or_create_conv(p_buyer uuid, p_shop uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.chat_conversations (buyer_id, shop_id) values (p_buyer, p_shop)
    on conflict (buyer_id, shop_id) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.chat_conversations where buyer_id = p_buyer and shop_id = p_shop;
  end if;
  return v_id;
end $$;
revoke all on function public._chat_get_or_create_conv(uuid, uuid) from public, anon, authenticated;

-- 推 Realtime 事件。永遠不丟錯（沒有 realtime.send、沒有今天的分割區、權限不足都只留日誌）。
create or replace function public._chat_emit(p_topic text, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
exception when others then
  raise log 'chat_emit skipped (%): % %', p_topic, sqlstate, sqlerrm;
end $$;
revoke all on function public._chat_emit(text, text, jsonb) from public, anon, authenticated;

-- 訂單的店主是不是這個人
create or replace function public._chat_owns_shop(p_shop uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shops s where s.id = p_shop and s.owner_id = p_uid);
$$;
revoke all on function public._chat_owns_shop(uuid, uuid) from public, anon, authenticated;

-- ──────────────────────────── 卡片快照 ────────────────────────────

create or replace function public._chat_product_card(p public.products)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'type', 'product', 'id', p.id, 'title', p.title,
    'image', coalesce(p.images->>0, ''),
    'price', (select min((v->>'price')::integer) from jsonb_array_elements(p.variants) v where (v->>'price') ~ '^[0-9]{1,9}$'),
    'snapshot_at', now());
$$;
revoke all on function public._chat_product_card(public.products) from public, anon, authenticated;

create or replace function public._chat_order_card(o public.orders)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'type', 'order', 'id', o.id, 'order_no', o.order_no,
    'title', coalesce(o.lines->0->>'title', ''),
    'image', coalesce(o.lines->0->>'image', ''),
    'item_count', coalesce((select sum(case when (l->>'qty') ~ '^[0-9]{1,9}$' then greatest((l->>'qty')::integer, 1) else 1 end)
                              from jsonb_array_elements(case when jsonb_typeof(o.lines) = 'array' then o.lines else '[]'::jsonb end) l), 0),
    'total', o.total, 'status', o.status, 'snapshot_at', now());
$$;
revoke all on function public._chat_order_card(public.orders) from public, anon, authenticated;

-- 驗證並展開卡片：p_card＝{type:'product'|'order', id:<uuid>}；快照由伺服器依資料庫現況產生（客戶端無法偽造）。
--   商品卡：商品必須屬於 p_shop → PRODUCT_NOT_IN_SHOP。
--   訂單卡：訂單必須屬於 p_shop 與 p_buyer → 買家側 ORDER_NOT_YOURS／店家側 ORDER_NOT_YOUR_SHOP。
--   格式不合（不是物件、種類未知、缺 id、id 不是 uuid）→ CARD_INVALID。JSON null 視為沒有卡片。
create or replace function public._chat_resolve_card(p_card jsonb, p_side text, p_shop uuid, p_buyer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_id   uuid;
  v_prod public.products;
  v_ord  public.orders;
begin
  if p_card is null or jsonb_typeof(p_card) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_card) <> 'object' or jsonb_typeof(p_card->'type') is distinct from 'string'
     or jsonb_typeof(p_card->'id') is distinct from 'string'
     or (p_card->>'type') not in ('product', 'order')
     or (p_card->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform public._rv_raise('CARD_INVALID', '卡片資料有誤');
  end if;
  v_type := p_card->>'type';
  v_id   := (p_card->>'id')::uuid;
  if v_type = 'product' then
    select * into v_prod from public.products where id = v_id and shop_id = p_shop;
    if not found then
      perform public._rv_raise('PRODUCT_NOT_IN_SHOP', '這件商品不屬於這家店');
    end if;
    return public._chat_product_card(v_prod);
  end if;
  select * into v_ord from public.orders where id = v_id and shop_id = p_shop and buyer_id is not distinct from p_buyer and p_buyer is not null;
  if not found then
    if p_side = 'buyer' then
      perform public._rv_raise('ORDER_NOT_YOURS', '找不到這張訂單');
    end if;
    perform public._rv_raise('ORDER_NOT_YOUR_SHOP', '找不到這張訂單');
  end if;
  return public._chat_order_card(v_ord);
end $$;
revoke all on function public._chat_resolve_card(jsonb, text, uuid, uuid) from public, anon, authenticated;

-- ──────────────────────────── 回傳 JSON ────────────────────────────

-- 一則訊息給 p_my_side 那一側看。刻意不含 sender_id、對方已讀狀態。
create or replace function public._chat_msg_json(m public.chat_messages, p_my_side text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'conversation_id', m.conversation_id, 'seq', m.seq, 'side', m.side, 'mine', m.side = p_my_side,
    'client_id', m.client_id, 'text', m.body, 'card', m.card, 'photos', to_jsonb(m.photos), 'created_at', m.created_at);
$$;
revoke all on function public._chat_msg_json(public.chat_messages, text) from public, anon, authenticated;

-- 對方的顯示資訊（給 p_my_side 看）。
--   買家看到店：{kind:'shop', deleted, shop_id, name, avatar}；店不存在 → deleted=true、其餘 null（畫面顯示「已關閉的賣場」）。
--   店家看到買家：{kind:'buyer', deleted, nickname, short_code}；帳號不存在 → deleted=true（畫面顯示「已刪除的帳號」）。
--   short_code：同一買家對同一家店固定的 4 碼，供沒有暱稱時顯示「買家 ＋ 短碼」；由 (買家, 店) 雜湊而來，推不回帳號 id。
create or replace function public._chat_counterpart(c public.chat_conversations, p_my_side text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_shop public.shops;
  v_nick text;
begin
  if p_my_side = 'buyer' then
    select * into v_shop from public.shops where id = c.shop_id;
    if not found then
      return jsonb_build_object('kind', 'shop', 'deleted', true, 'shop_id', null, 'name', null, 'avatar', null);
    end if;
    return jsonb_build_object('kind', 'shop', 'deleted', false, 'shop_id', v_shop.id, 'name', v_shop.name, 'avatar', v_shop.avatar);
  end if;
  if c.buyer_id is null then
    return jsonb_build_object('kind', 'buyer', 'deleted', true, 'nickname', null, 'short_code', null);
  end if;
  select nickname into v_nick from public.profiles where user_id = c.buyer_id;
  return jsonb_build_object('kind', 'buyer', 'deleted', false, 'nickname', v_nick,
                            'short_code', upper(substr(md5(c.buyer_id::text || ':' || coalesce(c.shop_id::text, '')), 1, 4)));
end $$;
revoke all on function public._chat_counterpart(public.chat_conversations, text) from public, anon, authenticated;

-- 我（p_my_side）在這條對話封鎖了對方嗎。被封鎖方永遠得到 false（R-M17）。
create or replace function public._chat_blocked_by_me(c public.chat_conversations, p_my_side text)
returns boolean language sql immutable set search_path = public as $$
  select case p_my_side when 'buyer' then c.buyer_blocked_at is not null when 'shop' then c.shop_blocked_at is not null else false end;
$$;
revoke all on function public._chat_blocked_by_me(public.chat_conversations, text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 觸發器：不變條件在表層再擋一次（連 service role 直接寫入也擋）
-- ═══════════════════════════════════════════════════════════════════════

-- 對話建立：買家與店都要存在、店要有店主、買家不能是店主（不變條件 1）。
-- 對話更新：id／建立時間不可改；買家與店只能被外鍵清成 null；seq 與已讀位置只能前進。
create or replace function public._chat_conv_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    if new.buyer_id is null or new.shop_id is null then
      raise exception '資料有誤，請重新整理' using hint = 'BAD_ARGS';
    end if;
    select s.owner_id into v_owner from public.shops s where s.id = new.shop_id;
    if v_owner is null then
      raise exception '找不到這家店' using hint = 'SHOP_NOT_FOUND';
    end if;
    if v_owner = new.buyer_id then
      raise exception '不能跟自己的店聊聊' using hint = 'SHOP_IS_OWN';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception '對話的識別資料不能修改' using hint = 'CHAT_IMMUTABLE';
  end if;
  if (new.buyer_id is distinct from old.buyer_id and new.buyer_id is not null)
     or (new.shop_id is distinct from old.shop_id and new.shop_id is not null) then
    raise exception '對話的買家與店不能更換' using hint = 'CHAT_IMMUTABLE';
  end if;
  if new.last_seq < old.last_seq or new.buyer_read_seq < old.buyer_read_seq or new.shop_read_seq < old.shop_read_seq then
    raise exception '對話的序號與已讀位置不能倒退' using hint = 'CHAT_IMMUTABLE';
  end if;
  return new;
end $$;
revoke all on function public._chat_conv_guard() from public, anon, authenticated;

drop trigger if exists chat_conversations_guard on public.chat_conversations;
create trigger chat_conversations_guard before insert or update on public.chat_conversations
  for each row execute function public._chat_conv_guard();

create or replace function public._chat_conv_no_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '對話與訊息不能刪除' using hint = 'CHAT_IMMUTABLE';
end $$;
revoke all on function public._chat_conv_no_delete() from public, anon, authenticated;

drop trigger if exists chat_conversations_no_delete on public.chat_conversations;
create trigger chat_conversations_no_delete before delete on public.chat_conversations
  for each row execute function public._chat_conv_no_delete();
drop trigger if exists chat_messages_no_delete on public.chat_messages;
create trigger chat_messages_no_delete before delete on public.chat_messages
  for each row execute function public._chat_conv_no_delete();

-- 訊息寫入前（不論從哪條路徑寫入）：鎖對話列 → 封鎖中不能寫（不變條件 6）→ 雙方都要存在、發訊者必須是該側本人
-- → 配發 seq → 更新對話的摘要／最後一則／發訊者已讀位置，並取消買家的隱藏。
create or replace function public._chat_msg_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c        public.chat_conversations;
  v_owner  uuid;
  v_expect uuid;
begin
  select * into c from public.chat_conversations where id = new.conversation_id for update;
  if not found then
    raise exception '找不到這個對話' using hint = 'NOT_PARTICIPANT';
  end if;
  if public._chat_block_active(c) then
    raise exception '無法傳送' using hint = 'CANNOT_SEND';
  end if;
  select s.owner_id into v_owner from public.shops s where s.id = c.shop_id;
  if c.buyer_id is null or v_owner is null then
    raise exception '無法傳送' using hint = 'CANNOT_SEND';
  end if;
  v_expect := case new.side when 'buyer' then c.buyer_id else v_owner end;
  if new.sender_id is null or new.sender_id is distinct from v_expect then
    raise exception '找不到這個對話' using hint = 'NOT_PARTICIPANT';
  end if;

  new.seq := c.last_seq + 1;
  update public.chat_conversations set
    last_seq          = new.seq,
    last_message_at   = new.created_at,
    last_message_side = new.side,
    last_message      = jsonb_build_object('side', new.side, 'text', left(new.body, 80),
                                           'photo_count', cardinality(new.photos), 'card_type', new.card->>'type', 'at', new.created_at),
    buyer_read_seq    = case when new.side = 'buyer' then new.seq else buyer_read_seq end,
    shop_read_seq     = case when new.side = 'shop'  then new.seq else shop_read_seq  end,
    buyer_hidden_at   = null
  where id = c.id;
  return new;
end $$;
revoke all on function public._chat_msg_before() from public, anon, authenticated;

drop trigger if exists chat_messages_before on public.chat_messages;
create trigger chat_messages_before before insert on public.chat_messages
  for each row execute function public._chat_msg_before();

-- 訊息不可編輯；唯一允許的更新是外鍵把 sender_id 清成 null（帳號被刪）。
create or replace function public._chat_msg_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'sender_id') is distinct from (to_jsonb(old) - 'sender_id') or new.sender_id is not null then
    raise exception '訊息不能修改' using hint = 'CHAT_IMMUTABLE';
  end if;
  return new;
end $$;
revoke all on function public._chat_msg_immutable() from public, anon, authenticated;

drop trigger if exists chat_messages_immutable on public.chat_messages;
create trigger chat_messages_immutable before update on public.chat_messages
  for each row execute function public._chat_msg_immutable();

-- 訊息寫入後：推 Realtime 事件（只有 id，沒有內容）。conversation:<id> 給開著這條對話的人；
-- user:<uid> 給雙方各自的「未讀摘要變了」。失敗不影響寫入。
create or replace function public._chat_msg_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_buyer uuid;
  v_owner uuid;
  v_payload jsonb := jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'seq', new.seq);
begin
  begin
    select c.buyer_id, s.owner_id into v_buyer, v_owner
      from public.chat_conversations c left join public.shops s on s.id = c.shop_id where c.id = new.conversation_id;
    perform public._chat_emit('conversation:' || new.conversation_id::text, 'message', v_payload);
    if v_buyer is not null then perform public._chat_emit('user:' || v_buyer::text, 'summary', v_payload); end if;
    if v_owner is not null then perform public._chat_emit('user:' || v_owner::text, 'summary', v_payload); end if;
  exception when others then
    raise log 'chat_msg_after skipped for message %: % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public._chat_msg_after() from public, anon, authenticated;

drop trigger if exists chat_messages_after on public.chat_messages;
create trigger chat_messages_after after insert on public.chat_messages
  for each row execute function public._chat_msg_after();

-- 送出時消耗圖片位置（SLOT_INVALID 的唯一出口）：每個路徑都必須是「呼叫者本人申請的、還沒用過、還沒過期、檔案真的已經傳到
-- chat-images」的位置；通過就標已用。同一路徑在陣列裡出現兩次，第二次會看到已用 → SLOT_INVALID。回傳路徑陣列（依輸入順序）。
-- 呼叫者是 chat_send（同一交易）：之後任何一步失敗（頻率、寫入）整個交易回滾，位置不會被白白用掉。
create or replace function public._chat_use_slots(p_uid uuid, p_photos jsonb)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_paths text[] := '{}';
  v_el    jsonb;
  v_path  text;
  v_slot  public.chat_upload_slots;
begin
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    return v_paths;
  end if;
  for v_el in select value from jsonb_array_elements(p_photos) loop
    if jsonb_typeof(v_el) <> 'string' then
      perform public._rv_raise('SLOT_INVALID', '圖片上傳不完整，請重新上傳');
    end if;
    v_path := v_el #>> '{}';
    select * into v_slot from public.chat_upload_slots s where s.path = v_path and s.user_id = p_uid for update;
    if not found or v_slot.used_at is not null or v_slot.expires_at <= now() then
      perform public._rv_raise('SLOT_INVALID', '圖片上傳不完整，請重新上傳');
    end if;
    if not exists (select 1 from storage.objects so where so.bucket_id = 'chat-images' and so.name = v_path) then
      perform public._rv_raise('SLOT_INVALID', '圖片上傳不完整，請重新上傳');
    end if;
    update public.chat_upload_slots set used_at = now() where path = v_path;
    v_paths := v_paths || v_path;
  end loop;
  return v_paths;
end $$;
revoke all on function public._chat_use_slots(uuid, jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. RPC
-- ═══════════════════════════════════════════════════════════════════════

-- 買家進對話頁（從商品頁／店家頁／訂單進）。不建立對話。
--   回傳 { conversation_id (沒有對話就是 null), shop:{id,name,avatar}, counterpart_deleted:false, blocked_by_me, pending_card (沒帶就是 null) }
--   錯誤：LOGIN_REQUIRED、BAD_ARGS（同時帶商品與訂單）、SHOP_NOT_FOUND（店不存在或沒有店主）、SHOP_IS_OWN、
--         PRODUCT_NOT_IN_SHOP、ORDER_NOT_YOURS
create or replace function public.chat_open(p_shop_id uuid, p_product_id uuid default null, p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public._chat_uid();
  v_shop public.shops;
  v_c    public.chat_conversations;
  v_card jsonb;
begin
  if p_shop_id is null or (p_product_id is not null and p_order_id is not null) then
    perform public._rv_raise('BAD_ARGS', '資料有誤，請重新整理');
  end if;
  select * into v_shop from public.shops where id = p_shop_id;
  if not found or v_shop.owner_id is null then
    perform public._rv_raise('SHOP_NOT_FOUND', '找不到這家店');
  end if;
  if v_shop.owner_id = v_uid then
    perform public._rv_raise('SHOP_IS_OWN', '不能跟自己的店聊聊');
  end if;
  if p_product_id is not null then
    v_card := public._chat_resolve_card(jsonb_build_object('type', 'product', 'id', p_product_id), 'buyer', v_shop.id, v_uid);
  elsif p_order_id is not null then
    v_card := public._chat_resolve_card(jsonb_build_object('type', 'order', 'id', p_order_id), 'buyer', v_shop.id, v_uid);
  end if;
  select * into v_c from public.chat_conversations where buyer_id = v_uid and shop_id = v_shop.id;
  return jsonb_build_object(
    'conversation_id', v_c.id,
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name, 'avatar', v_shop.avatar),
    'counterpart_deleted', false,
    'blocked_by_me', coalesce(v_c.buyer_blocked_at is not null, false),
    'pending_card', v_card);
end $$;

-- 店主從訂單進對話頁（賣家唯一的發起入口）。不建立對話。
--   回傳 { conversation_id (沒有就是 null), buyer:{nickname, short_code}, counterpart_deleted (買家帳號已刪或是訪客訂單), blocked_by_me, order_card }
--   錯誤：LOGIN_REQUIRED、BAD_ARGS、ORDER_NOT_YOUR_SHOP（訂單不存在、不是自己店的、或呼叫者沒有店）
create or replace function public.chat_open_for_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public._chat_uid();
  v_order public.orders;
  v_c     public.chat_conversations;
  v_nick  text;
begin
  if p_order_id is null then
    perform public._rv_raise('BAD_ARGS', '資料有誤，請重新整理');
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found or not public._chat_owns_shop(v_order.shop_id, v_uid) then
    perform public._rv_raise('ORDER_NOT_YOUR_SHOP', '找不到這張訂單');
  end if;
  if v_order.buyer_id is not null then
    select * into v_c from public.chat_conversations where buyer_id = v_order.buyer_id and shop_id = v_order.shop_id;
    select nickname into v_nick from public.profiles where user_id = v_order.buyer_id;
  end if;
  return jsonb_build_object(
    'conversation_id', v_c.id,
    'buyer', jsonb_build_object('nickname', v_nick,
               'short_code', case when v_order.buyer_id is null then null
                                  else upper(substr(md5(v_order.buyer_id::text || ':' || v_order.shop_id::text), 1, 4)) end),
    'counterpart_deleted', v_order.buyer_id is null,
    'blocked_by_me', coalesce(v_c.shop_blocked_at is not null, false),
    'order_card', public._chat_order_card(v_order));
end $$;

-- 送出一則訊息。三個目標參數「恰好帶一個」（否則 BAD_ARGS）：
--   p_conversation_id：既有對話，呼叫者必須是參與者（NOT_PARTICIPANT）。
--   p_shop_id        ：買家側；對話不存在就建立（唯一鍵保證兩支裝置同時送也只有一條）；是自己的店 → SHOP_IS_OWN。
--   p_order_id       ：店家側；訂單必須屬於呼叫者的店（ORDER_NOT_YOUR_SHOP）；對象＝訂單買家；
--                      一律自動附該訂單卡，p_card 必須是空（否則 BAD_ARGS）。
-- 檢查順序：登入 → 參數形狀 → 目標與身分 → （既有對話：同 client_id 已存在就回那一則）→ 對方存在 → 封鎖 → 內容（文字、圖片數、卡片、
--           全空、圖片位置）→ 頻率。p_card＝{type:'product'|'order', id}；p_photos＝chat_request_upload 配發的路徑陣列。
-- 回傳該則訊息 jsonb（含 conversation_id；格式見 _chat_msg_json）。
create or replace function public.chat_send(
  p_client_id       uuid,
  p_conversation_id uuid default null,
  p_shop_id         uuid default null,
  p_order_id        uuid default null,
  p_text            text default null,
  p_card            jsonb default null,
  p_photos          jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := public._chat_uid();
  v_targets integer := (p_conversation_id is not null)::integer + (p_shop_id is not null)::integer + (p_order_id is not null)::integer;
  v_has_card boolean := p_card is not null and jsonb_typeof(p_card) <> 'null';
  v_c       public.chat_conversations;
  v_side    text;
  v_buyer   uuid;
  v_shop    uuid;
  v_owner   uuid;
  v_order   public.orders;
  v_prev    public.chat_messages;
  v_text    text;
  v_card    jsonb;
  v_nphotos integer := 0;
  v_paths   text[];
  v_msg     public.chat_messages;
begin
  -- 參數形狀
  if v_targets <> 1 or p_client_id is null or (p_order_id is not null and v_has_card)
     or (p_photos is not null and jsonb_typeof(p_photos) not in ('array', 'null')) then
    perform public._rv_raise('BAD_ARGS', '資料有誤，請重新整理');
  end if;

  -- 目標與身分
  if p_conversation_id is not null then
    v_c := public._chat_participant(p_conversation_id, v_uid);
    v_side := public._chat_side(v_c, v_uid);
    v_buyer := v_c.buyer_id; v_shop := v_c.shop_id;
  elsif p_shop_id is not null then
    select s.owner_id into v_owner from public.shops s where s.id = p_shop_id;
    if not found or v_owner is null then
      perform public._rv_raise('SHOP_NOT_FOUND', '找不到這家店');
    end if;
    if v_owner = v_uid then
      perform public._rv_raise('SHOP_IS_OWN', '不能跟自己的店聊聊');
    end if;
    v_side := 'buyer'; v_buyer := v_uid; v_shop := p_shop_id;
    select * into v_c from public.chat_conversations where buyer_id = v_buyer and shop_id = v_shop;
  else
    select * into v_order from public.orders where id = p_order_id;
    if not found or not public._chat_owns_shop(v_order.shop_id, v_uid) then
      perform public._rv_raise('ORDER_NOT_YOUR_SHOP', '找不到這張訂單');
    end if;
    if v_order.buyer_id = v_uid then
      perform public._rv_raise('SHOP_IS_OWN', '不能跟自己的店聊聊');
    end if;
    v_side := 'shop'; v_buyer := v_order.buyer_id; v_shop := v_order.shop_id;
    if v_buyer is not null then
      select * into v_c from public.chat_conversations where buyer_id = v_buyer and shop_id = v_shop;
    end if;
  end if;

  -- 冪等：既有對話裡同一個 client_id 已經有一則（自己送的）→ 回那一則，不再檢查、不再寫
  if v_c.id is not null then
    perform 1 from public.chat_conversations where id = v_c.id for update;
    select * into v_prev from public.chat_messages where conversation_id = v_c.id and client_id = p_client_id;
    if found then
      if v_prev.side <> v_side or v_prev.sender_id is distinct from v_uid then
        perform public._rv_raise('BAD_ARGS', '資料有誤，請重新整理');
      end if;
      return public._chat_msg_json(v_prev, v_side);
    end if;
    select * into v_c from public.chat_conversations where id = v_c.id;
  end if;

  -- 對方存在（買家帳號、店與店主都還在）
  if v_side = 'buyer' then
    select s.owner_id into v_owner from public.shops s where s.id = v_shop;
    if v_shop is null or v_owner is null then
      perform public._rv_raise('CANNOT_SEND', '無法傳送');
    end if;
  elsif v_buyer is null then
    perform public._rv_raise('CANNOT_SEND', '無法傳送');
  end if;

  -- 新對話：取得（或建立）唯一一條，鎖列後再看一次冪等（兩支裝置用同一個 client_id 同時送的情形）
  if v_c.id is null then
    v_c.id := public._chat_get_or_create_conv(v_buyer, v_shop);
    select * into v_c from public.chat_conversations where id = v_c.id for update;
    select * into v_prev from public.chat_messages where conversation_id = v_c.id and client_id = p_client_id;
    if found then
      if v_prev.side <> v_side or v_prev.sender_id is distinct from v_uid then
        perform public._rv_raise('BAD_ARGS', '資料有誤，請重新整理');
      end if;
      return public._chat_msg_json(v_prev, v_side);
    end if;
  end if;

  -- 封鎖（任一側封鎖，雙方都送不出；封鎖方與被封鎖方拿到同一個錯誤）
  if public._chat_block_active(v_c) then
    perform public._rv_raise('CANNOT_SEND', '無法傳送');
  end if;

  -- 內容
  v_text := nullif(public._rv_trim(coalesce(p_text, '')), '');
  if char_length(v_text) > 1000 then
    perform public._rv_raise('TEXT_TOO_LONG', '最多 1000 字');
  end if;
  if p_photos is not null and jsonb_typeof(p_photos) = 'array' then
    v_nphotos := jsonb_array_length(p_photos);
  end if;
  if v_nphotos > 5 then
    perform public._rv_raise('PHOTO_LIMIT', '圖片最多 5 張');
  end if;
  if p_order_id is not null then
    v_card := public._chat_order_card(v_order);
  else
    v_card := public._chat_resolve_card(p_card, v_side, v_shop, v_buyer);
  end if;
  if v_text is null and v_card is null and v_nphotos = 0 then
    perform public._rv_raise('EMPTY_MESSAGE', '請輸入內容');
  end if;
  v_paths := public._chat_use_slots(v_uid, p_photos);

  -- 頻率：每位使用者每分鐘最多 20 則（同一使用者的送出排隊，計數才不會被同時進來的請求一起看到 19）
  perform pg_advisory_xact_lock(hashtextextended('chat-rate:' || v_uid::text, 0));
  if (select count(*) from public.chat_messages m where m.sender_id = v_uid and m.created_at > clock_timestamp() - interval '1 minute') >= 20 then
    perform public._rv_raise('RATE_LIMITED', '送太快了，稍後再試');
  end if;

  insert into public.chat_messages (conversation_id, side, sender_id, client_id, body, card, photos)
  values (v_c.id, v_side, v_uid, p_client_id, v_text, v_card, v_paths)
  returning * into v_msg;
  return public._chat_msg_json(v_msg, v_side);
end $$;

-- 對話列表。p_side＝'buyer'（我當買家的對話；不含我隱藏的）｜'shop'（我的店的對話）。依最後一則時間新到舊。
--   p_cursor＝上一頁回的 next_cursor（{at, id}）；p_limit 預設 30、最多 50。
--   回傳 { items:[{conversation_id, counterpart, last_message:{side,mine,text,photo_count,card_type,at}, last_message_at, unread_count, blocked_by_me}], next_cursor }
create or replace function public.chat_list(p_side text, p_cursor jsonb default null, p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public._chat_uid();
  v_shop  uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_at    timestamptz;
  v_id    uuid;
  v_items jsonb;
  v_next  jsonb;
begin
  if p_side not in ('buyer', 'shop') then
    perform public._rv_raise('BAD_ARGS', '資料有誤，請重新整理');
  end if;
  if p_cursor is not null and jsonb_typeof(p_cursor) = 'object' then
    begin
      v_at := (p_cursor->>'at')::timestamptz; v_id := (p_cursor->>'id')::uuid;
    exception when others then
      perform public._rv_raise('BAD_ARGS', '資料有誤，請重新整理');
    end;
  end if;
  if p_side = 'shop' then
    select id into v_shop from public.shops where owner_id = v_uid;
    if v_shop is null then
      return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'conversation_id', c.id,
           'counterpart', public._chat_counterpart(c, p_side),
           'last_message', c.last_message || jsonb_build_object('mine', c.last_message_side = p_side),
           'last_message_at', c.last_message_at,
           'unread_count', (select count(*) from public.chat_messages m
                             where m.conversation_id = c.id and m.side <> p_side
                               and m.seq > case when p_side = 'buyer' then c.buyer_read_seq else c.shop_read_seq end),
           'blocked_by_me', public._chat_blocked_by_me(c, p_side)
         ) order by c.last_message_at desc, c.id desc), '[]'::jsonb)
    into v_items
    from (select * from public.chat_conversations x
           where x.last_message_at is not null
             and case when p_side = 'buyer' then x.buyer_id = v_uid and x.buyer_hidden_at is null else x.shop_id = v_shop end
             and (v_at is null or (x.last_message_at, x.id) < (v_at, v_id))
           order by x.last_message_at desc, x.id desc
           limit v_limit + 1) c;
  -- 多取的一筆只用來判斷還有沒有下一頁；游標＝本頁最後一筆
  if jsonb_array_length(v_items) > v_limit then
    v_items := v_items - v_limit;
    v_next := jsonb_build_object('at', v_items->(v_limit - 1)->>'last_message_at', 'id', v_items->(v_limit - 1)->>'conversation_id');
  end if;
  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end $$;

-- 讀一條對話的訊息（由新到舊分頁）。p_before＝已載入的最舊一則的 seq（不含）；p_limit 預設 30、最多 100。
--   回傳 { conversation:{id, side, counterpart, counterpart_deleted, blocked_by_me, last_seq}, messages:[新→舊], has_more }
--   刻意不含任何「對方已讀」資訊（R-M15），也不含被封鎖資訊（只有 blocked_by_me）。
create or replace function public.chat_messages(p_conversation_id uuid, p_before bigint default null, p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public._chat_uid();
  v_c     public.chat_conversations;
  v_side  text;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_msgs  jsonb;
  v_more  boolean;
begin
  v_c := public._chat_participant(p_conversation_id, v_uid);
  v_side := public._chat_side(v_c, v_uid);
  select coalesce(jsonb_agg(public._chat_msg_json(m, v_side) order by m.seq desc), '[]'::jsonb) into v_msgs
    from (select * from public.chat_messages x
           where x.conversation_id = v_c.id and (p_before is null or x.seq < p_before)
           order by x.seq desc limit v_limit + 1) m;
  v_more := jsonb_array_length(v_msgs) > v_limit;
  if v_more then
    v_msgs := v_msgs - v_limit;
  end if;
  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', v_c.id, 'side', v_side, 'counterpart', public._chat_counterpart(v_c, v_side),
      'counterpart_deleted', (public._chat_counterpart(v_c, v_side)->>'deleted')::boolean,
      'blocked_by_me', public._chat_blocked_by_me(v_c, v_side), 'last_seq', v_c.last_seq),
    'messages', v_msgs,
    'has_more', v_more);
end $$;

-- 已讀至最新。回 { conversation_id, read_seq }。有變動才推 user:<uid> 事件（讓我的其他裝置更新角標）。
create or replace function public.chat_mark_read(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public._chat_uid();
  v_c    public.chat_conversations;
  v_side text;
  v_old  bigint;
begin
  v_c := public._chat_participant(p_conversation_id, v_uid, true);
  v_side := public._chat_side(v_c, v_uid);
  v_old := case when v_side = 'buyer' then v_c.buyer_read_seq else v_c.shop_read_seq end;
  if v_old < v_c.last_seq then
    update public.chat_conversations
       set buyer_read_seq = case when v_side = 'buyer' then last_seq else buyer_read_seq end,
           shop_read_seq  = case when v_side = 'shop'  then last_seq else shop_read_seq  end
     where id = v_c.id;
    perform public._chat_emit('user:' || v_uid::text, 'summary', jsonb_build_object('conversation_id', v_c.id));
  end if;
  return jsonb_build_object('conversation_id', v_c.id, 'read_seq', v_c.last_seq);
end $$;

-- 未讀摘要（角標與總覽提示卡用）。
--   buyer_conversations：我當買家、有未讀的對話數（不含我隱藏的）
--   shop_conversations ：我的店、有未讀的對話數
--   shop_messages      ：我的店的未讀訊息總數
create or replace function public.chat_unread_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := public._chat_uid();
  v_shop uuid;
  v_bc   integer;
  v_sc   integer := 0;
  v_sm   bigint := 0;
begin
  select count(*) into v_bc
    from public.chat_conversations c
   where c.buyer_id = v_uid and c.buyer_hidden_at is null and c.last_seq > c.buyer_read_seq
     and exists (select 1 from public.chat_messages m where m.conversation_id = c.id and m.side = 'shop' and m.seq > c.buyer_read_seq);
  select id into v_shop from public.shops where owner_id = v_uid;
  if v_shop is not null then
    select count(*) filter (where u.n > 0), coalesce(sum(u.n), 0) into v_sc, v_sm
      from (select (select count(*) from public.chat_messages m where m.conversation_id = c.id and m.side = 'buyer' and m.seq > c.shop_read_seq) as n
              from public.chat_conversations c
             where c.shop_id = v_shop and c.last_seq > c.shop_read_seq) u;
  end if;
  return jsonb_build_object('buyer_conversations', v_bc, 'shop_conversations', v_sc, 'shop_messages', v_sm);
end $$;

-- 買家隱藏對話（只影響自己的列表；對方之後再傳、或自己再傳，就會回到列表）。隱藏當下視為已讀。
--   錯誤：NOT_PARTICIPANT、NOT_BUYER_SIDE（店家側不能隱藏）
create or replace function public.chat_hide(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._chat_uid();
  v_c   public.chat_conversations;
begin
  v_c := public._chat_participant(p_conversation_id, v_uid, true);
  if public._chat_side(v_c, v_uid) <> 'buyer' then
    perform public._rv_raise('NOT_BUYER_SIDE', '只有買家可以隱藏對話');
  end if;
  update public.chat_conversations set buyer_hidden_at = now(), buyer_read_seq = last_seq where id = v_c.id;
  perform public._chat_emit('user:' || v_uid::text, 'summary', jsonb_build_object('conversation_id', v_c.id));
  return jsonb_build_object('conversation_id', v_c.id, 'hidden', true);
end $$;

-- 封鎖／解除封鎖。封鎖記在呼叫者那一側；任一側有封鎖，雙方都送不出。冪等。
--   chat_block   → { conversation_id, blocked_by_me:true }
--   chat_unblock → { conversation_id, blocked_by_me:false }；呼叫者這一側沒有封鎖 → NOT_BLOCKER
create or replace function public.chat_block(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public._chat_uid();
  v_c    public.chat_conversations;
  v_side text;
begin
  v_c := public._chat_participant(p_conversation_id, v_uid, true);
  v_side := public._chat_side(v_c, v_uid);
  update public.chat_conversations
     set buyer_blocked_at = case when v_side = 'buyer' then coalesce(buyer_blocked_at, now()) else buyer_blocked_at end,
         shop_blocked_at  = case when v_side = 'shop'  then coalesce(shop_blocked_at, now())  else shop_blocked_at  end
   where id = v_c.id;
  return jsonb_build_object('conversation_id', v_c.id, 'blocked_by_me', true);
end $$;

create or replace function public.chat_unblock(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public._chat_uid();
  v_c    public.chat_conversations;
  v_side text;
begin
  v_c := public._chat_participant(p_conversation_id, v_uid, true);
  v_side := public._chat_side(v_c, v_uid);
  if not public._chat_blocked_by_me(v_c, v_side) then
    perform public._rv_raise('NOT_BLOCKER', '你沒有封鎖這個對話');
  end if;
  update public.chat_conversations
     set buyer_blocked_at = case when v_side = 'buyer' then null else buyer_blocked_at end,
         shop_blocked_at  = case when v_side = 'shop'  then null else shop_blocked_at  end
   where id = v_c.id;
  return jsonb_build_object('conversation_id', v_c.id, 'blocked_by_me', false);
end $$;

-- 申請圖片上傳位置：1～5 個，30 分鐘有效，綁呼叫者（買家側與店家側都用這一支）。
--   回傳 [{ path, expires_at }]；路徑是 <uuid>.jpg，直傳到 chat-images bucket 的根目錄。
--   錯誤：PHOTO_LIMIT（張數不在 1～5，或尚未使用的位置已累積 50 個——防止無限配發）
create or replace function public.chat_request_upload(p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._chat_uid();
  v_out jsonb;
begin
  if p_count is null or p_count not between 1 and 5 then
    perform public._rv_raise('PHOTO_LIMIT', '圖片最多 5 張');
  end if;
  -- 同一使用者的申請排隊，開放中的位置數才不會被同時進來的請求一起看到 49
  perform pg_advisory_xact_lock(hashtextextended('chat-slots:' || v_uid::text, 0));
  if (select count(*) from public.chat_upload_slots s where s.user_id = v_uid and s.used_at is null and s.expires_at > now()) + p_count > 50 then
    perform public._rv_raise('PHOTO_LIMIT', '圖片最多 5 張');
  end if;
  with ins as (
    insert into public.chat_upload_slots (path, user_id, expires_at)
    select gen_random_uuid()::text || '.jpg', v_uid, now() + interval '30 minutes' from generate_series(1, p_count)
    returning path, expires_at
  )
  select jsonb_agg(jsonb_build_object('path', ins.path, 'expires_at', ins.expires_at)) into v_out from ins;
  return v_out;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. 權限
-- ═══════════════════════════════════════════════════════════════════════
-- RPC 也開給 anon：未登入呼叫時要得到 LOGIN_REQUIRED，而不是英文的 permission denied（同評價／物流的做法）。
revoke all on function public.chat_open(uuid, uuid, uuid)                                         from public;
revoke all on function public.chat_open_for_order(uuid)                                           from public;
revoke all on function public.chat_send(uuid, uuid, uuid, uuid, text, jsonb, jsonb)              from public;
revoke all on function public.chat_list(text, jsonb, integer)                                     from public;
revoke all on function public.chat_messages(uuid, bigint, integer)                                from public;
revoke all on function public.chat_mark_read(uuid)                                                from public;
revoke all on function public.chat_unread_summary()                                               from public;
grant execute on function public.chat_open(uuid, uuid, uuid)                                      to anon, authenticated;
grant execute on function public.chat_open_for_order(uuid)                                        to anon, authenticated;
grant execute on function public.chat_send(uuid, uuid, uuid, uuid, text, jsonb, jsonb)           to anon, authenticated;
grant execute on function public.chat_list(text, jsonb, integer)                                  to anon, authenticated;
grant execute on function public.chat_messages(uuid, bigint, integer)                             to anon, authenticated;
grant execute on function public.chat_mark_read(uuid)                                             to anon, authenticated;
grant execute on function public.chat_unread_summary()                                            to anon, authenticated;
revoke all on function public.chat_hide(uuid)                                                    from public;
revoke all on function public.chat_block(uuid)                                                   from public;
revoke all on function public.chat_unblock(uuid)                                                 from public;
revoke all on function public.chat_request_upload(integer)                                       from public;
grant execute on function public.chat_hide(uuid)                                                 to anon, authenticated;
grant execute on function public.chat_block(uuid)                                                to anon, authenticated;
grant execute on function public.chat_unblock(uuid)                                              to anon, authenticated;
grant execute on function public.chat_request_upload(integer)                                    to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Storage：私有 bucket chat-images
-- ═══════════════════════════════════════════════════════════════════════
-- 私有（public=false）：沒有公開網址，讀取一律走簽名網址或登入下載，且要通過下面的 SELECT policy。
-- bucket 層級限制：只收 image/jpeg、單檔 5MB（5242880 bytes）。
-- 寫入（INSERT）：只有 authenticated，且路徑必須是自己申請、還沒用、還沒過期的位置。
-- 讀取（SELECT）：只有「某則訊息掛著這個路徑，而且呼叫者是那條對話的雙方之一」。尚未送出的圖片連上傳者本人也讀不到
--   （前端上傳前已有本機預覽）；刪帳號／刪店後，留下來的那一方仍讀得到（參與者判斷用對話列上還在的那一側）。
-- 不建 UPDATE、DELETE policy：已上傳的檔案不能被覆蓋、修改或刪除；刪除只走 Storage API（service role，清理腳本）。

create or replace function public._chat_slot_open(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_upload_slots s
     where s.path = p_path and s.user_id = auth.uid() and s.used_at is null and s.expires_at > now());
$$;
revoke all on function public._chat_slot_open(text) from public, anon;
grant execute on function public._chat_slot_open(text) to authenticated;

create or replace function public._chat_can_read_photo(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1
      from public.chat_messages m
      join public.chat_conversations c on c.id = m.conversation_id
     where m.photos @> array[p_path]
       and (c.buyer_id = auth.uid()
            or exists (select 1 from public.shops s where s.id = c.shop_id and s.owner_id = auth.uid())));
$$;
revoke all on function public._chat_can_read_photo(text) from public, anon;
grant execute on function public._chat_can_read_photo(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists chat_images_insert on storage.objects;
create policy chat_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and public._chat_slot_open(name));
drop policy if exists chat_images_select on storage.objects;
create policy chat_images_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and public._chat_can_read_photo(name));

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Realtime 授權：私有頻道 conversation:<對話 id>、user:<自己的 uid>
-- ═══════════════════════════════════════════════════════════════════════
-- 觸發器（見 _chat_msg_after）用 realtime.send(..., private := true) 廣播；客戶端必須以 private 頻道訂閱，
-- 加入時 Realtime 以訂閱者的身分評估 realtime.messages 的 SELECT policy（結果在該連線上快取到 JWT 更新為止）。
--   · conversation:<id>：只有該對話的買家與（現任）店主
--   · user:<uid>      ：只有本人
-- 不建 INSERT policy：客戶端不能自己廣播（也就偽造不了事件）。不 ALTER TABLE realtime.messages（RLS 已開、也不是我們的表）。
-- 注意：如果日後有人在 realtime.messages 加了 `using (true)` 之類的寬鬆 SELECT policy，會與本 policy 取聯集而失效 —— runbook 要核對。
create or replace function public._chat_can_listen(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null or p_topic is null then
    return false;
  end if;
  if p_topic = 'user:' || v_uid::text then
    return true;
  end if;
  if p_topic ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substr(p_topic, 14)::uuid;
    return exists (
      select 1 from public.chat_conversations c
       where c.id = v_id
         and (c.buyer_id = v_uid
              or exists (select 1 from public.shops s where s.id = c.shop_id and s.owner_id = v_uid)));
  end if;
  return false;
end $$;
revoke all on function public._chat_can_listen(text) from public, anon;
grant execute on function public._chat_can_listen(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    drop policy if exists chat_realtime_receive on realtime.messages;
    create policy chat_realtime_receive on realtime.messages for select to authenticated
      using (extension = 'broadcast' and public._chat_can_listen(realtime.topic()));
  end if;
end $$;
