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
  if (env.CAREERSIGNAL_TRUSTED_SERVER_AUTH === 'true') {
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
      if (typeof principal.userId !== 'string' || !principal.userId || !email) throw new Error('Unauthorized principal.');
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
  if (payload.owner !== userId || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) throw new Error('Search handle expired or unauthorized.');
  if (typeof payload.searchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.searchId)) throw new Error('Invalid search handle.');
  return { searchId: payload.searchId };
}

function secureAssetResponse(response, env) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  const connectOrigins = [env.CAREERSIGNAL_PUBLIC_API_BASE_URL, env.CAREERSIGNAL_COGNITO_DOMAIN]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.origin : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  headers.set('content-security-policy', `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' ${connectOrigins.join(' ')}; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
  headers.set('strict-transport-security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function logoResponse(status, cacheControl = 'no-store', additionalHeaders = {}) {
  return new Response(null, {
    status,
    headers: {
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...additionalHeaders,
    },
  });
}

function normalizeLogoDomain(value) {
  const domain = value.toLowerCase().replace(/^www\./, '');
  if (!domain || domain.length > 253 || domain.endsWith('.')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  const topLevelDomain = labels[labels.length - 1];
  if (topLevelDomain.length < 2 || !/^[a-z]/.test(topLevelDomain)) return null;
  return domain;
}

async function handleCompanyLogo(request, env, url) {
  if (request.method !== 'GET') return logoResponse(405);
  if (url.search) return logoResponse(400);

  const match = url.pathname.match(/^\/logos\/([^/]+)$/);
  if (!match) return logoResponse(404);

  let requestedDomain;
  try {
    requestedDomain = decodeURIComponent(match[1]);
  } catch {
    return logoResponse(400);
  }
  const domain = normalizeLogoDomain(requestedDomain);
  if (!domain) return logoResponse(400);

  const token = env.LOGO_DEV_PUBLISHABLE_KEY;
  if (typeof token !== 'string' || !token.trim()) return logoResponse(503);

  const logoUrl = new URL(`https://img.logo.dev/${domain}`);
  logoUrl.search = new URLSearchParams({
    token: token.trim(),
    size: '128',
    format: 'png',
    fallback: '404',
  }).toString();

  try {
    const upstream = await fetch(logoUrl, {
      headers: {
        accept: 'image/png',
        referer: `${new URL(request.url).origin}/`,
      },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (upstream.status === 404) return logoResponse(404, 'public, max-age=300, s-maxage=300');
    if (!upstream.ok) {
      console.warn('Logo.dev logo request returned a non-success status.', { domain, status: upstream.status });
      return logoResponse(upstream.status);
    }

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(contentType)) {
      console.warn('Logo.dev returned an unexpected image content type.', { domain, contentType });
      return logoResponse(502, 'no-store', { 'x-logo-dev-content-type': contentType || 'missing' });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.warn('Logo.dev logo request failed before returning an image.', {
      domain,
      errorName: error?.name || 'Error',
    });
    return logoResponse(502);
  }
}

function validateRequestOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.method === 'GET';
}

function backendConfiguration(env) {
  if (!env.CAREERSIGNAL_AWS_API_URL || !env.CAREERSIGNAL_GATEWAY_HMAC_KEY || !env.CAREERSIGNAL_STATUS_ENCRYPTION_KEY) {
    throw new Error('Backend gateway configuration is incomplete.');
  }
  if (new TextEncoder().encode(env.CAREERSIGNAL_GATEWAY_HMAC_KEY).length < 32) {
    throw new Error('The gateway signing key is too short.');
  }
  hexToBytes(env.CAREERSIGNAL_STATUS_ENCRYPTION_KEY);
  const base = new URL(env.CAREERSIGNAL_AWS_API_URL);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Backend URL must be an HTTPS origin only.');
  }
  return base;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function callAwsApi(base, env, userId, method, path, body = new Uint8Array(), contentType = '') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const digest = bytesToHex(await crypto.subtle.digest('SHA-256', body));
  const canonical = [method.toUpperCase(), path, timestamp, nonce, userId, digest].join('\n');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.CAREERSIGNAL_GATEWAY_HMAC_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(canonical)));
  const headers = new Headers({
    'x-careersignal-timestamp': timestamp,
    'x-careersignal-nonce': nonce,
    'x-careersignal-user': userId,
    'x-careersignal-signature': signature,
    accept: 'application/json',
  });
  if (contentType) headers.set('content-type', contentType);
  return fetch(new URL(path, base), {
    method,
    headers,
    body: body.byteLength ? body : undefined,
    redirect: 'error',
    cache: 'no-store',
  });
}

