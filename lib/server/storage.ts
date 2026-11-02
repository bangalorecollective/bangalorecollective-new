// Uploaded files on the VPS disk, replacing Supabase Storage. Files keep the same bucket and path
// they had on Supabase, under UPLOAD_DIR/<bucket>/<path>, and are served from
// /storage/v1/object/public/<bucket>/<path>, so only the host part of old links changes.
import path from "path";

export const BUCKETS = [
  "brand-images",
  "categories",
  "hero-images",
  "payment-assets",
  "payment-proofs",
  "product-images",
  "site-assets",
  "subcategory-images",
  "videos",
] as const;
export type Bucket = (typeof BUCKETS)[number];

// Customers upload payment screenshots at checkout; only the customer and admins may open them.
export const PRIVATE_BUCKETS = new Set<Bucket>(["payment-proofs"]);

export const MAX_UPLOAD_BYTES: Record<string, number> = { videos: 300 * 1024 * 1024 };
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|avif|svg\+xml|heic|heif)|video\/(mp4|webm|quicktime)|application\/pdf)$/;

export const isBucket = (b: string): b is Bucket => (BUCKETS as readonly string[]).includes(b);
export const isAllowedType = (type: string) => ALLOWED_TYPES.test(type);

// Resolves a stored file, refusing anything that would escape the bucket folder.
export function filePath(bucket: Bucket, objectPath: string) {
  const root = path.resolve(process.env.UPLOAD_DIR ?? "uploads", bucket);
  const cleaned = objectPath.replace(/^\/+/, "");
  const full = path.resolve(root, cleaned);
  if (!cleaned || full === root || !full.startsWith(root + path.sep)) return null;
  return full;
}

export function publicPath(bucket: string, objectPath: string) {
  return `/storage/v1/object/public/${bucket}/${objectPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
}

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

export const contentTypeFor = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
