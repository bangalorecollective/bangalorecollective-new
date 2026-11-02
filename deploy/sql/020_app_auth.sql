-- Sign-in for the VPS site, replacing Supabase Auth.
--
-- Customers stay in auth.users with the bcrypt hashes Supabase created, so their passwords keep
-- working. Everything the app adds lives in the private "app" schema, which PostgREST never exposes.
-- The Next.js server reaches it as app_server, a role that can only touch what sign-in needs.
--
-- Safe to run more than once. Expects psql variable app_server_password.

begin;

create schema if not exists app;
revoke all on schema app from public;

-- One row per signed-in browser. Only a SHA-256 of the cookie value is stored.
create table if not exists app.sessions (
  token_hash   text primary key,
  kind         text not null check (kind in ('customer', 'admin')),
  user_id      uuid not null,
  admin_role   text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on app.sessions (user_id);

-- The master admin, which used to be an email and password written in the login page.
-- Subadmins stay in public.subadmins so the "create subadmin" page keeps working.
create table if not exists app.admins (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  role          text not null default 'master-admin' check (role = 'master-admin'),
  created_at    timestamptz not null default now()
);

-- Links sent by email to confirm a new account or reset a password. Only a hash is stored.
create table if not exists app.email_tokens (
  token_hash text primary key,
  purpose    text not null check (purpose in ('confirm', 'recovery')),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- Failed sign-ins, to slow down password guessing.
create table if not exists app.login_failures (
  key       text not null,
  failed_at timestamptz not null default now()
);
create index if not exists login_failures_key_idx on app.login_failures (key, failed_at);

-- Subadmin passwords were stored as plain text. Hash on every insert or change, and hash the
-- existing ones now. The same password still signs in.
-- Security definer: it fires for admin_user, which has no access to the extensions schema.
create or replace function app.hash_subadmin_password() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions as $$
begin
  if new.password is not null and new.password !~ '^\$2[aby]\$' then
    new.password := extensions.crypt(new.password, extensions.gen_salt('bf', 10));
  end if;
  return new;
end $$;

drop trigger if exists hash_password on public.subadmins;
create trigger hash_password before insert or update of password on public.subadmins
  for each row execute function app.hash_subadmin_password();

update public.subadmins set password = password where password !~ '^\$2[aby]\$';

-- The role the Next.js server signs in with.
do $$ begin
  if not exists (select from pg_roles where rolname = 'app_server') then
    create role app_server login;
  end if;
end $$;
alter role app_server with login password :'app_server_password';
alter role app_server set search_path = app, public;

grant usage on schema app, auth, public to app_server;
grant select, insert, update, delete on all tables in schema app to app_server;
grant select, insert, update on auth.users to app_server;
grant select on public.subadmins to app_server;

-- Both tables have row level security on (auth.users since Supabase), so the grants alone show
-- no rows. These policies apply to app_server only.
drop policy if exists app_server_sign_in on auth.users;
create policy app_server_sign_in on auth.users for all to app_server using (true) with check (true);
drop policy if exists app_server_sign_in on public.subadmins;
create policy app_server_sign_in on public.subadmins for select to app_server using (true);

commit;
