import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, restAs } from '@/lib/server/rest';

export async function GET() {
  try {
    const { data, error } = await restAs('anon').from('site_info').select('*').eq('id', 1).single();
    if (error && error.code !== 'PGRST116') throw error;
    return NextResponse.json(data || {});
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Admin only: the site text and social links.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const { type, ...body } = await request.json();

       const updatePayload: any = { updated_at: new Date().toISOString() };
    if (type === "texts") {
      updatePayload.short_description = body.short_description;
      updatePayload.long_description = body.long_description;
    } else if (type === "socials") {
      updatePayload.instagram = body.instagram;
      updatePayload.youtube = body.youtube;
      updatePayload.snapchat = body.snapchat;
      updatePayload.facebook = body.facebook;
      updatePayload.whatsapp = body.whatsapp;
      updatePayload.google = body.google;
    }

    const { data, error } = await admin.rest.from('site_info').upsert({ id: 1, ...updatePayload }).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
