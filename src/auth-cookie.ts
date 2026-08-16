import { createHmac, timingSafeEqual } from 'crypto';

const AUTH_COOKIE_NAME = 'setlists_auth';

function authSecret(): string {
  return process.env.SESSION_SECRET || 'setlists-manager-secret-change-in-production';
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export interface AuthPayload {
  userId: number;
  email: string;
  exp: number;
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function createAuthToken(userId: number, email: string, maxAgeMs: number): string {
  const payload: AuthPayload = {
    userId,
    email,
    exp: Date.now() + maxAgeMs,
  };
  const body = base64Url(JSON.stringify(payload));
  const sig = createHmac('sha256', authSecret()).update(body).digest();
  return `${body}.${base64Url(sig)}`;
}

export function parseAuthToken(token: string | undefined): AuthPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = createHmac('sha256', authSecret()).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((sig.length + 3) % 4), 'base64');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(body)) as AuthPayload;
    if (!payload.userId || !payload.email || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return undefined;
}
