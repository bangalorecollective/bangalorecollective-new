// Customer accounts in auth.users, the table Supabase Auth used. Passwords are the same bcrypt
// hashes Supabase stored, so existing customers keep their passwords.
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "./db";

interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  encrypted_password: string | null;
  email_confirmed_at: Date | null;
  last_sign_in_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
  banned_until: Date | null;
  deleted_at: Date | null;
  raw_user_meta_data: Record<string, unknown> | null;
  raw_app_meta_data: Record<string, unknown> | null;
}

// The shape pages read from session.user, matching what supabase-js returned.
export interface PublicUser {
  id: string;
  aud: "authenticated";
  role: "authenticated";
  email: string;
  phone: string;
  email_confirmed_at: string | null;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string | null;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
}

const COLUMNS = `id, email, phone, encrypted_password, email_confirmed_at, last_sign_in_at, created_at,
  updated_at, banned_until, deleted_at, raw_user_meta_data, raw_app_meta_data`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    phone: u.phone ?? "",
    email_confirmed_at: iso(u.email_confirmed_at),
    confirmed_at: iso(u.email_confirmed_at),
    last_sign_in_at: iso(u.last_sign_in_at),
    created_at: u.created_at.toISOString(),
    updated_at: iso(u.updated_at),
    user_metadata: u.raw_user_meta_data ?? {},
    app_metadata: u.raw_app_meta_data ?? {},
  };
}

export const normalizeEmail = (email: unknown) => String(email ?? "").trim().toLowerCase();

export async function findUserByEmail(email: string) {
  const { rows } = await pool.query<UserRow>(
    `select ${COLUMNS} from auth.users where lower(email) = $1 and deleted_at is null limit 1`,
    [normalizeEmail(email)]
  );
  return rows[0] ?? null;
}

// Admin customer directory, newest first. With a search, matches email, phone or name.
export async function listUsers(search = "", limit = 1000) {
  const term = search.trim().toLowerCase();
  const { rows } = await pool.query<UserRow>(
    `select ${COLUMNS} from auth.users
     where deleted_at is null and ($1 = '' or lower(email) like $2 or phone like $2
       or raw_user_meta_data->>'phone' like $2 or lower(raw_user_meta_data->>'full_name') like $2)
     order by created_at desc limit $3`,
    [term, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit]
  );
  return rows.map(toPublicUser);
}

export async function setBlocked(id: string, blocked: boolean) {
  await pool.query(
    `update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || jsonb_build_object('is_blocked', $2::boolean),
       updated_at = now() where id = $1`,
    [id, blocked]
  );
}

export async function findUserById(id: string) {
  const { rows } = await pool.query<UserRow>(
    `select ${COLUMNS} from auth.users where id = $1 and deleted_at is null`,
    [id]
  );
  return rows[0] ?? null;
}

// Blocked from the admin "customers" page, or banned.
export function isBlocked(u: UserRow) {
  return u.raw_user_meta_data?.is_blocked === true || (u.banned_until !== null && u.banned_until > new Date());
}

export async function checkPassword(u: UserRow, password: string) {
  if (!u.encrypted_password) return false;
  return bcrypt.compare(password, u.encrypted_password);
}

// bcrypt cost 10 with the $2a$ prefix, the same format Supabase used.
export const hashPassword = (password: string) => bcrypt.hash(password, 10);

export async function recordSignIn(id: string) {
  await pool.query("update auth.users set last_sign_in_at = now(), updated_at = now() where id = $1", [id]);
}

export async function createUser(email: string, password: string, metadata: Record<string, unknown>) {
  // The on_auth_user_created trigger creates the matching profiles and customers rows.
  const { rows } = await pool.query<UserRow>(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data,
       raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       $1, $2, '{"provider": "email", "providers": ["email"]}', $3, now(), now(), false, false)
     returning ${COLUMNS}`,
    [normalizeEmail(email), await hashPassword(password), { ...metadata, email: normalizeEmail(email), email_verified: false }]
  );
  return rows[0];
}

export async function setPassword(id: string, password: string) {
  await pool.query("update auth.users set encrypted_password = $2, updated_at = now() where id = $1", [
    id,
    await hashPassword(password),
  ]);
}

export async function confirmEmail(id: string) {
  await pool.query(
    `update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now(),
       raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || '{"email_verified": true}'
     where id = $1`,
    [id]
  );
}

const TOKEN_HOURS = { confirm: 24, recovery: 1 };

export async function createEmailToken(userId: string, purpose: "confirm" | "recovery") {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `insert into app.email_tokens (token_hash, purpose, user_id, expires_at)
     values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [createHash("sha256").update(token).digest("hex"), purpose, userId, TOKEN_HOURS[purpose]]
  );
  return token;
}

// Marks the token used and returns its user, or null if it is unknown, used or expired.
export async function useEmailToken(token: string, purpose: "confirm" | "recovery") {
  const { rows } = await pool.query<{ user_id: string }>(
    `update app.email_tokens set used_at = now()
     where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
     returning user_id`,
    [createHash("sha256").update(token).digest("hex"), purpose]
  );
  return rows[0]?.user_id ?? null;
}

export const MIN_PASSWORD_LENGTH = 6;
