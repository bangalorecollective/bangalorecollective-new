// lib/image-loader.ts
//
// Custom Next.js image loader. Called automatically for every <Image>/<OptimizedImage>.
//
// - Uploaded files (/storage/v1/object/public/...): resized by app/api/image, which keeps
//   resized copies on disk. (Next's own /_next/image is switched off when a custom loader is
//   set.) Links that still point at an old Supabase host are treated as the same file on
//   this server, so the site never loads anything from Supabase.
// - Everything else (Unsplash, Google avatars, files in /public, etc.): returned as-is, since
//   those hosts either already serve optimized assets or have their own CDN-level resizing.

type LoaderParams = {
  src: string;
  width: number;
  quality?: number;
};

const STORAGE_PATH = "/storage/v1/object/public/";

// Must match images.qualities in next.config.ts.
const QUALITIES = [60, 75, 85, 100];

export default function imageLoader({ src, width, quality }: LoaderParams): string {
  if (!src) return src;

  let path: string;
  try {
    // Absolute links, from this site or an old Supabase host. Any ?v= cache-buster is dropped:
    // the resizer keys its cache on the file's modification time instead.
    const url = new URL(src);
    if (!url.pathname.startsWith(STORAGE_PATH)) return src;
    path = url.pathname;
  } catch {
    // Relative paths (e.g. "/placeholder.png") — only uploaded files go through the resizer.
    if (!src.startsWith(STORAGE_PATH)) return src;
    path = src.split("?")[0];
  }

  const objectPath = decodeURIComponent(path.slice(STORAGE_PATH.length));
  const q = QUALITIES.reduce((best, v) => (Math.abs(v - (quality || 75)) < Math.abs(best - (quality || 75)) ? v : best));
  return `/api/image?src=${encodeURIComponent(objectPath)}&w=${width}&q=${q}`;
}
