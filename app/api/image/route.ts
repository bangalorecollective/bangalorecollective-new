// Resizes uploaded images for <Image> (see lib/image-loader.ts), replacing Supabase's image
// transformation. Product photos are several MB each, so pages must never load the originals.
// Results are cached on disk, keyed by the file's modification time, so a re-uploaded image
// gets a fresh copy.
import { createHash } from "crypto";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { filePath, isBucket, PRIVATE_BUCKETS } from "@/lib/server/storage";

// Must match images.deviceSizes / imageSizes and images.qualities in next.config.ts.
const WIDTHS = new Set([16, 32, 64, 128, 256, 384, 640, 768, 1024, 1280, 1600, 1920]);
const QUALITIES = new Set([60, 75, 85, 100]);
// Not resized: vector and animated images, and videos that were uploaded as product images.
const PASS_THROUGH = new Set([".svg", ".gif", ".mp4", ".webm", ".mov"]);

const CACHE_DIR = path.resolve(process.env.IMAGE_CACHE_DIR ?? ".image-cache");

// A page like POS asks for over a thousand photos at once. Resize at most 3 at a time, one CPU
// core each, so the rest of the site stays responsive; the others wait their turn.
const MAX_PARALLEL = 3;
sharp.concurrency(1);
let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>) {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// The same image requested twice while it is being made is only made once.
const inFlight = new Map<string, Promise<Buffer>>();

async function resize(file: string, width: number, quality: number, cached: string) {
  const output = await withSlot(() =>
    sharp(file, { failOn: "none" }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer()
  );
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, output);
  return output;
}

const notFound = () => new NextResponse("Not found", { status: 404 });

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const src = params.get("src") ?? ""; // "<bucket>/<path inside bucket>"
  const width = Number(params.get("w"));
  const quality = Number(params.get("q") ?? 75);
  if (!WIDTHS.has(width) || !QUALITIES.has(quality)) return new NextResponse("Bad size", { status: 400 });

  const [bucket, ...rest] = src.split("/");
  if (!isBucket(bucket) || PRIVATE_BUCKETS.has(bucket)) return notFound();
  const file = filePath(bucket, rest.join("/"));
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info?.isFile()) return notFound();

  if (PASS_THROUGH.has(path.extname(file).toLowerCase())) {
    return NextResponse.redirect(new URL(`/storage/v1/object/public/${src}`, request.url), 307);
  }

  const key = createHash("sha1").update(`${src}|${info.mtimeMs}|${width}|${quality}`).digest("hex");
  const cached = path.join(CACHE_DIR, key.slice(0, 2), `${key}.webp`);
  const headers = { "content-type": "image/webp", "cache-control": "public, max-age=86400" };

  const hit = await readFile(cached).catch(() => null);
  if (hit) return new NextResponse(new Uint8Array(hit), { headers });

  try {
    let job = inFlight.get(key);
    if (!job) {
      job = resize(file, width, quality, cached).finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }
    return new NextResponse(new Uint8Array(await job), { headers });
  } catch {
    // Not an image sharp can read: send the original rather than a broken picture.
    return NextResponse.redirect(new URL(`/storage/v1/object/public/${src}`, request.url), 307);
  }
}
