// File uploads and deletes, replacing supabase.storage. Admins may write to every bucket;
// a signed-in customer may only add a payment proof inside their own folder.
import { mkdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  filePath,
  isAllowedType,
  isBucket,
  MAX_UPLOAD_BYTES,
} from "@/lib/server/storage";
import { readSession } from "@/lib/server/session";

type Params = { params: Promise<{ action: string }> };

const fail = (message: string, status = 400) => NextResponse.json({ error: { message, statusCode: String(status) } }, { status });

async function writer(request: NextRequest) {
  if (request.headers.get("x-app-area") === "admin" && (await readSession(request, "admin"))) return { admin: true as const };
  const customer = await readSession(request, "customer");
  return customer ? { admin: false as const, userId: customer.user_id } : null;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { action } = await params;
  const who = await writer(request);
  if (!who) return fail("Unauthorized", 401);

  if (action === "upload") {
    const form = await request.formData();
    const bucket = String(form.get("bucket") ?? "");
    const objectPath = String(form.get("path") ?? "");
    const file = form.get("file");
    const upsert = form.get("upsert") === "true";

    if (!isBucket(bucket)) return fail("Bucket not found", 404);
    if (!(file instanceof File)) return fail("No file");
    const allowed = who.admin || (bucket === "payment-proofs" && objectPath.startsWith(`${who.userId}/`));
    if (!allowed) return fail("new row violates row-level security policy", 403);
    if (!isAllowedType(file.type)) return fail(`mime type ${file.type || "unknown"} is not supported`, 415);
    if (file.size > (MAX_UPLOAD_BYTES[bucket] ?? DEFAULT_MAX_UPLOAD_BYTES)) return fail("The object exceeded the maximum allowed size", 413);

    const target = filePath(bucket, objectPath);
    if (!target) return fail("Invalid key");
    if (!upsert && (await stat(target).catch(() => null))) return fail("The resource already exists", 409);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ data: { path: objectPath, fullPath: `${bucket}/${objectPath}` } });
  }

  if (action === "remove") {
    if (!who.admin) return fail("Unauthorized", 403);
    const body = await request.json().catch(() => ({}));
    const bucket = String(body.bucket ?? "");
    if (!isBucket(bucket)) return fail("Bucket not found", 404);

    const removed: { name: string }[] = [];
    for (const p of Array.isArray(body.paths) ? body.paths : []) {
      const target = filePath(bucket, String(p));
      if (target && (await stat(target).catch(() => null))) {
        await rm(target);
        removed.push({ name: String(p) });
      }
    }
    return NextResponse.json({ data: removed });
  }

  return fail("Not found", 404);
}
