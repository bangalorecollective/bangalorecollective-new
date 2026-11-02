-- A login for looking at the data in pgAdmin. It can read every table, including ones that have
-- row level security, and cannot change anything: the server forces its sessions read-only.
--
-- Safe to run more than once. Expects psql variable viewer_password.

do $$ begin
  if not exists (select from pg_roles where rolname = 'viewer') then
    create role viewer login;
  end if;
end $$;

alter role viewer with login password :'viewer_password' bypassrls connection limit 5;
alter role viewer set default_transaction_read_only = on;
grant pg_read_all_data to viewer;
grant connect on database bangalorecollective to viewer;
