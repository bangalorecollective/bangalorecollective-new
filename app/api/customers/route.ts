import { NextRequest, NextResponse } from "next/server";
import { findUserById, listUsers, setBlocked } from "@/lib/server/customers";
import { requireAdmin } from "@/lib/server/rest";
import { deleteUserSessions } from "@/lib/server/session";

// Admin customer list. Supabase's listUsers returned only the first 50; this returns everyone.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin.response) return admin.response;

  try {
    return NextResponse.json({ users: await listUsers() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Block or unblock a customer. A blocked customer is signed out and cannot sign in again.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin.response) return admin.response;

  const { userId, block } = await req.json();
  if (!userId || typeof block !== "boolean") {
    return NextResponse.json({ error: "Missing userId or block status" }, { status: 400 });
  }

  try {
    if (!(await findUserById(userId))) return NextResponse.json({ error: "User not found" }, { status: 404 });
    await setBlocked(userId, block);
    if (block) await deleteUserSessions(userId, "customer");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
