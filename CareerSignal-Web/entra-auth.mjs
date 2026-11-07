import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const STATE_COOKIE = '__Host-careersignal-oauth';
const SESSION_COOKIE = '__Host-careersignal-session';
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 4 * 60 * 60;

function config(env) {
  const required = [
    'CAREERSIGNAL_ENTRA_TENANT_ID',
    'CAREERSIGNAL_ENTRA_CLIENT_ID',
    'CAREERSIGNAL_ENTRA_CLIENT_SECRET',
    'CAREERSIGNAL_ALLOWED_EMAIL',
    'CAREERSIGNAL_SESSION_ENCRYPTION_KEY',
    'CAREERSIGNAL_PUBLIC_ORIGIN',
  ];
  if (required.some(name => !env[name])) throw new Error('Microsoft sign-in is not fully configured.');
  if (!/^[0-9a-f]{64}$/i.test(env.CAREERSIGNAL_SESSION_ENCRYPTION_KEY)) {
    throw new Error('The session encryption key must be 32 bytes encoded as 64 hexadecimal characters.');
  }
  const origin = new URL(env.CAREERSIGNAL_PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('The public origin must be an HTTPS origin without a path.');
  }
  return {
    tenantId: env.CAREERSIGNAL_ENTRA_TENANT_ID,
    clientId: env.CAREERSIGNAL_ENTRA_CLIENT_ID,
    clientSecret: env.CAREERSIGNAL_ENTRA_CLIENT_SECRET,
    allowedEmail: env.CAREERSIGNAL_ALLOWED_EMAIL.toLowerCase(),
    key: Buffer.from(env.CAREERSIGNAL_SESSION_ENCRYPTION_KEY, 'hex'),
    origin: origin.origin,
    authority: `https://login.microsoftonline.com/${env.CAREERSIGNAL_ENTRA_TENANT_ID}`,
    issuer: `https://login.microsoftonline.com/${env.CAREERSIGNAL_ENTRA_TENANT_ID}/v2.0`,
    callbackUrl: `${origin.origin}/api/auth/callback`,
  };
}

function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function unseal(value, key) {
  const [ivPart, tagPart, encryptedPart, ...extra] = (value || '').split('.');
  if (!ivPart || !tagPart || !encryptedPart || extra.length) throw new Error('Invalid encrypted cookie.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ivPart, 'base64url'), key);
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8'));
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator > 0 && entry.slice(0, separator).trim() === name) return entry.slice(separator + 1).trim();
  }
  return undefined;
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function redirect(location, setCookie) {
  const headers = new Headers({ location, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(null, { status: 302, headers });
}

function errorResponse(message, status = 503) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    },
  });
}

function clearStateCookie() {
  return cookie(STATE_COOKIE, '', 0);
}

export async function beginMicrosoftLogin(env) {
  let settings;
  try {
    settings = config(env);
  } catch {
    return errorResponse('Microsoft sign-in is not configured on the server.');
  }

  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(`${settings.authority}/oauth2/v2.0/authorize`);
  authorizeUrl.searchParams.set('client_id', settings.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', settings.callbackUrl);
  authorizeUrl.searchParams.set('response_mode', 'query');
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const stateCookie = cookie(STATE_COOKIE, seal({ state, nonce, verifier, expiresAt: Date.now() + STATE_TTL_SECONDS * 1000 }, settings.key), STATE_TTL_SECONDS);
  return redirect(authorizeUrl.href, stateCookie);
}

export async function completeMicrosoftLogin(request, env) {
  let settings;
  try {
    settings = config(env);
  } catch {
    return errorResponse('Microsoft sign-in is not configured on the server.');
  }

  const url = new URL(request.url);
  const clearCookie = clearStateCookie();
  if (url.searchParams.has('error')) return redirect(`${settings.origin}/?signin=failed`, clearCookie);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  let loginState;
  try {
    loginState = unseal(cookieValue(request, STATE_COOKIE), settings.key);
  } catch {
    return errorResponse('Sign-in expired or could not be verified. Start again.', 400);
  }
  if (!code || !returnedState || returnedState !== loginState.state || loginState.expiresAt <= Date.now()) {
    return errorResponse('Sign-in expired or could not be verified. Start again.', 400);
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(`${settings.authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: settings.callbackUrl,
        code_verifier: loginState.verifier,
        scope: 'openid profile email',
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return errorResponse('Microsoft sign-in could not be reached. Retry shortly.', 502);
  }
  if (!tokenResponse.ok) return errorResponse('Microsoft rejected the sign-in exchange. Check the app registration and callback URL.', 401);

  let tokenBody;
  try {
    tokenBody = await tokenResponse.json();
    if (typeof tokenBody.id_token !== 'string') throw new Error('Missing identity token.');
    const jwks = createRemoteJWKSet(new URL(`${settings.authority}/discovery/v2.0/keys`));
    const { payload } = await jwtVerify(tokenBody.id_token, jwks, {
      issuer: settings.issuer,
      audience: settings.clientId,
      nonce: loginState.nonce,
      clockTolerance: 5,
    });
    const emails = [payload.email, payload.preferred_username, payload.upn]
      .filter(value => typeof value === 'string')
      .map(value => value.toLowerCase());
    if (!emails.includes(settings.allowedEmail) || typeof payload.sub !== 'string' || !payload.sub) {
      return errorResponse('This Microsoft account is not allowed to run live searches.', 403);
    }
    const session = seal({
      userId: typeof payload.oid === 'string' ? payload.oid : payload.sub,
      email: settings.allowedEmail,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    }, settings.key);
    const headers = new Headers({ location: `${settings.origin}/`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    headers.append('set-cookie', clearCookie);
    headers.append('set-cookie', cookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS));
    return new Response(null, { status: 302, headers });
  } catch {
    return errorResponse('Microsoft identity could not be verified. Check the tenant and app registration.', 401);
  }
}

export function readMicrosoftSession(request, env) {
  try {
    const settings = config(env);
    const session = unseal(cookieValue(request, SESSION_COOKIE), settings.key);
    if (session.expiresAt <= Date.now() || typeof session.userId !== 'string' || session.email !== settings.allowedEmail) return null;
    return { userId: session.userId, email: session.email };
  } catch {
    return null;
  }
}

export function clientPrincipalHeader(session) {
  const principal = {
    identityProvider: 'aad',
    userId: session.userId,
    userDetails: session.email,
    claims: [{ typ: 'email', val: session.email }],
  };
  return Buffer.from(JSON.stringify(principal)).toString('base64');
}
