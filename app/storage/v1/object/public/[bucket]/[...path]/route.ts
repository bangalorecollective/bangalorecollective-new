// Serves uploaded files at the same path Supabase used, so stored links only change host.
// Payment proofs are private: only the customer who uploaded one, or an admin, can open it.
// In production Caddy serves the public buckets straight from disk; this route still handles
// payment proofs and local development.
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { contentTypeFor, filePath, isBucket, PRIVATE_BUCKETS } from "@/lib/server/storage";
import { readSession } from "@/lib/server/session";

type Params = { params: Promise<{ bucket: string; path: string[] }> };

const notFound = () => NextResponse.json({ error: "not_found", message: "Object not found" }, { status: 404 });

export async function GET(request: NextRequest, { params }: Params) {
  const { bucket, path: parts } = await params;
  if (!isBucket(bucket)) return notFound();
  const objectPath = parts.map(decodeURIComponent).join("/");

  if (PRIVATE_BUCKETS.has(bucket)) {
    const admin = await readSession(request, "admin");
    const customer = admin ? null : await readSession(request, "customer");
    if (!admin && !(customer && objectPath.startsWith(`${customer.user_id}/`))) return notFound();
  }

  const file = filePath(bucket, objectPath);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info?.isFile()) return notFound();

  const headers = new Headers({
    "content-type": contentTypeFor(file),
    "accept-ranges": "bytes",
    "cache-control": PRIVATE_BUCKETS.has(bucket) ? "private, no-store" : "public, max-age=86400",
    "last-modified": info.mtime.toUTCString(),
  });

  // Videos are streamed in ranges.
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || start > end) {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${info.size}` } });
    }
    headers.set("content-range", `bytes ${start}-${end}/${info.size}`);
    headers.set("content-length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(stream, { status: 206, headers });
  }

  headers.set("content-length", String(info.size));
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
}
