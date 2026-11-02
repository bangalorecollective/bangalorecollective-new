// Resizes every uploaded image ahead of time at the sizes pages use most, so the first visitor to
// a page with hundreds of photos (POS, restock, categories) does not wait for them to be made.
// Runs inside the app container and asks the app itself, so it fills the same cache:
//
//   docker compose exec -T app node - < warm-image-cache.mjs
//
// Safe to stop and run again: images already in the cache come back immediately.
import { readdir } from "fs/promises";
import path from "path";

const ROOT = "/data/uploads";
const BUCKETS = ["product-images", "brand-images", "categories", "hero-images", "subcategory-images", "site-assets", "payment-assets"];
const WIDTHS = [128, 384, 640, 768];
const IMAGE = /\.(jpe?g|png|webp|avif|heic|heif)$/i;
const PARALLEL = 3;

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else if (IMAGE.test(entry.name)) out.push(full);
  }
  return out;
}

const jobs = [];
for (const bucket of BUCKETS) {
  for (const file of await files(path.join(ROOT, bucket)).catch(() => [])) {
    const src = path.relative(ROOT, file);
    for (const w of WIDTHS) jobs.push(`http://localhost:3000/api/image?src=${encodeURIComponent(src)}&w=${w}&q=75`);
  }
}

let done = 0, failed = 0;
const started = Date.now();
async function worker() {
  while (jobs.length) {
    const url = jobs.shift();
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) failed++;
    await res?.arrayBuffer().catch(() => {});
    if (++done % 500 === 0) console.log(`${done} done, ${failed} failed, ${Math.round((Date.now() - started) / 1000)}s`);
  }
}
const total = jobs.length;
console.log(`${total} resized images to prepare`);
await Promise.all(Array.from({ length: PARALLEL }, worker));
console.log(`finished: ${done} of ${total}, ${failed} failed, ${Math.round((Date.now() - started) / 1000)}s`);
