import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { verifyGatewayRequest } from '../aws/lib/gateway-auth.mjs';

const ISSUER = 'https://team.cloudflareaccess.com';
const AUDIENCE = 'careersignal-access-audience';
const AWS_API_ORIGIN = 'https://aws-api.example';
const SEARCH_ID = '2cf4c1c0-4a99-4b4d-9f2e-342a7f6d7091';
const ALLOWED_EMAIL = 'operator@example.com';
const GATEWAY_KEY = 'test-gateway-key-that-is-at-least-32-bytes-long';

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function makeAccessAssertion({ email = ALLOWED_EMAIL, sub = 'access-user-1', pair: existingPair } = {}) {
  const pair = existingPair || await crypto.subtle.generateKey({
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
    sub,
    email,
    exp: Math.floor(Date.now() / 1000) + 300,
    nbf: Math.floor(Date.now() / 1000) - 10,
  })));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signingInput));
  return { token: `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`, jwk: publicJwk, pair };
}

const sharedAccessAssertion = makeAccessAssertion();

function createEnvironment() {
  return {
    ASSETS: { fetch: async () => new Response('static app') },
    ACCESS_ISSUER: ISSUER,
    ACCESS_AUD: AUDIENCE,
    CAREERSIGNAL_ALLOWED_EMAIL: ALLOWED_EMAIL,
    CAREERSIGNAL_AWS_API_URL: AWS_API_ORIGIN,
    CAREERSIGNAL_GATEWAY_HMAC_KEY: GATEWAY_KEY,
    CAREERSIGNAL_STATUS_ENCRYPTION_KEY: 'ab'.repeat(32),
    SEARCH_SUBMIT_LIMITER: { limit: async () => ({ success: true }) },
  };
}

function toApiEvent(url, init) {
  const body = init.body ? Buffer.from(init.body).toString('utf8') : '';
  return {
    rawPath: new URL(url).pathname,
    body,
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    requestContext: { http: { method: init.method } },
  };
}

