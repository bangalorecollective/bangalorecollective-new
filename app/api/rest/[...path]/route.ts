// Same-origin gateway to PostgREST. The browser never holds a database token: for each request
// this route reads the session cookie, signs a 60-second token for the matching role, and
// PostgreSQL's row level security decides what that role may read or change.
import { NextRequest, NextResponse } from "next/server";
import { findUserById, isBlocked } from "@/lib/server/customers";
import { DbRole, signDbToken } from "@/lib/server/jwt";
import { readSession } from "@/lib/server/session";

type Params = { params: Promise<{ path: string[] }> };

const FORWARD_REQUEST_HEADERS = ["accept", "content-type", "prefer", "range", "range-unit", "accept-profile", "content-profile"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-range", "preference-applied", "location"];

// Query parameters that shape the result but do not narrow which rows are touched.
const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

async function roleFor(request: NextRequest): Promise<{ role: DbRole; sub?: string; extra?: Record<string, unknown> }> {
  // Admin pages mark their requests (lib/db/client.ts); the admin cookie must still be valid.
  if (request.headers.get("x-app-area") === "admin") {
    const admin = await readSession(request, "admin");
    if (admin) return { role: "admin_user", sub: admin.user_id, extra: { admin_role: admin.admin_role } };
  }
  const customer = await readSession(request, "customer");
  if (customer) {
    const user = await findUserById(customer.user_id);
    if (user && !isBlocked(user)) return { role: "authenticated", sub: customer.user_id };
  }
  return { role: "anon" };
}

async function proxy(request: NextRequest, { params }: Params) {
  const { path } = await params;
  const method = request.method;
  const search = request.nextUrl.search;

  // Supabase refused UPDATE and DELETE without a filter (pg-safeupdate); keep that protection.
  if (method === "PATCH" || method === "DELETE") {
    const hasFilter = [...request.nextUrl.searchParams.keys()].some((k) => !NON_FILTER_PARAMS.has(k));
    if (!hasFilter) {
      return NextResponse.json(
        { code: "21000", message: `${method === "PATCH" ? "UPDATE" : "DELETE"} requires a WHERE clause`, details: null, hint: null },
        { status: 400 }
      );
    }
  }

  const { role, sub, extra } = await roleFor(request);
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (role !== "anon") headers.set("authorization", `Bearer ${signDbToken(role, sub, extra)}`);

  const hasBody = !["GET", "HEAD"].includes(method);
  const upstream = await fetch(`${process.env.POSTGREST_URL}/${path.map(encodeURIComponent).join("/")}${search}`, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "no-store");
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
