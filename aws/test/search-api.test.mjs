import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchApi } from '../lib/search-api.mjs';

const SEARCH_ID = 'd7be844f-41bc-4dcb-89ed-d081c383cb13';
const OWNER = 'access-user-1';

function event(method, path, body = '') {
  return {
    rawPath: path,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    requestContext: { http: { method } },
  };
}

function responseBody(result) {
  return JSON.parse(result.body);
}

function mockServices(overrides = {}) {
  return {
    createUpload: async () => ({ uploadUrl: 'https://s3.example/signed', objectKey: 'cv/owner/123.pdf' }),
    startSearch: async () => ({ searchId: SEARCH_ID, expiresInSeconds: 7200 }),
    getSearch: async () => ({ status: 'Running' }),
    deleteSearch: async () => ({ deleted: true }),
    ...overrides,
  };
}

function api(services = mockServices(), auth = { ok: true, userId: OWNER }) {
  return createSearchApi({
    verifyRequest: async request => ({ ...auth, body: Buffer.from(request.body || '') }),
    services,
  });
}

test('creates a short-lived PDF upload for the authenticated owner', async () => {
  const calls = [];
  const handler = api(mockServices({ createUpload: async input => {
    calls.push(input);
    return { uploadUrl: 'https://s3.example/signed', objectKey: 'cv/owner/123.pdf' };
  } }));
  const result = await handler(event('POST', '/api/uploads', { contentType: 'application/pdf', size: 1024 }));

  assert.equal(result.statusCode, 201);
  assert.equal(responseBody(result).expiresInSeconds, 300);
  assert.deepEqual(calls, [{ ownerId: OWNER, size: 1024 }]);
});

test('rejects oversized PDF, malformed preferences, and oversized preferences before starting a workflow', async () => {
  let starts = 0;
  const handler = api(mockServices({ startSearch: async () => { starts++; return { searchId: SEARCH_ID }; } }));
  const oversizedPdf = await handler(event('POST', '/api/uploads', { contentType: 'application/pdf', size: 10 * 1024 * 1024 + 1 }));
  const invalidPreferences = await handler(event('POST', '/api/searches', { cvText: 'CV', preferences: 'not-an-object' }));
  const oversizedPreferences = await handler(event('POST', '/api/searches', { cvText: 'CV', preferences: { note: 'x'.repeat(10001) } }));

  assert.equal(oversizedPdf.statusCode, 413);
  assert.equal(invalidPreferences.statusCode, 400);
  assert.equal(oversizedPreferences.statusCode, 413);
  assert.equal(starts, 0);
});

test('accepts text CVs and returns the browser polling contract', async () => {
  const calls = [];
  const handler = api(mockServices({ startSearch: async input => {
    calls.push(input);
    return { searchId: SEARCH_ID };
  } }));
  const result = await handler(event('POST', '/api/searches', { cvText: '  Fictional CV  ', preferences: { countryCodes: ['FR'] } }));

  assert.equal(result.statusCode, 202);
  assert.deepEqual(responseBody(result), { searchId: SEARCH_ID, expiresInSeconds: 7200 });
  assert.deepEqual(calls, [{ ownerId: OWNER, cvText: 'Fictional CV', cvObjectKey: null, preferences: { countryCodes: ['FR'] } }]);
});

test('returns status, terminal results, owner-scoped not-found and delete conflicts', async () => {
  const handler = api(mockServices({
    getSearch: async ({ ownerId }) => ownerId === OWNER
      ? { status: 'Completed', result: { analysis: {}, companies: [], contacts: [], drafts: { results: [] }, summary: {} } }
      : null,
    deleteSearch: async () => ({ running: true }),
  }));
  const status = await handler(event('GET', `/api/searches/${SEARCH_ID}`));
  const deleting = await handler(event('DELETE', `/api/searches/${SEARCH_ID}`));

  assert.equal(status.statusCode, 200);
  assert.equal(responseBody(status).status, 'Completed');
  assert.equal(deleting.statusCode, 409);
});

test('rejects requests without a verified gateway identity', async () => {
  const handler = api(mockServices(), { ok: false, status: 401, error: 'Sign-in required.' });
  const result = await handler(event('POST', '/api/searches', { cvText: 'fictional' }));

  assert.equal(result.statusCode, 401);
  assert.equal(responseBody(result).error, 'Sign-in required.');
});
