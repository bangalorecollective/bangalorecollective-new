// PostgREST from server code (API routes), as a chosen role, so the same row level security
// applies as for pages. Also the admin check API routes share.
import { PostgrestClient } from "@supabase/postgrest-js";
import { NextRequest, NextResponse } from "next/server";
import { DbRole, signDbToken } from "./jwt";
import { readSession } from "./session";

export function restAs(role: DbRole, sub?: string) {
  const headers: Record<string, string> = {};
  if (role !== "anon") headers.authorization = `Bearer ${signDbToken(role, sub)}`;
  return new PostgrestClient<any>(process.env.POSTGREST_URL ?? "", {
    headers,
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  });
}

// Returns the admin session, or a 401 response to send back.
export async function requireAdmin(request: NextRequest) {
  const session = await readSession(request, "admin");
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { session, rest: restAs("admin_user", session.user_id) };
}

export async function requireCustomer(request: NextRequest) {
  const session = await readSession(request, "customer");
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { session, rest: restAs("authenticated", session.user_id) };
}
