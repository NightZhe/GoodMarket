-- 原價從「整件商品一個」改成「每個規格各自一個」
-- 既有資料：依各規格售價等比例換算（維持原本的折扣幅度）
update public.products p
set variants = (
  select jsonb_agg(
    case
      when p.original_price is null then v
      else v || jsonb_build_object(
        'originalPrice',
        round((v->>'price')::numeric * p.original_price
              / (select min((x->>'price')::numeric) from jsonb_array_elements(p.variants) x))
      )
    end
  )
  from jsonb_array_elements(p.variants) v
)
where p.original_price is not null;

-- 欄位已無用途，移除避免日後誤用
alter table public.products drop column if exists original_price;

select title, variants from public.products order by created_at desc limit 2;
