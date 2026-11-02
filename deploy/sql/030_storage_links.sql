-- Points stored file links at this server instead of Supabase Storage.
--
--   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
--     -> /storage/v1/object/public/<bucket>/<path>
--
-- The files keep the same bucket and path on the VPS, so only the host goes. Links become
-- relative, so they work on any address the site runs at (local, staging, the real domain).
-- Covers every text, json and text[] column in public. The Rakvih tables belong to another
-- app and are left alone. Safe to run again: already-rewritten links do not match.

begin;

do $$
declare
  c record;
  pattern constant text := 'https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/';
  target constant text := '/storage/v1/object/public/';
  changed bigint;
begin
  for c in
    select table_name, column_name, data_type, udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name not in ('Rakvih_orders', 'rakvih_subadmins')
      and (data_type in ('text', 'character varying', 'jsonb', 'json') or udt_name = '_text')
      and table_name in (select tablename from pg_tables where schemaname = 'public')
  loop
    if c.data_type in ('jsonb', 'json') then
      execute format(
        'update public.%I set %I = regexp_replace(%I::text, %L, %L, ''g'')::%s where %I::text ~ %L',
        c.table_name, c.column_name, c.column_name, pattern, target, c.data_type, c.column_name, pattern);
    elsif c.udt_name = '_text' then
      execute format(
        'update public.%I set %I = array(select regexp_replace(x, %L, %L) from unnest(%I) x) where array_to_string(%I, '' '') ~ %L',
        c.table_name, c.column_name, pattern, target, c.column_name, c.column_name, pattern);
    else
      execute format(
        'update public.%I set %I = regexp_replace(%I, %L, %L, ''g'') where %I ~ %L',
        c.table_name, c.column_name, c.column_name, pattern, target, c.column_name, pattern);
    end if;
    get diagnostics changed = row_count;
    if changed > 0 then
      raise notice '% rows  %.%', lpad(changed::text, 5), c.table_name, c.column_name;
    end if;
  end loop;
end $$;

commit;
