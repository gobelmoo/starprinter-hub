'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE_NAME = 'admin_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function loginAction(formData: FormData) {
  const password = String(formData.get('password') ?? '');

  if (
    !process.env.ADMIN_PASSWORD ||
    !process.env.ADMIN_COOKIE_SECRET ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    redirect('/login?error=1');
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: COOKIE_NAME,
    value: process.env.ADMIN_COOKIE_SECRET,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });

  redirect('/');
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect('/login');
}
