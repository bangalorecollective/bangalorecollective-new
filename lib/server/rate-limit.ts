// Slows down password guessing: too many failed sign-ins for one email or one IP address
// within 15 minutes and further attempts are refused until the window passes.
import type { NextRequest } from "next/server";
import { pool } from "./db";

const WINDOW = "15 minutes";
// The IP limit is looser because many customers on one mobile network can share an address.
const LIMITS = { email: 10, ip: 50 };

export function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

function keys(scope: string, email: string, ip: string) {
  return { email: `${scope}:email:${email.toLowerCase()}`, ip: `${scope}:ip:${ip}` };
}

export async function isBlocked(scope: string, email: string, ip: string) {
  const k = keys(scope, email, ip);
  const { rows } = await pool.query<{ email: string; ip: string }>(
    `select count(*) filter (where key = $1) as email, count(*) filter (where key = $2) as ip
     from app.login_failures where key in ($1, $2) and failed_at > now() - $3::interval`,
    [k.email, k.ip, WINDOW]
  );
  return Number(rows[0].email) >= LIMITS.email || Number(rows[0].ip) >= LIMITS.ip;
}

export async function recordFailure(scope: string, email: string, ip: string) {
  const k = keys(scope, email, ip);
  await pool.query("insert into app.login_failures (key) values ($1), ($2)", [k.email, k.ip]);
  await pool.query("delete from app.login_failures where failed_at < now() - interval '1 day'");
}

export async function clearFailures(scope: string, email: string) {
  await pool.query("delete from app.login_failures where key = $1", [keys(scope, email, "").email]);
}

export const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait 15 minutes and try again.";
