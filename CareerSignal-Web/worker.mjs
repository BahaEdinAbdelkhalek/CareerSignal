const encoder = new TextEncoder();
const MAX_REQUEST_BYTES = 11 * 1024 * 1024;
const HANDLE_TTL_SECONDS = 2 * 60 * 60;
const JWKS_TTL_MS = 5 * 60 * 1000;

let cachedJwks;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    },
  });
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid token encoding.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
}

function parseIssuer(value) {
  const issuer = new URL(value);
  if (issuer.protocol !== 'https:' || issuer.pathname !== '/' || issuer.search || issuer.hash) {
    throw new Error('Invalid Access issuer configuration.');
  }
  return issuer.origin;
}

async function getAccessJwks(issuer) {
  if (cachedJwks?.issuer === issuer && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
  if (!response.ok) throw new Error('Could not load Access verification keys.');
  const body = await response.json();
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('Access returned no verification keys.');
  cachedJwks = { issuer, keys: body.keys, expiresAt: Date.now() + JWKS_TTL_MS };
  return body.keys;
}

async function authenticate(request, env) {
  if (env.CAREERSIGNAL_AUTH_PROVIDER === 'azure') {
    if (!env.CAREERSIGNAL_ALLOWED_EMAIL) {
      return { error: json({ error: 'Live search authentication is not configured.' }, 503) };
    }
    const encodedPrincipal = request.headers.get('x-ms-client-principal');
    if (!encodedPrincipal) {
      return { error: json({ error: 'Sign in with the authorized account to use live search.' }, 401) };
    }
    try {
      const principal = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPrincipal.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''))));
      const claims = Array.isArray(principal.claims) ? principal.claims : [];
      const emailClaim = claims.find(claim => [
        'email', 'emails', 'preferred_username', 'upn',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      ].includes(claim.typ));
      const allowedEmail = env.CAREERSIGNAL_ALLOWED_EMAIL.toLowerCase();
      const email = [principal.userDetails, emailClaim?.val]
        .find(value => typeof value === 'string' && value.toLowerCase() === allowedEmail);
      if (typeof principal.userId !== 'string' || !principal.userId || !email) {
        throw new Error('This account is not authorized.');
      }
      return { userId: principal.userId };
    } catch {
      return { error: json({ error: 'Your sign-in could not be verified. Sign in again and retry.' }, 401) };
    }
  }

  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD || !env.CAREERSIGNAL_ALLOWED_EMAIL) {
    return { error: json({ error: 'Live search authentication is not configured.' }, 503) };
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { error: json({ error: 'Sign in with the authorized account to use live search.' }, 401) };

  try {
    const issuer = parseIssuer(env.ACCESS_ISSUER);
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid assertion.');
    const header = decodeJsonSegment(parts[0]);
    const claims = decodeJsonSegment(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported assertion.');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audiences.includes(env.ACCESS_AUD)) throw new Error('Invalid issuer or audience.');
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('Expired assertion.');
    if (typeof claims.nbf === 'number' && claims.nbf > Math.floor(Date.now() / 1000) + 60) throw new Error('Assertion is not active.');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('Missing subject.');
    if (typeof claims.email !== 'string' || claims.email.toLowerCase() !== env.CAREERSIGNAL_ALLOWED_EMAIL.toLowerCase()) {
      throw new Error('This account is not authorized.');
    }

    const keys = await getAccessJwks(issuer);
    const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) throw new Error('Unknown signing key.');
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      base64UrlDecode(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) throw new Error('Invalid signature.');
    return { userId: claims.sub };
  } catch {
    return { error: json({ error: 'Your sign-in could not be verified. Sign in again and retry.' }, 401) };
  }
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || '')) throw new Error('A 32-byte hexadecimal status key is required.');
  return Uint8Array.from(hex.match(/.{2}/g), byte => Number.parseInt(byte, 16));
}

