// Admin sign-in. Replaces the email and password that were written into the login page and the
// plain-text subadmin passwords that were compared in the browser.
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/server/db";
import { clearFailures, clientIp, isBlocked, recordFailure, TOO_MANY_ATTEMPTS } from "@/lib/server/rate-limit";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteUserSessions,
  readSession,
  setSessionCookie,
} from "@/lib/server/session";

type Params = { params: Promise<{ action: string }> };

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  role: "master-admin" | "subadmin";
}

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });

// Same minimum as deploy/set-admin-password.sh.
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (action === "account") {
    const session = await readSession(request, "admin");
    if (session?.admin_role !== "master-admin") return fail("Only the main admin can open this page.", 403);
    const { rows } = await pool.query<{ email: string }>("select email from app.admins where id = $1", [session.user_id]);
    return NextResponse.json({ email: rows[0]?.email ?? "" });
  }

  if (action !== "session") return fail("Not found", 404);

  const session = await readSession(request, "admin");
  if (!session) return NextResponse.json({ admin: null });
  return NextResponse.json({ admin: { id: session.user_id, role: session.admin_role } });
}

// The main admin changes its own email and/or password. The current password is always needed.
// There is only ever one main admin: this updates that row, it never adds another.
async function updateAccount(request: NextRequest) {
  const session = await readSession(request, "admin");
  if (session?.admin_role !== "master-admin") return fail("Only the main admin can change these details.", 403);

  const { rows } = await pool.query<AdminRow>(
    "select id, email, password_hash, role from app.admins where id = $1",
    [session.user_id]
  );
  const admin = rows[0];
  if (!admin) return fail("Admin account not found.", 404);

  const body = await request.json().catch(() => ({}));
  const ip = clientIp(request);
  if (await isBlocked("admin", admin.email, ip)) return fail(TOO_MANY_ATTEMPTS, 429);
  if (!(await bcrypt.compare(String(body.currentPassword ?? ""), admin.password_hash))) {
    await recordFailure("admin", admin.email, ip);
    return fail("Current password is wrong.", 401);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const newPassword = String(body.newPassword ?? "");
  if (!EMAIL_PATTERN.test(email)) return fail("Enter a valid email address.");
  if (newPassword && newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return fail(`New password should be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
  }
  if (email === admin.email && !newPassword) return fail("Nothing to change.");

  if (email !== admin.email) {
    // Sign-in looks up the main admin first, so a staff login with this email would stop working.
    const taken = await pool.query("select 1 from public.subadmins where lower(email) = $1 limit 1", [email]);
    if (taken.rowCount) return fail("A staff login already uses this email.", 409);
  }

  const passwordHash = newPassword ? await bcrypt.hash(newPassword, 10) : admin.password_hash;
  await pool.query("update app.admins set email = $1, password_hash = $2 where id = $3", [
    email,
    passwordHash,
    admin.id,
  ]);
  await clearFailures("admin", admin.email);

  // Sign out every other browser, keep this one.
  await deleteUserSessions(admin.id, "admin");
  const { token, expiresAt } = await createSession("admin", admin.id, admin.role);
  const response = NextResponse.json({ email });
  setSessionCookie(response, "admin", token, expiresAt);
  return response;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { action } = await params;

  if (action === "logout") {
    await deleteSession(request, "admin");
    const response = NextResponse.json({});
    clearSessionCookie(response, "admin");
    return response;
  }

  if (action === "account") return updateAccount(request);

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
