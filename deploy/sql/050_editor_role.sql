-- A login for changing data in pgAdmin. It can read, add, change and delete rows in every table
-- (row level security does not apply to it) and create new tables in public. It cannot drop the
-- database, manage roles, or alter or drop existing tables, which belong to postgres.
--
-- Safe to run more than once. Expects psql variable editor_password.

do $$ begin
  if not exists (select from pg_roles where rolname = 'editor') then
    create role editor login;
  end if;
end $$;

alter role editor with login password :'editor_password' bypassrls nosuperuser nocreatedb nocreaterole connection limit 5;
grant pg_read_all_data, pg_write_all_data to editor;
grant connect on database bangalorecollective to editor;
grant create on schema public to editor;
grant usage, select, update on all sequences in schema public to editor;
