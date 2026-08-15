import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function requireEnv(name: string): string {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function oauthSigningSecret(): string {
  return process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || 'setlists-manager-secret-change-in-production';
}

export function getAppUrl(): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export function getGoogleRedirectUri(baseUrl: string): string {
  return `${getAppUrl()}${baseUrl}/auth/google/callback`;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean((process.env.GOOGLE_CLIENT_ID || '').trim() && (process.env.GOOGLE_CLIENT_SECRET || '').trim());
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/** Signed state that carries the PKCE verifier — no server-side session/memory required. */
export function createSignedOAuthState(codeVerifier: string): string {
  const payload = {
    v: codeVerifier,
    n: base64Url(randomBytes(16)),
    e: Date.now() + OAUTH_STATE_TTL_MS,
  };
  const body = base64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', oauthSigningSecret()).update(body).digest();
  return `${body}.${base64Url(sig)}`;
}

export function parseSignedOAuthState(state: string | undefined): string | null {
  if (!state) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;

  const expected = createHmac('sha256', oauthSigningSecret()).update(body).digest();
  let provided: Buffer;
  try {
    provided = fromBase64Url(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(body).toString('utf8')) as { v?: string; e?: number };
    if (!payload.v || typeof payload.v !== 'string') return null;
    if (!payload.e || payload.e < Date.now()) return null;
    return payload.v;
  } catch {
    return null;
  }
}

export async function buildGoogleAuthorizationUrl(options: {
  baseUrl: string;
  state: string;
  codeChallenge: string;
}): Promise<string> {
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: getGoogleRedirectUri(options.baseUrl),
    response_type: 'code',
    scope: 'openid email profile',
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeGoogleCallback(options: {
  baseUrl: string;
  callbackUrl: string;
  expectedState: string;
  codeVerifier: string;
}): Promise<GoogleProfile> {
  const callback = new URL(options.callbackUrl);
  const error = callback.searchParams.get('error');
  if (error) {
    throw new Error(`Google OAuth error: ${error}`);
  }

  const state = callback.searchParams.get('state') || '';
  if (!state || state !== options.expectedState) {
    throw new Error('Invalid OAuth state');
  }

  const code = callback.searchParams.get('code');
  if (!code) {
    throw new Error('Missing OAuth authorization code');
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: getGoogleRedirectUri(options.baseUrl),
      grant_type: 'authorization_code',
      code_verifier: options.codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const details = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${details}`);
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('Token response did not include access_token');
  }

  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userInfoResponse.ok) {
    const details = await userInfoResponse.text();
    throw new Error(`UserInfo request failed (${userInfoResponse.status}): ${details}`);
  }

  const profile = (await userInfoResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };

  const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  const sub = typeof profile.sub === 'string' ? profile.sub : '';
  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  const emailVerified = profile.email_verified === true || profile.email_verified === 'true';

  if (!sub || !email) {
    throw new Error('Google account did not return a verified email identity');
  }

  return {
    sub,
    email,
    emailVerified,
    name,
  };
}