async function apiError(response, fallback) {
  try {
    const body = await response.json();
    if (typeof body.error === 'string') return body.error;
  } catch {
    // Return the fixed fallback; never expose an upstream page or response body.
  }
  return fallback;
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
    return json({ error: 'The AWS gateway is not configured.' }, 503);
  }

  let searchPayload;
  if (contentType.startsWith('multipart/form-data;')) {
    let form;
    try {
      form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    } catch {
      return json({ error: 'Upload a valid PDF and preferences form.' }, 400);
    }
    const file = form.get('cv');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'The PDF upload is missing.' }, 400);
    if (!(file.name || '').toLowerCase().endsWith('.pdf')) return json({ error: 'Only PDF files are supported.' }, 415);
    if (file.size < 1 || file.size > 10 * 1024 * 1024) return json({ error: 'PDF exceeds the 10 MB limit.' }, 413);

    let preferences = {};
    const rawPreferences = form.get('preferences');
    if (typeof rawPreferences === 'string' && rawPreferences) {
      if (new TextEncoder().encode(rawPreferences).byteLength > 10000) return json({ error: 'Preferences exceed the 10 KB limit.' }, 413);
      try {
        preferences = JSON.parse(rawPreferences);
      } catch {
        return json({ error: 'Preferences must contain valid JSON.' }, 400);
      }
    }
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      return json({ error: 'Preferences must be a JSON object.' }, 400);
    }

    const uploadRequest = encoder.encode(JSON.stringify({ contentType: 'application/pdf', size: file.size }));
    let uploadResponse;
    try {
      uploadResponse = await callAwsApi(base, env, userId, 'POST', '/api/uploads', uploadRequest, 'application/json');
    } catch {
      return json({ error: 'AWS could not prepare the PDF upload. Retry shortly.' }, 502);
    }
    if (!uploadResponse.ok) return json({ error: await apiError(uploadResponse, 'AWS could not prepare the PDF upload.') }, uploadResponse.status);

    let upload;
    try {
      upload = await uploadResponse.json();
      if (typeof upload.uploadUrl !== 'string' || typeof upload.objectKey !== 'string') throw new Error('Invalid upload response.');
    } catch {
      return json({ error: 'AWS returned an invalid upload response.' }, 502);
    }

    let uploaded;
    try {
      const pdfBytes = await file.arrayBuffer();
      if (pdfBytes.byteLength !== file.size || new TextDecoder().decode(pdfBytes.slice(0, 5)) !== '%PDF-') {
        return json({ error: 'The uploaded file is not a valid PDF.' }, 415);
      }
      uploaded = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: pdfBytes,
        redirect: 'error',
      });
    } catch {
      return json({ error: 'The PDF could not be uploaded to temporary storage.' }, 502);
    }
    if (!uploaded.ok) return json({ error: 'The PDF could not be uploaded to temporary storage.' }, 502);
    searchPayload = { cvObjectKey: upload.objectKey, preferences };
  } else {
    searchPayload = new TextDecoder().decode(body);
  }

  const requestBody = typeof searchPayload === 'string' ? encoder.encode(searchPayload) : encoder.encode(JSON.stringify(searchPayload));
  let upstream;
  try {
    upstream = await callAwsApi(base, env, userId, 'POST', '/api/searches', requestBody, 'application/json');
  } catch {
    return json({ error: 'AWS could not start the search. Retry shortly.' }, 502);
  }
  if (!upstream.ok) return json({ error: await apiError(upstream, 'AWS could not start the search.') }, upstream.status);

  let started;
  try {
    started = await upstream.json();
  } catch {
    return json({ error: 'AWS returned an invalid workflow response.' }, 502);
  }
  if (typeof started.searchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(started.searchId)) {
    return json({ error: 'AWS did not return a valid search handle.' }, 502);
  }

  try {
    const searchId = await sealHandle({
      searchId: started.searchId,
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
  let base;
  try {
    workflow = await openHandle(handle, env, userId);
    base = backendConfiguration(env);
  } catch {
    return json({ error: 'This search link is invalid, expired, or belongs to another account.' }, 404);
  }
  let response;
  try {
    response = await callAwsApi(base, env, userId, 'GET', `/api/searches/${workflow.searchId}`);
  } catch {
    return json({ error: 'Could not retrieve the workflow status. Retry shortly.' }, 502);
  }
  if (!response.ok) return json({ error: await apiError(response, 'Could not retrieve the workflow status.') }, response.status === 404 ? 404 : 502);
  try {
    const status = await response.json();
    if (!['Running', 'Completed', 'Failed', 'Terminated', 'Canceled'].includes(status.status)) throw new Error('Invalid workflow status.');
    if (status.status === 'Completed' && (!status.result || typeof status.result !== 'object')) throw new Error('Missing workflow result.');
    return json(status);
  } catch {
    return json({ error: 'AWS returned an invalid workflow status.' }, 502);
  }
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
    response = await callAwsApi(base, env, userId, 'DELETE', `/api/searches/${workflow.searchId}`);
  } catch {
    return json({ error: 'AWS could not delete this search. Retry shortly.' }, 502);
  }
  if (!response.ok) return json({ error: await apiError(response, 'AWS could not delete the search.') }, response.status === 409 ? 409 : response.status === 404 ? 404 : 502);
  return json({ deleted: true });
}

function handleRuntimeConfiguration(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  const config = {
    apiBaseUrl: env.CAREERSIGNAL_PUBLIC_API_BASE_URL,
    cognitoDomain: env.CAREERSIGNAL_COGNITO_DOMAIN,
    cognitoClientId: env.CAREERSIGNAL_COGNITO_CLIENT_ID,
    linkedinUrl: env.CAREERSIGNAL_PUBLIC_LINKEDIN_URL || '',
    githubUrl: env.CAREERSIGNAL_PUBLIC_GITHUB_URL || '',
  };
  const requiredValues = [config.apiBaseUrl, config.cognitoDomain, config.cognitoClientId];
  if (requiredValues.some(value => typeof value !== 'string' || !value.trim())) {
    return json({ error: 'Public frontend configuration is incomplete.' }, 503);
  }

  try {
    const apiUrl = new URL(config.apiBaseUrl);
    const cognitoUrl = new URL(config.cognitoDomain);
    const socialUrls = [config.linkedinUrl, config.githubUrl].filter(Boolean).map(value => new URL(value));
    if (
      apiUrl.protocol !== 'https:' || apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password ||
      cognitoUrl.protocol !== 'https:' || cognitoUrl.pathname !== '/' || cognitoUrl.search || cognitoUrl.hash || cognitoUrl.username || cognitoUrl.password ||
      socialUrls.some(value => value.protocol !== 'https:' || value.username || value.password)
    ) {
      return json({ error: 'Public frontend configuration is invalid.' }, 503);
    }
  } catch {
    return json({ error: 'Public frontend configuration is invalid.' }, 503);
  }

  return json(config);
}

async function handleApi(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/api/access-login' && request.method === 'GET') {
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
    if (url.pathname === '/runtime-config.json') return handleRuntimeConfiguration(request, env);
    if (url.pathname === '/logos' || url.pathname.startsWith('/logos/')) return handleCompanyLogo(request, env, url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return secureAssetResponse(await env.ASSETS.fetch(request), env);
  },
};
