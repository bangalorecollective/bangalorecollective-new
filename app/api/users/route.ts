import { NextRequest, NextResponse } from "next/server";
import { listUsers } from "@/lib/server/customers";
import { requireAdmin } from "@/lib/server/rest";

// Customer search for the POS screen. Admin only.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const { searchParams } = new URL(request.url);
  const search = (searchParams.get("query") || "").toLowerCase().trim();

  try {
    // Searches every customer, not only the first page.
    const filteredUsers = await listUsers(search, 50);

    // Format the profile array structures cleanly for your frontend mapping rules
    const formattedUsers = filteredUsers.map((u) => {
      // 1. Resolve Name: prioritization goes metadata name -> email identity prefix -> fallback
      const emailFallback = u.email ? u.email.split("@")[0] : "Auth User";
      const resolvedName = String(u.user_metadata?.full_name || emailFallback);

      // 2. Resolve Phone: looks at root, then looks at your nested metadata block
      const resolvedPhone = u.phone || u.user_metadata?.phone || "N/A";

      return {
        id: u.id,
        name: resolvedName.toUpperCase(), // Keeps typography styling consistent with your POS look
        phone: resolvedPhone,
        email: u.email,
      };
    });

    return NextResponse.json(formattedUsers);
  } catch (error: any) {
    console.error("User Directory API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
