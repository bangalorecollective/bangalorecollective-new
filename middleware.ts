import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Pages anyone may open. Every other page is the admin panel. ('/product/' keeps its slash so the
// admin '/productreport' page is not treated as public.)
const PUBLIC_PREFIXES = ['/userinterface', '/login', '/reset-password', '/product/', '/category', '/api', '/storage'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Smooth custom route redirects & deep link compatibility (with trailing slash)
  if (pathname === '' || pathname === '/') {
    return NextResponse.redirect(new URL('/userinterface/home/', request.url), 308);
  }

  if (pathname.startsWith('/product/')) {
    const productId = pathname.replace('/product/', '').replace(/\/$/, '');
    return NextResponse.redirect(new URL(`/userinterface/product/${productId}/`, request.url), 308);
  }

  if (pathname.startsWith('/category/')) {
    const categoryId = pathname.replace('/category/', '').replace(/\/$/, '');
    return NextResponse.redirect(new URL(`/userinterface/category/${categoryId}/`, request.url), 308);
  }

  // 2. Pages keep their trailing slash, as with trailingSlash: true. API routes and uploaded
  //    files are left alone (next.config.ts sets skipTrailingSlashRedirect).
  const isDataPath = pathname.startsWith('/api/') || pathname.startsWith('/storage/');
  if (!isDataPath && !pathname.endsWith('/')) {
    // A plain URL: request.nextUrl would drop the slash again because of trailingSlash.
    const url = new URL(request.url);
    url.pathname = `${pathname}/`;
    return NextResponse.redirect(url.toString(), 308);
  }

  // 3. Admin pages need the admin session cookie. The cookie is checked properly by the API
  //    routes and the database; this only saves loading the page shell for signed-out visitors.
  const isPublicRoute = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isPublicRoute && !request.cookies.has('bc_admin')) {
    return NextResponse.redirect(new URL('/login/', request.url));
  }

  return NextResponse.next();
}

// 4. Matcher rules (Skipping static assets cleanly)
//    Uploads skip the middleware too: with a middleware in the way, Next.js keeps only the first
//    10MB of a request body, which cut off larger photos and videos. The upload route checks the
//    sign-in and its own size limits (lib/server/storage.ts).
export const config = {
  matcher: [
    '/((?!api/storage/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|css|js|map|woff|woff2|ttf|otf|mp4|webm|mp3|wav|pdf)$).*)',
  ],
};