async function encryptionKey(env, usage) {
  return crypto.subtle.importKey('raw', hexToBytes(env.CAREERSIGNAL_STATUS_ENCRYPTION_KEY), 'AES-GCM', false, [usage]);
}

async function sealHandle(payload, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env, 'encrypt');
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

async function openHandle(handle, env, userId) {
  const parts = handle.split('.');
  if (parts.length !== 2) throw new Error('Invalid search handle.');
  const key = await encryptionKey(env, 'decrypt');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(parts[0]) }, key, base64UrlDecode(parts[1]));
  const payload = JSON.parse(new TextDecoder().decode(decrypted));
  if (payload.owner !== userId || payload.expiresAt <= Date.now()) throw new Error('Search handle expired or unauthorized.');
  if (typeof payload.instanceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.instanceId)) throw new Error('Invalid search handle.');
  const statusUrl = new URL(payload.statusUrl);
  const appUrl = new URL(env.CAREERSIGNAL_FUNCTION_APP_URL);
  if (statusUrl.protocol !== 'https:' || statusUrl.origin !== appUrl.origin || !statusUrl.pathname.includes('/runtime/webhooks/durabletask/instances/')) {
    throw new Error('Invalid workflow status address.');
  }
  return { instanceId: payload.instanceId, statusUrl: statusUrl.href };
}

function secureAssetResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  headers.set('strict-transport-security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function validateRequestOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.method === 'GET';
}

function backendConfiguration(env) {
  if (!env.CAREERSIGNAL_FUNCTION_APP_URL || !env.CAREERSIGNAL_FUNCTION_KEY || !env.CAREERSIGNAL_STATUS_ENCRYPTION_KEY) {
    throw new Error('Backend gateway configuration is incomplete.');
  }
  hexToBytes(env.CAREERSIGNAL_STATUS_ENCRYPTION_KEY);
  const base = new URL(env.CAREERSIGNAL_FUNCTION_APP_URL);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Backend URL must be an HTTPS origin only.');
  }
  return base;
}