test('serves assets and proxies owner-bound, signed workflow requests to AWS', async () => {
  const { token, jwk } = await sharedAccessAssertion;
  const env = createEnvironment();
  const originalFetch = globalThis.fetch;
  const apiRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${ISSUER}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith(AWS_API_ORIGIN)) {
      apiRequests.push({ url, init });
      const verified = await verifyGatewayRequest(toApiEvent(url, init), {
        secret: GATEWAY_KEY,
        consumeNonce: async () => true,
      });
      assert.equal(verified.ok, true);
      assert.equal(verified.userId, 'access-user-1');
      if (url === `${AWS_API_ORIGIN}/api/searches` && init.method === 'POST') {
        assert.deepEqual(JSON.parse(verified.body.toString()), { cvText: 'fictional CV', preferences: {} });
        return Response.json({ searchId: SEARCH_ID, expiresInSeconds: 7200 }, { status: 202 });
      }
      if (url === `${AWS_API_ORIGIN}/api/searches/${SEARCH_ID}` && init.method === 'GET') {
        return Response.json({ status: 'Completed', result: { analysis: {}, companies: [], contacts: [], drafts: { results: [] }, summary: {} } });
      }
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };

  try {
    const staticResponse = await worker.fetch(new Request('https://careersignal.example/'), env);
    assert.equal(await staticResponse.text(), 'static app');

    const unauthenticated = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: { origin: 'https://careersignal.example', 'content-type': 'application/json' },
      body: JSON.stringify({ cvText: 'fictional CV', preferences: {} }),
    }), env);
    assert.equal(unauthenticated.status, 401);

    const limited = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: {
        origin: 'https://careersignal.example',
        'cf-access-jwt-assertion': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cvText: 'fictional CV', preferences: {} }),
    }), { ...env, SEARCH_SUBMIT_LIMITER: { limit: async () => ({ success: false }) } });
    assert.equal(limited.status, 429);

    const started = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: {
        origin: 'https://careersignal.example',
        'cf-access-jwt-assertion': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cvText: 'fictional CV', preferences: {} }),
    }), env);
    assert.equal(started.status, 202);
    const startBody = await started.json();
    assert.equal(typeof startBody.searchId, 'string');
    assert.notEqual(startBody.searchId, SEARCH_ID);
    assert.ok(!JSON.stringify(startBody).includes(GATEWAY_KEY));

    const poll = await worker.fetch(new Request(`https://careersignal.example/api/searches/${encodeURIComponent(startBody.searchId)}`, {
      headers: { 'cf-access-jwt-assertion': token },
    }), env);
    assert.equal(poll.status, 200);
    const result = await poll.json();
    assert.equal(result.status, 'Completed');
    assert.equal(result.result.contacts.length, 0);
    assert.ok(apiRequests.some(item => item.url.endsWith('/api/searches')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prevents a different authenticated owner from polling or deleting a search handle', async () => {
  const { token, jwk, pair } = await sharedAccessAssertion;
  const other = await makeAccessAssertion({ sub: 'access-user-2', pair });
  const env = createEnvironment();
  const originalFetch = globalThis.fetch;
  const apiRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${ISSUER}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url === `${AWS_API_ORIGIN}/api/searches` && init.method === 'POST') {
      apiRequests.push(url);
      return Response.json({ searchId: SEARCH_ID, expiresInSeconds: 7200 }, { status: 202 });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };

  try {
    const started = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: {
        origin: 'https://careersignal.example',
        'cf-access-jwt-assertion': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cvText: 'fictional CV', preferences: {} }),
    }), env);
    assert.equal(started.status, 202);
    const { searchId } = await started.json();

    for (const method of ['GET', 'DELETE']) {
      const response = await worker.fetch(new Request(`https://careersignal.example/api/searches/${encodeURIComponent(searchId)}`, {
        method,
        headers: {
          origin: 'https://careersignal.example',
          'cf-access-jwt-assertion': other.token,
        },
      }), env);
      assert.equal(response.status, 404);
    }
    assert.equal(apiRequests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uploads PDFs to a short-lived S3 URL without returning the signed URL to the browser', async () => {
  const { token, jwk } = await sharedAccessAssertion;
  const env = createEnvironment();
  const originalFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${ISSUER}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    outbound.push({ url, init });
    if (url === `${AWS_API_ORIGIN}/api/uploads`) {
      return Response.json({ uploadUrl: 'https://s3.example/temporary-signed-url', objectKey: 'cv/private/candidate.pdf' }, { status: 201 });
    }
    if (url === 'https://s3.example/temporary-signed-url' && init.method === 'PUT') return new Response(null, { status: 200 });
    if (url === `${AWS_API_ORIGIN}/api/searches` && init.method === 'POST') {
      const event = toApiEvent(url, init);
      const verified = await verifyGatewayRequest(event, { secret: GATEWAY_KEY, consumeNonce: async () => true });
      assert.deepEqual(JSON.parse(verified.body.toString()), {
        cvObjectKey: 'cv/private/candidate.pdf',
        preferences: { countryCodes: ['FR'] },
      });
      return Response.json({ searchId: SEARCH_ID }, { status: 202 });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };

  const form = new FormData();
  form.append('cv', new Blob(['%PDF-fake bytes'], { type: 'application/pdf' }), 'candidate.pdf');
  form.append('preferences', JSON.stringify({ countryCodes: ['FR'] }));
  try {
    const response = await worker.fetch(new Request('https://careersignal.example/api/searches', {
      method: 'POST',
      headers: { origin: 'https://careersignal.example', 'cf-access-jwt-assertion': token },
      body: form,
    }), env);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes('temporary-signed-url'));
    assert.ok(outbound.some(item => item.url === 'https://s3.example/temporary-signed-url'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
