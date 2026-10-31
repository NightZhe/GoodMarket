-- 聊聊身分（.work/partner-feedback-1031/spec.md 工單 B；決策 D4、D10、D12，使用者 2026-11-01 拍板）
--
-- 背景：賣家在聊聊列表與對話頁只看到「買家 31B3」（買家沒設暱稱時的 4 碼匿名碼），認不出是誰。
--       拍板不露帳號（email／登入 id），改讓賣家從「這條對話在問哪一件」認人，並把暱稱定位成公開的「顯示名稱」。
--
-- 全部是相容的新增（先套資料庫再推前端；舊前端忽略多出來的鍵）：
--   1. chat_list 回傳的每一列多一個 last_card：這條對話最近一則帶卡片的訊息的卡片摘要
--        { type: 'product'|'order', id, title, order_no }   （商品卡的 order_no 是 null；沒有任何卡片 → null）
--      其餘欄位、排序（last_message_at desc, id desc）、游標、p_limit 規則都不變。買家側與店家側都回。
--   2. 部分索引 chat_messages_card_idx (conversation_id, seq desc) where card is not null：給上面那個子查詢用，
--      一條對話只要往回找到第一則帶卡片的訊息就停。
--   3. profiles.nickname 的 comment 改正：它在聊聊對賣家全名顯示、評價頁遮罩顯示，不是「不公開顯示」。
--      欄位、檢查規則、set_my_nickname、RLS 都不動。

create index if not exists chat_messages_card_idx on public.chat_messages (conversation_id, seq desc) where card is not null;

-- 對話列表。p_side＝'buyer'（我當買家的對話；不含我隱藏的）｜'shop'（我的店的對話）。依最後一則時間新到舊。
--   p_cursor＝上一頁回的 next_cursor（{at, id}）；p_limit 預設 30、最多 50。
--   回傳 { items:[{conversation_id, counterpart, last_message:{side,mine,text,photo_count,card_type,at}, last_message_at,
--                  unread_count, blocked_by_me, last_card:{type,id,title,order_no}|null}], next_cursor }
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
           'blocked_by_me', public._chat_blocked_by_me(c, p_side),
           -- 最近一張卡的摘要（脈絡列用）：只取畫面要的四個鍵，不把整張快照（價格、金額、狀態）搬進列表
           'last_card', (select jsonb_build_object('type', k.card->>'type', 'id', k.card->>'id',
                                                   'title', coalesce(k.card->>'title', ''), 'order_no', k.card->>'order_no')
                           from public.chat_messages k
                          where k.conversation_id = c.id and k.card is not null
                          order by k.seq desc limit 1)
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
-- create or replace 保留既有的執行權（20261028231648_chat.sql 第 5 節：revoke from public、grant to anon, authenticated），這裡不再動權限。

-- 暱稱＝公開的「顯示名稱」（D12）：賣家在聊聊會看到完整名稱；評價頁遮罩顯示（_rv_mask）。規則不變：2～12 個字、只收中英文數字 _ -，可以沒有。
comment on column public.profiles.nickname is '顯示名稱（2～12 個字，可為 null）。賣家在聊聊會看到完整名稱；評價頁遮罩顯示。只能經 set_my_nickname 寫入。';
