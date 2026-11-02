// Admin sign-in. Replaces the email and password that were written into the login page and the
// plain-text subadmin passwords that were compared in the browser.
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/server/db";
import { clearFailures, clientIp, isBlocked, recordFailure, TOO_MANY_ATTEMPTS } from "@/lib/server/rate-limit";
import { clearSessionCookie, createSession, deleteSession, readSession, setSessionCookie } from "@/lib/server/session";

type Params = { params: Promise<{ action: string }> };

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  role: "master-admin" | "subadmin";
}

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });

async function findAdmin(email: string): Promise<AdminRow | null> {
  const master = await pool.query<AdminRow>(
    "select id, email, password_hash, role from app.admins where lower(email) = $1",
    [email]
  );
  if (master.rows[0]) return master.rows[0];

  const sub = await pool.query<AdminRow>(
    "select id, email, password as password_hash, 'subadmin' as role from public.subadmins where lower(email) = $1 limit 1",
    [email]
  );
  return sub.rows[0] ?? null;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { action } = await params;
  if (action !== "session") return fail("Not found", 404);

  const session = await readSession(request, "admin");
  if (!session) return NextResponse.json({ admin: null });
  return NextResponse.json({ admin: { id: session.user_id, role: session.admin_role } });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { action } = await params;

  if (action === "logout") {
    await deleteSession(request, "admin");
    const response = NextResponse.json({});
    clearSessionCookie(response, "admin");
    return response;
  }

  if (action !== "login") return fail("Not found", 404);

  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const ip = clientIp(request);
  if (await isBlocked("admin", email, ip)) return fail(TOO_MANY_ATTEMPTS, 429);

  const admin = await findAdmin(email);
  const ok = admin?.password_hash?.startsWith("$2") && (await bcrypt.compare(String(body.password ?? ""), admin.password_hash));
  if (!admin || !ok) {
    await recordFailure("admin", email, ip);
    return fail("Invalid Credentials", 401);
  }

  await clearFailures("admin", email);
  const { token, expiresAt } = await createSession("admin", admin.id, admin.role);
  const response = NextResponse.json({ admin: { id: admin.id, email: admin.email, role: admin.role } });
  setSessionCookie(response, "admin", token, expiresAt);
  return response;
}
