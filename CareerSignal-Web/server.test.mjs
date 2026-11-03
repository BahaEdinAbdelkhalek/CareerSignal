import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createCareerSignalServer } from './server.mjs';

const ASSET_DIRECTORY = fileURLToPath(new URL('./dist/careersignal/browser', import.meta.url));

test('container serves Angular and rejects unauthenticated gateway calls', async () => {
  const server = createCareerSignalServer({
    assetDirectory: ASSET_DIRECTORY,
    env: { CAREERSIGNAL_AUTH_PROVIDER: 'azure', CAREERSIGNAL_ALLOWED_EMAIL: 'operator@example.com' },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await page.text(), /<app-root/);

    const unauthorized = await fetch(`${baseUrl}/api/searches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ cvText: 'fictional test', preferences: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/access-login`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.ok(login.headers.get('location').includes('/.auth/login/aad'));

    const principal = Buffer.from(JSON.stringify({
      userId: 'operator-1',
      userDetails: 'operator@example.com',
      claims: [],
    })).toString('base64');
    const authenticatedButUnconfigured = await fetch(`${baseUrl}/api/searches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        'x-ms-client-principal': principal,
      },
      body: JSON.stringify({ cvText: 'fictional test', preferences: {} }),
    });
    assert.equal(authenticatedButUnconfigured.status, 503);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
