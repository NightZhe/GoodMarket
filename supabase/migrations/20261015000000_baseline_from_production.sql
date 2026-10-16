-- 基準：2026-10-15 自正式站 hvecvwzpummmlsakxqbw 唯讀匯出（supabase db dump --linked，public schema）
-- 加上 storage bucket 與權限（取自 supabase/schema.sql，正式站目前的設定）
-- 往後的資料庫異動一律新增 migration，不再手改這份




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_order_event"("p_id" "uuid", "p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."add_order_event"("p_id" "uuid", "p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_my_order"("p_id" "uuid", "p_token" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.orders set status = 'cancelled'
  where id = p_id and access_token = p_token and status = 'to_ship';
$$;


ALTER FUNCTION "public"."cancel_my_order"("p_id" "uuid", "p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_my_order"("p_id" "uuid", "p_token" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.orders set status = 'completed'
  where id = p_id and access_token = p_token and status = 'shipping';
$$;


ALTER FUNCTION "public"."complete_my_order"("p_id" "uuid", "p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_orders"("p_keys" "jsonb") RETURNS TABLE("id" "uuid", "order_no" "text", "shop_id" "uuid", "lines" "jsonb", "shipping_fee" integer, "total" integer, "status" "text", "payment" "text", "carrier" "text", "tracking_no" "text", "events" "jsonb", "created_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select o.id, o.order_no, o.shop_id, o.lines, o.shipping_fee, o.total, o.status, o.payment,
         o.carrier, o.tracking_no, o.events, o.created_at
  from public.orders o
  join jsonb_array_elements(p_keys) k on (k->>'id')::uuid = o.id and k->>'token' = o.access_token
  order by o.created_at desc;
$$;


ALTER FUNCTION "public"."get_my_orders"("p_keys" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_order"("p_items" "jsonb", "p_buyer" "jsonb", "p_payment" "text") RETURNS TABLE("id" "uuid", "access_token" "text", "shop_id" "uuid", "lines" "jsonb", "shipping_fee" integer, "total" integer, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_item     jsonb;
  v_product  public.products%rowtype;
  v_variant  jsonb;
  v_idx      integer;
  v_qty      integer;
  -- 依商店分組的累積結果：{ "<shop_id>": { lines, subtotal, all_free } }
  v_groups   jsonb := '{}'::jsonb;
  v_group    jsonb;
  v_key      text;
  v_subtotal integer;
  v_shipping integer;
  v_order    public.orders%rowtype;
begin
  if p_payment not in ('cod', 'card', 'transfer') then
    raise exception '付款方式不正確';
  end if;
  if coalesce(p_buyer->>'name', '') = '' or coalesce(p_buyer->>'phone', '') = ''
     or coalesce(p_buyer->>'address', '') = '' then
    raise exception '收件資訊不完整';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception '沒有要結帳的商品';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));

    -- for update：鎖住這一列，同時間另一筆訂單要等這筆做完才能扣同一份庫存
    select * into v_product from public.products p
      where p.id = (v_item->>'productId')::uuid and p.status = 'active' for update;
    if not found then
      raise exception '商品不存在或已下架';
    end if;

    -- 找出這個規格在 variants 陣列裡的位置
    select ord - 1, value into v_idx, v_variant
      from jsonb_array_elements(v_product.variants) with ordinality as t(value, ord)
      where value->>'id' = v_item->>'variantId';
    if v_idx is null then
      raise exception '規格不存在';
    end if;
    if (v_variant->>'stock')::integer < v_qty then
      raise exception '「%」的庫存不足，只剩 % 件', v_product.title, (v_variant->>'stock')::integer;
    end if;

    -- 扣庫存、累加銷量
    update public.products p set
      variants = jsonb_set(p.variants, array[v_idx::text, 'stock'],
                           to_jsonb((v_variant->>'stock')::integer - v_qty)),
      sold = p.sold + v_qty
    where p.id = v_product.id;

    -- 累積到該商店的明細
    v_key := v_product.shop_id::text;
    v_group := coalesce(v_groups -> v_key,
                        jsonb_build_object('lines', '[]'::jsonb, 'subtotal', 0, 'all_free', true));
    v_groups := jsonb_set(v_groups, array[v_key], jsonb_build_object(
      'lines', (v_group -> 'lines') || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'variantId', v_variant->>'id',
        'title', v_product.title, 'variantName', v_variant->>'name',
        'image', coalesce(v_product.images->>0, ''),
        'price', (v_variant->>'price')::integer, 'qty', v_qty
      )),
      'subtotal', (v_group->>'subtotal')::integer + (v_variant->>'price')::integer * v_qty,
      'all_free', (v_group->>'all_free')::boolean and v_product.free_shipping
    ));
  end loop;

  -- 每家店開一張單：同店滿 499 免運，或該店這批商品都標免運
  for v_key, v_group in select key, value from jsonb_each(v_groups) loop
    v_subtotal := (v_group->>'subtotal')::integer;
    v_shipping := case when v_subtotal >= 499 or (v_group->>'all_free')::boolean then 0 else 60 end;

    insert into public.orders (shop_id, lines, shipping_fee, total, buyer_name, buyer_phone, buyer_address, payment)
    values (v_key::uuid, v_group -> 'lines', v_shipping, v_subtotal + v_shipping,
            p_buyer->>'name', p_buyer->>'phone', p_buyer->>'address', p_payment)
    returning * into v_order;

    id := v_order.id; access_token := v_order.access_token; shop_id := v_order.shop_id;
    lines := v_order.lines; shipping_fee := v_order.shipping_fee; total := v_order.total;
    created_at := v_order.created_at;
    return next;
  end loop;
end $$;


ALTER FUNCTION "public"."place_order"("p_items" "jsonb", "p_buyer" "jsonb", "p_payment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_order_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."track_order_event"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "access_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text") NOT NULL,
    "lines" "jsonb" NOT NULL,
    "shipping_fee" integer DEFAULT 0 NOT NULL,
    "total" integer NOT NULL,
    "status" "text" DEFAULT 'to_ship'::"text" NOT NULL,
    "buyer_name" "text" NOT NULL,
    "buyer_phone" "text" NOT NULL,
    "buyer_address" "text" NOT NULL,
    "payment" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "order_no" "text",
    "carrier" "text",
    "tracking_no" "text",
    "events" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "orders_payment_check" CHECK (("payment" = ANY (ARRAY['cod'::"text", 'card'::"text", 'transfer'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['to_ship'::"text", 'shipping'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "category_id" "text" NOT NULL,
    "images" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "variants" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sold" integer DEFAULT 0 NOT NULL,
    "rating" numeric(2,1) DEFAULT 5.0 NOT NULL,
    "location" "text" DEFAULT '臺北市'::"text" NOT NULL,
    "free_shipping" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "products_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'hidden'::"text"]))),
    CONSTRAINT "products_title_check" CHECK ((("char_length"("title") >= 5) AND ("char_length"("title") <= 60)))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid",
    "name" "text" NOT NULL,
    "avatar" "text" DEFAULT '🏪'::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "location" "text" DEFAULT '臺北市'::"text" NOT NULL,
    "rating" numeric(2,1) DEFAULT 5.0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shops_name_check" CHECK ((("char_length"("name") >= 2) AND ("char_length"("name") <= 20)))
);


ALTER TABLE "public"."shops" OWNER TO "postgres";


ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");



CREATE INDEX "orders_shop_idx" ON "public"."orders" USING "btree" ("shop_id");



CREATE INDEX "products_shop_idx" ON "public"."products" USING "btree" ("shop_id");



CREATE INDEX "products_status_idx" ON "public"."products" USING "btree" ("status");



CREATE UNIQUE INDEX "shops_owner_unique" ON "public"."shops" USING "btree" ("owner_id") WHERE ("owner_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "orders_track_event" BEFORE INSERT OR UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."track_order_event"();



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_read_own_shop" ON "public"."orders" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."shops" "s"
  WHERE (("s"."id" = "orders"."shop_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "orders_update_own_shop" ON "public"."orders" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."shops" "s"
  WHERE (("s"."id" = "orders"."shop_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."shops" "s"
  WHERE (("s"."id" = "orders"."shop_id") AND ("s"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_read" ON "public"."products" FOR SELECT USING ((("status" = 'active'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."shops" "s"
  WHERE (("s"."id" = "products"."shop_id") AND ("s"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "products_write_own" ON "public"."products" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."shops" "s"
  WHERE (("s"."id" = "products"."shop_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."shops" "s"
  WHERE (("s"."id" = "products"."shop_id") AND ("s"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."shops" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shops_insert_own" ON "public"."shops" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "shops_read" ON "public"."shops" FOR SELECT USING (true);



CREATE POLICY "shops_update_own" ON "public"."shops" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."add_order_event"("p_id" "uuid", "p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_order_event"("p_id" "uuid", "p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_order_event"("p_id" "uuid", "p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_my_order"("p_id" "uuid", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_my_order"("p_id" "uuid", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_my_order"("p_id" "uuid", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_my_order"("p_id" "uuid", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_my_order"("p_id" "uuid", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_my_order"("p_id" "uuid", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_orders"("p_keys" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_orders"("p_keys" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_orders"("p_keys" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."place_order"("p_items" "jsonb", "p_buyer" "jsonb", "p_payment" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."place_order"("p_items" "jsonb", "p_buyer" "jsonb", "p_payment" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."place_order"("p_items" "jsonb", "p_buyer" "jsonb", "p_payment" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."track_order_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."track_order_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."track_order_event"() TO "service_role";


















GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."shops" TO "anon";
GRANT ALL ON TABLE "public"."shops" TO "authenticated";
GRANT ALL ON TABLE "public"."shops" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




































-- ── storage（正式站現況） ──
-- ──────────────────────────── 商品圖片儲存 ────────────────────────────

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists product_images_write on storage.objects;
create policy product_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and owner = auth.uid());
