import { Issuer, generators, Client } from 'openid-client';

const GOOGLE_ISSUER = 'https://accounts.google.com';

let googleClientPromise: Promise<Client> | null = null;

function requireEnv(name: string): string {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

async function getGoogleClient(): Promise<Client> {
  if (!googleClientPromise) {
    googleClientPromise = (async () => {
      const issuer = await Issuer.discover(GOOGLE_ISSUER);
      return new issuer.Client({
        client_id: requireEnv('GOOGLE_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
        response_types: ['code'],
      });
    })();
  }
  return googleClientPromise;
}

export function createOAuthState(): string {
  return generators.state();
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

export async function buildGoogleAuthorizationUrl(options: {
  baseUrl: string;
  state: string;
  codeChallenge: string;
}): Promise<string> {
  const client = await getGoogleClient();
  return client.authorizationUrl({
    redirect_uri: getGoogleRedirectUri(options.baseUrl),
    scope: 'openid email profile',
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
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
  const client = await getGoogleClient();
  const params = client.callbackParams(options.callbackUrl);
  const tokenSet = await client.callback(getGoogleRedirectUri(options.baseUrl), params, {
    state: options.expectedState,
    code_verifier: options.codeVerifier,
  });

  const claims = tokenSet.claims();
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  const name = typeof claims.name === 'string' ? claims.name.trim() : '';
  const emailVerified = claims.email_verified === true;

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
