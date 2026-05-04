import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api/* handles its own auth (Zoho key, printer MAC, cron bearer)
  if (pathname.startsWith('/api/')) return NextResponse.next();
  if (pathname === '/login') return NextResponse.next();

  const cookie = req.cookies.get('admin_session')?.value;
  if (!cookie || cookie !== process.env.ADMIN_COOKIE_SECRET) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
