// Short-lived HS256 tokens that tell PostgREST which database role to use for one request.
// They never reach the browser: the REST proxy signs one per request from the session cookie.
import { createHmac } from "crypto";

export type DbRole = "anon" | "authenticated" | "admin_user";

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function signDbToken(role: DbRole, sub?: string, extra: Record<string, unknown> = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: Record<string, unknown> = { ...extra, role, exp: Math.floor(Date.now() / 1000) + 60 };
  if (sub) claims.sub = sub;
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
