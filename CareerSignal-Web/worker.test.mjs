import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const ISSUER = 'https://team.cloudflareaccess.com';
const AUDIENCE = 'careersignal-access-audience';
const FUNCTION_ORIGIN = 'https://function.example.azurewebsites.net';
const INSTANCE_ID = '2cf4c1c0-4a99-4b4d-9f2e-342a7f6d7091';

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function accessAssertion() {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })));
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    iss: ISSUER,
    aud: [AUDIENCE],
    sub: 'access-user-1',
    email: 'baha.edabdelkhalek@gmail.com',
    exp: Math.floor(Date.now() / 1000) + 300,
    nbf: Math.floor(Date.now() / 1000) - 10,
  })));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signingInput));
  return { token: `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`, jwk: publicJwk };
}

const env = {
  ASSETS: { fetch: async () => new Response('static app') },
  ACCESS_ISSUER: ISSUER,
  ACCESS_AUD: AUDIENCE,
  CAREERSIGNAL_ALLOWED_EMAIL: 'baha.edabdelkhalek@gmail.com',
  CAREERSIGNAL_FUNCTION_APP_URL: FUNCTION_ORIGIN,
  CAREERSIGNAL_FUNCTION_KEY: 'test-function-key',
  CAREERSIGNAL_STATUS_ENCRYPTION_KEY: 'ab'.repeat(32),
  SEARCH_SUBMIT_LIMITER: { limit: async () => ({ success: true }) },
};

test('serves static assets and keeps protected search handles opaque and owner-bound', async () => {
  const { token, jwk } = await accessAssertion();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === `${ISSUER}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url === `${FUNCTION_ORIGIN}/api/career-signal`) {
      return Response.json({
        id: INSTANCE_ID,
        statusQueryGetUri: `${FUNCTION_ORIGIN}/runtime/webhooks/durabletask/instances/${INSTANCE_ID}?code=private-status-secret`,
      }, { status: 202 });
    }
    if (url.startsWith(`${FUNCTION_ORIGIN}/runtime/webhooks/durabletask/instances/`)) {
      return Response.json({ runtimeStatus: 'Completed', output: { analysis: {}, companies: [], contacts: [], drafts: { results: [] } } });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };

  try {
    const staticResponse = await worker.fetch(new Request('https://careersignal.example/'), env);
    assert.equal(await staticResponse.text(), 'static app');

    const unauthenticated = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: { origin: 'https://careersignal.example', 'content-type': 'application/json' },
      body: JSON.stringify({ cvText: 'test cv', preferences: {} }),
    }), env);
    assert.equal(unauthenticated.status, 401);

    const limited = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: {
        origin: 'https://careersignal.example',
        'cf-access-jwt-assertion': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cvText: 'test cv', preferences: {} }),
    }), { ...env, SEARCH_SUBMIT_LIMITER: { limit: async () => ({ success: false }) } });
    assert.equal(limited.status, 429);

    const started = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: {
        origin: 'https://careersignal.example',
        'cf-access-jwt-assertion': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cvText: 'test cv', preferences: {} }),
    }), env);
    assert.equal(started.status, 202);
    const startBody = await started.json();
    assert.equal(typeof startBody.searchId, 'string');
    assert.ok(!JSON.stringify(startBody).includes('private-status-secret'));
    assert.ok(!JSON.stringify(startBody).includes('test-function-key'));
    assert.equal(new Headers(requests.find(request => request.url.endsWith('/api/career-signal')).init.headers).get('x-functions-key'), 'test-function-key');

    const poll = await worker.fetch(new Request(`https://careersignal.example/api/searches/${encodeURIComponent(startBody.searchId)}`, {
      headers: { 'cf-access-jwt-assertion': token },
    }), env);
    assert.equal(poll.status, 200);
    const result = await poll.json();
    assert.equal(result.status, 'Completed');
    assert.equal(result.result.contacts.length, 0);
    assert.ok(!JSON.stringify(result).includes('private-status-secret'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
