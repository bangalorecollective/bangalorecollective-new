// Customer sign-in, replacing Supabase Auth. Called by lib/db/client.ts; error messages match the
// ones supabase-js returned so the existing screens show the same text.
import { NextRequest, NextResponse } from "next/server";
import {
  checkPassword,
  confirmEmail,
  createEmailToken,
  createUser,
  findUserByEmail,
  findUserById,
  isBlocked,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  recordSignIn,
  setPassword,
  toPublicUser,
  useEmailToken,
} from "@/lib/server/customers";
import { sendMail, siteUrl } from "@/lib/server/mail";
import { clearFailures, clientIp, isBlocked as tooManyAttempts, recordFailure, TOO_MANY_ATTEMPTS } from "@/lib/server/rate-limit";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteUserSessions,
  readSession,
  setSessionCookie,
} from "@/lib/server/session";

type Params = { params: Promise<{ action: string }> };

const fail = (message: string, status = 400) => NextResponse.json({ error: { message, status } }, { status });

async function startSession(userId: string) {
  const user = await findUserById(userId);
  if (!user) return fail("User not found", 404);
  await recordSignIn(userId);
  const { token, expiresAt } = await createSession("customer", userId);
  const response = NextResponse.json({
    user: toPublicUser(user),
    session: { user: toPublicUser(user), expires_at: Math.floor(expiresAt.getTime() / 1000) },
  });
  setSessionCookie(response, "customer", token, expiresAt);
  return response;
}

function emailLayout(title: string, body: string, buttonText: string, link: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">
    <h2 style="margin:0 0 12px">${title}</h2>
    <p style="line-height:1.5">${body}</p>
    <p style="margin:28px 0"><a href="${link}" style="background:#111;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">${buttonText}</a></p>
    <p style="font-size:12px;color:#666">If you did not ask for this, you can ignore this email.</p>
    <p style="font-size:12px;color:#666">Bangalore Collective</p>
  </div>`;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { action } = await params;

  if (action === "session") {
    const session = await readSession(request, "customer");
    const user = session ? await findUserById(session.user_id) : null;
    if (!session || !user || isBlocked(user)) return NextResponse.json({ session: null });
    return NextResponse.json({
      session: { user: toPublicUser(user), expires_at: Math.floor(session.expires_at.getTime() / 1000) },
    });
  }

  // Link from the "confirm your email" message: confirm, sign in, go to the shop.
  if (action === "confirm") {
    const userId = await useEmailToken(request.nextUrl.searchParams.get("token") ?? "", "confirm");
    if (!userId) return NextResponse.redirect(siteUrl("/userinterface/home?confirm=expired"));
    await confirmEmail(userId);
    const signedIn = await startSession(userId);
    const redirect = NextResponse.redirect(siteUrl("/userinterface/home"));
    signedIn.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return fail("Not found", 404);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { action } = await params;
  const body = await request.json().catch(() => ({}));
  const ip = clientIp(request);

  if (action === "login") {
    const email = normalizeEmail(body.email);
    if (await tooManyAttempts("customer", email, ip)) return fail(TOO_MANY_ATTEMPTS, 429);

    const user = await findUserByEmail(email);
    if (!user || !(await checkPassword(user, String(body.password ?? "")))) {
      await recordFailure("customer", email, ip);
      return fail("Invalid login credentials");
    }
    if (!user.email_confirmed_at) return fail("Email not confirmed");
    if (isBlocked(user)) return fail("This account has been blocked. Please contact us.", 403);

    await clearFailures("customer", email);
    return startSession(user.id);
  }

  if (action === "signup") {
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Unable to validate email address: invalid format");
    if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password should be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (await findUserByEmail(email)) return fail("User already registered", 422);

    const metadata = typeof body.data === "object" && body.data !== null ? body.data : {};
    const user = await createUser(email, password, metadata);
    const token = await createEmailToken(user.id, "confirm");
    await sendMail({
      to: email,
      subject: "Confirm your Bangalore Collective account",
      html: emailLayout(
        "Confirm your email",
        "Thanks for joining Bangalore Collective. Please confirm your email address to finish creating your account.",
        "Confirm email",
        siteUrl(`/api/auth/customer/confirm?token=${token}`)
      ),
    });
    return NextResponse.json({ user: toPublicUser(user), session: null });
  }

  if (action === "logout") {
    await deleteSession(request, "customer");
    const response = NextResponse.json({});
    clearSessionCookie(response, "customer");
    return response;
  }

  // "Forgot password": always answers the same way, so it does not reveal which emails have accounts.
  if (action === "recover-request") {
    const email = normalizeEmail(body.email);
    if (await tooManyAttempts("recover", email, ip)) return fail(TOO_MANY_ATTEMPTS, 429);
    await recordFailure("recover", email, ip);

    const user = await findUserByEmail(email);
    if (user && !isBlocked(user)) {
      const token = await createEmailToken(user.id, "recovery");
      await sendMail({
        to: user.email,
        subject: "Reset your Bangalore Collective password",
        html: emailLayout(
          "Reset your password",
          "We received a request to reset your password. This link works once and expires in 1 hour.",
          "Choose a new password",
          siteUrl(`/userinterface/auth/update-password?reset_token=${token}`)
        ),
      });
    }
    return NextResponse.json({});
  }

  // The reset link opens the update-password page, which trades the token for a session,
  // the way Supabase signed the user in from its recovery link.
  if (action === "recover") {
    const userId = await useEmailToken(String(body.token ?? ""), "recovery");
    if (!userId) return fail("Recovery link is invalid or has expired", 401);
    await confirmEmail(userId);
    return startSession(userId);
  }

  if (action === "update") {
    const session = await readSession(request, "customer");
    if (!session) return fail("Auth session missing!", 401);
    const password = String(body.password ?? "");
    if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password should be at least ${MIN_PASSWORD_LENGTH} characters.`);

    await setPassword(session.user_id, password);
    // Sign out every other browser, keep this one.
    await deleteUserSessions(session.user_id, "customer");
    return startSession(session.user_id);
  }

  return fail("Not found", 404);
}