async function startSearch(request, env, userId) {
  if (!validateRequestOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (!env.SEARCH_SUBMIT_LIMITER) return json({ error: 'Search rate limiting is not configured.' }, 503);
  let allowance;
  try {
    allowance = await env.SEARCH_SUBMIT_LIMITER.limit({ key: userId });
  } catch {
    return json({ error: 'Search rate limiting is unavailable.' }, 503);
  }
  if (!allowance.success) return json({ error: 'Too many searches. Wait a minute before starting another.' }, 429);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data;') && !contentType.startsWith('application/json')) {
    return json({ error: 'Upload a PDF with preferences or send a JSON text CV.' }, 415);
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return json({ error: 'CV upload exceeds the gateway limit.' }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BYTES) return json({ error: 'CV upload exceeds the gateway limit.' }, 413);

  let base;
  try {
    base = backendConfiguration(env);
  } catch {
    return json({ error: 'The Azure gateway is not configured.' }, 503);
  }
  const endpoint = new URL('/api/career-signal', base);
  const headers = new Headers({
    'x-functions-key': env.CAREERSIGNAL_FUNCTION_KEY,
    'content-type': contentType,
    'accept': 'application/json',
  });
  let upstream;
  try {
    upstream = await fetch(endpoint, { method: 'POST', headers, body, redirect: 'manual' });
  } catch {
    return json({ error: 'Azure could not be reached. Retry shortly.' }, 502);
  }
  if (!upstream.ok) {
    return json({ error: upstream.status === 429 ? 'Azure is rate-limiting requests. Retry shortly.' : `Azure could not start the search (HTTP ${upstream.status}).` }, 502);
  }

  let start;
  try {
    start = await upstream.json();
  } catch {
    return json({ error: 'Azure returned an invalid workflow response.' }, 502);
  }
  if (typeof start.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(start.id) || typeof start.statusQueryGetUri !== 'string') {
    return json({ error: 'Azure did not return a valid workflow handle.' }, 502);
  }

  try {
    const statusUrl = new URL(start.statusQueryGetUri);
    if (statusUrl.origin !== base.origin || statusUrl.protocol !== 'https:' || !statusUrl.pathname.includes('/runtime/webhooks/durabletask/instances/')) {
      return json({ error: 'Azure returned an unexpected workflow status address.' }, 502);
    }
    const searchId = await sealHandle({
      instanceId: start.id,
      statusUrl: statusUrl.href,
      owner: userId,
      expiresAt: Date.now() + HANDLE_TTL_SECONDS * 1000,
    }, env);
    return json({ searchId, expiresInSeconds: HANDLE_TTL_SECONDS }, 202);
  } catch {
    return json({ error: 'The search started but its protected status handle could not be created.' }, 500);
  }
}

async function getSearch(request, env, userId, handle) {
  if (!validateRequestOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  let workflow;
  try {
    workflow = await openHandle(handle, env, userId);
  } catch {
    return json({ error: 'This search link is invalid, expired, or belongs to another account.' }, 404);
  }
  let statusResponse;
  try {
    statusResponse = await fetch(workflow.statusUrl, { headers: { accept: 'application/json' }, cache: 'no-store', redirect: 'manual' });
  } catch {
    return json({ error: 'Could not retrieve the workflow status. Retry shortly.' }, 502);
  }
  if (!statusResponse.ok) return json({ error: `Azure status request failed (HTTP ${statusResponse.status}).` }, 502);
  let status;
  try {
    status = await statusResponse.json();
  } catch {
    return json({ error: 'Azure returned an invalid workflow status.' }, 502);
  }
  if (status.runtimeStatus === 'Completed') {
    if (!status.output || typeof status.output !== 'object') return json({ error: 'Azure completed without a result.' }, 502);
    return json({ status: 'Completed', result: status.output });
  }
  if (['Failed', 'Terminated', 'Canceled'].includes(status.runtimeStatus)) {
    return json({ status: status.runtimeStatus, error: `The workflow ${status.runtimeStatus.toLowerCase()}.` });
  }
  return json({ status: status.runtimeStatus || 'Running' });
}

async function deleteSearch(request, env, userId, handle) {
  if (!validateRequestOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  let workflow;
  let base;
  try {
    workflow = await openHandle(handle, env, userId);
    base = backendConfiguration(env);
  } catch {
    return json({ error: 'This search link is invalid, expired, or belongs to another account.' }, 404);
  }
  let response;
  try {
    response = await fetch(new URL(`/api/career-signal/${workflow.instanceId}`, base), {
      method: 'DELETE',
      headers: { 'x-functions-key': env.CAREERSIGNAL_FUNCTION_KEY, accept: 'application/json' },
      redirect: 'manual',
    });
  } catch {
    return json({ error: 'Azure could not delete this search. Retry shortly.' }, 502);
  }
  if (!response.ok) return json({ error: response.status === 409 ? 'The workflow is still running. Deletion is not available yet.' : `Azure could not delete the search (HTTP ${response.status}).` }, response.status === 409 ? 409 : 502);
  return json({ deleted: true });
}

async function handleApi(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/api/access-login' && request.method === 'GET') {
    if (env.CAREERSIGNAL_AUTH_PROVIDER === 'azure' && !request.headers.get('x-ms-client-principal')) {
      const login = new URL('/.auth/login/aad', request.url);
      login.searchParams.set('post_login_redirect_uri', '/');
      return Response.redirect(login, 302);
    }
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;
    return Response.redirect(new URL('/', request.url), 302);
  }

  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;

  if (path === '/api/searches' && request.method === 'POST') return startSearch(request, env, auth.userId);
  const match = path.match(/^\/api\/searches\/([A-Za-z0-9_.-]+)$/);
  if (match && request.method === 'GET') return getSearch(request, env, auth.userId, match[1]);
  if (match && request.method === 'DELETE') return deleteSearch(request, env, auth.userId, match[1]);
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return secureAssetResponse(await env.ASSETS.fetch(request));
  },
};
