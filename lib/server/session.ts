// Sign-in sessions for customers and admins, kept in app.sessions.
// The browser holds a random token in an httpOnly cookie; the database only stores its SHA-256.
import { createHash, randomBytes } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { pool } from "./db";

export type SessionKind = "customer" | "admin";

export const SESSION_COOKIE: Record<SessionKind, string> = {
  customer: "bc_customer",
  admin: "bc_admin",
};

const SESSION_DAYS: Record<SessionKind, number> = { customer: 30, admin: 1 };

export interface SessionRow {
  user_id: string;
  admin_role: string | null;
  expires_at: Date;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(kind: SessionKind, userId: string, adminRole?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS[kind] * 24 * 60 * 60 * 1000);
  await pool.query(
    "insert into app.sessions (token_hash, kind, user_id, admin_role, expires_at) values ($1, $2, $3, $4, $5)",
    [hashToken(token), kind, userId, adminRole ?? null, expiresAt]
  );
  return { token, expiresAt };
}

export async function readSession(request: NextRequest, kind: SessionKind): Promise<SessionRow | null> {
  return readSessionToken(request.cookies.get(SESSION_COOKIE[kind])?.value, kind);
}

// For server actions, which get cookies from next/headers rather than a request.
export async function readSessionToken(token: string | undefined, kind: SessionKind): Promise<SessionRow | null> {
  if (!token) return null;

  const { rows } = await pool.query<SessionRow>(
    `update app.sessions set last_seen_at = now()
     where token_hash = $1 and kind = $2 and expires_at > now()
     returning user_id, admin_role, expires_at`,
    [hashToken(token), kind]
  );
  return rows[0] ?? null;
}

export async function deleteSession(request: NextRequest, kind: SessionKind) {
  const token = request.cookies.get(SESSION_COOKIE[kind])?.value;
  if (token) await pool.query("delete from app.sessions where token_hash = $1", [hashToken(token)]);
}

export async function deleteUserSessions(userId: string, kind: SessionKind) {
  await pool.query("delete from app.sessions where user_id = $1 and kind = $2", [userId, kind]);
}

export function setSessionCookie(response: NextResponse, kind: SessionKind, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE[kind], token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.SITE_URL ?? "").startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse, kind: SessionKind) {
  response.cookies.set(SESSION_COOKIE[kind], "", { httpOnly: true, path: "/", maxAge: 0 });
}
