import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/rest";

// Disable caching so payment status / order updates are always fresh
export const dynamic = "force-dynamic";

// Admin only (the order details page in the admin panel).
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (admin.response) return admin.response;
  const supabase = admin.rest;

  try {
    // Next.js 15/16 params fix
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 }
      );
    }

    // Fetch order
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Supabase error:", error);

      return NextResponse.json(
        { error: "Failed to fetch order" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { order: data },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store", // prevent stale order data
        },
      }
    );

  } catch (err: any) {
    console.error("API error:", err);

    return NextResponse.json(
      { error: err.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}