import test from 'node:test';
import assert from 'node:assert/strict';
import { signGatewayRequest, verifyGatewayRequest } from '../lib/gateway-auth.mjs';

const SECRET = 'test-gateway-key-that-is-at-least-32-bytes-long';
const USER_ID = 'cloudflare-access-subject';
const NONCE = '7ad02c9e-9836-4abf-b5a4-7b4dfb4d5d44';
const NOW = 1_800_000_000_000;

function request({ method = 'POST', path = '/api/searches', body = '{"cvText":"fictional"}', timestamp = String(Math.floor(NOW / 1000)), nonce = NONCE } = {}) {
  const bytes = Buffer.from(body);
  const signature = signGatewayRequest(SECRET, { method, path, timestamp, nonce, userId: USER_ID, body: bytes });
  return {
    rawPath: path,
    body,
    requestContext: { http: { method } },
    headers: {
      'x-careersignal-timestamp': timestamp,
      'x-careersignal-nonce': nonce,
      'x-careersignal-user': USER_ID,
      'x-careersignal-signature': signature,
    },
  };
}

test('accepts a signed gateway request and consumes its mutation nonce once', async () => {
  const consumed = [];
  const result = await verifyGatewayRequest(request(), {
    secret: SECRET,
    now: NOW,
    consumeNonce: async (...args) => { consumed.push(args); return true; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.userId, USER_ID);
  assert.equal(result.body.toString(), '{"cvText":"fictional"}');
  assert.deepEqual(consumed, [[USER_ID, NONCE, Math.floor(NOW / 1000) + 60]]);
});

test('rejects a changed request body and expired timestamp before using the nonce', async () => {
  const event = request();
  event.body = '{"cvText":"changed"}';
  let nonceCalls = 0;
  const invalidSignature = await verifyGatewayRequest(event, {
    secret: SECRET,
    now: NOW,
    consumeNonce: async () => { nonceCalls++; return true; },
  });
  assert.equal(invalidSignature.status, 401);

  const expired = await verifyGatewayRequest(request({ timestamp: String(Math.floor(NOW / 1000) - 61) }), {
    secret: SECRET,
    now: NOW,
    consumeNonce: async () => { nonceCalls++; return true; },
  });
  assert.equal(expired.status, 401);
  assert.equal(nonceCalls, 0);
});

test('does not nonce-consume reads and rejects replayed mutations', async () => {
  let calls = 0;
  const read = await verifyGatewayRequest(request({ method: 'GET', path: '/api/searches/9f1c638d-48d7-4c53-95d2-04e196e5c4a0', body: '' }), {
    secret: SECRET,
    now: NOW,
    consumeNonce: async () => { calls++; return true; },
  });
  assert.equal(read.ok, true);
  assert.equal(calls, 0);

  const replay = await verifyGatewayRequest(request(), {
    secret: SECRET,
    now: NOW,
    consumeNonce: async () => false,
  });
  assert.equal(replay.status, 409);
});
