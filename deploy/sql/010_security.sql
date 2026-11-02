-- Replaces every Row Level Security policy and table grant restored from Supabase.
--
-- Supabase let the anonymous role read customers, orders and admin passwords, and change
-- products, prices and orders, because the admin pages never signed in. On the VPS the
-- admin pages sign in as admin_user, so everything below starts from "no access" and only
-- opens what the storefront actually uses.
--
-- Roles (switched to by PostgREST from the JWT the app signs):
--   anon           visitor, not signed in
--   authenticated  signed-in customer; auth.uid() is their auth.users id
--   admin_user     master admin or subadmin, signed in through /login
--
-- Safe to run more than once.

begin;

do $$ begin
  if not exists (select from pg_roles where rolname = 'admin_user') then
    create role admin_user nologin;
  end if;
end $$;
grant admin_user to authenticator;

grant usage on schema public to anon, authenticated, admin_user;
grant usage on schema auth to anon, authenticated, admin_user;
grant execute on function auth.uid(), auth.role(), auth.jwt(), auth.email() to anon, authenticated, admin_user;

-- New tables and functions must not become public by default the way they did on Supabase.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;

-- Start from nothing: drop every restored policy, revoke every grant, turn RLS on everywhere,
-- and give admins full access to every table.
do $$
declare
  p record;
  t record;
begin
  for p in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;

  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon, authenticated, public', t.tablename);
    execute format('grant all on public.%I to admin_user', t.tablename);
    execute format('create policy admin_all on public.%I for all to admin_user using (true) with check (true)', t.tablename);
  end loop;
end $$;

revoke all on all sequences in schema public from anon, authenticated, public;
grant usage, select on all sequences in schema public to authenticated, admin_user;

revoke all on public.product_reviews_summary from anon, authenticated, public;
grant select on public.product_reviews_summary to anon, authenticated, admin_user;

-- Functions: nothing callable unless listed here. Trigger functions need no grant to fire.
revoke all on all functions in schema public from anon, authenticated, public;
grant execute on function public.decrement_product_stock(jsonb) to authenticated, admin_user;
grant execute on function public.increment_coupon_usage(uuid) to authenticated, admin_user;
grant execute on function public.get_or_create_sub_subcategory(text, uuid, uuid) to admin_user;
-- Not used by the site, and it can increment any column of any video, so admins only.
grant execute on function public.increment_video_stat(bigint, text) to admin_user;

-- Storefront content: anyone can read, only admins change it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'product_variations', 'product_images', 'categories', 'subcategories',
    'sub_subcategories', 'brands', 'attributes', 'banner', 'hero_section', 'instagram_links',
    'site_info', 'videos'
  ] loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Checkout shows the active bank and UPI details to pay into.
grant select on public.payment_gateways to anon, authenticated;
create policy active_read on public.payment_gateways for select to anon, authenticated using (is_active);

-- The video player counts views. Only that one column can be changed.
grant update (views_count) on public.videos to anon, authenticated;
create policy count_view on public.videos for update to anon, authenticated using (true) with check (true);

-- Reviews: anyone reads visible ones, customers post their own.
grant select on public.reviews to anon, authenticated;
grant insert (product_id, user_id, rating, review_text) on public.reviews to authenticated;
create policy visible_read on public.reviews for select to anon, authenticated using (is_active);
create policy own_insert on public.reviews for insert to authenticated with check (user_id = auth.uid());

-- Reviewer names on product pages. Email addresses stay private.
grant select (id, full_name) on public.profiles to anon, authenticated;
create policy name_read on public.profiles for select to anon, authenticated using (true);

-- Contact form.
grant insert (name, email, subject, message) on public.contact_messages to anon, authenticated;
create policy form_insert on public.contact_messages for insert to anon, authenticated with check (true);

-- Checkout looks a coupon up by its code, then records that this customer used it.
grant select on public.coupons to authenticated;
create policy signed_in_read on public.coupons for select to authenticated using (true);
grant select, insert on public.coupon_usages to authenticated;
create policy own_read on public.coupon_usages for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.coupon_usages for insert to authenticated with check (user_id = auth.uid());

-- A customer's own cart, wishlist and video likes.
do $$
declare
  t text;
begin
  foreach t in array array['cart', 'wishlists', 'video_likes'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- The videos page counts likes for everyone and shows whether the viewer liked each video.
grant select on public.video_likes to anon;
create policy public_read on public.video_likes for select to anon, authenticated using (true);

-- Orders: customers place and see their own. Only the columns checkout sends can be set, so
-- payment_status and status always start at their defaults ('pending', 'placed') and only an
-- admin can mark an order paid, shipped or delivered.
grant select on public.orders to authenticated;
grant insert (
  user_id, full_name, phone_number, alt_phone_number, house_number, street, city, state, pincode,
  payment_method, payment_id, total_price, shipping_cost, grand_total, discount_amount, coupon_code,
  cart_items, email, carry_bag_box, bag_box_price
) on public.orders to authenticated;
create policy own_read on public.orders for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.orders for insert to authenticated with check (user_id = auth.uid());

-- Everything else (customers, users, subadmins, rakvih_subadmins, Rakvih_orders, pos_orders,
-- contact_messages reads, coupon changes, ...) is reachable by admin_user only.

commit;
