'use server';

import { rm } from 'fs/promises';
import { cookies } from 'next/headers';
import { restAs } from '@/lib/server/rest';
import { readSessionToken, SESSION_COOKIE } from '@/lib/server/session';
import { filePath } from '@/lib/server/storage';

// Server actions can be called by anyone who finds them, so both require an admin session.
async function adminRest() {
  const token = (await cookies()).get(SESSION_COOKIE.admin)?.value;
  const session = await readSessionToken(token, 'admin');
  if (!session) throw new Error('Unauthorized');
  return restAs('admin_user', session.user_id);
}

// This function now only handles DB registration
export async function registerImageInDb(productId: string, publicUrl: string) {
  const db = await adminRest();
  const { error } = await db.from('product_images').insert([{ product_id: productId, image_url: publicUrl }]);
  if (error) throw new Error(error.message);
  return { success: true };
}

// Helper to delete old records
export async function clearOldImages(productId: string) {
  const db = await adminRest();
  const { data: existing } = await db.from('product_images').select('id, image_url').eq('product_id', productId);
  if (existing) {
    for (const img of existing) {
      // Path inside the bucket, e.g. ".../public/product-images/folder/a.jpg" -> "folder/a.jpg".
      const objectPath = decodeURIComponent(String(img.image_url).split('/product-images/').pop() ?? '');
      const file = objectPath ? filePath('product-images', objectPath) : null;
      if (file) await rm(file, { force: true });
      await db.from('product_images').delete().eq('id', img.id);
    }
  }
}
