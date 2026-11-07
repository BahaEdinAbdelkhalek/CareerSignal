import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCareerSignalServer } from './server.mjs';

test('container serves the SPA and rejects unauthenticated gateway calls', async () => {
  const assetDirectory = await mkdtemp(join(tmpdir(), 'careersignal-assets-'));
  await writeFile(join(assetDirectory, 'index.html'), '<link rel="stylesheet" href="styles-test.css"><app-root>test</app-root>');
  await writeFile(join(assetDirectory, 'styles-test.css'), 'body { color: green; }');
  const authEnv = {
    CAREERSIGNAL_AUTH_PROVIDER: 'azure',
    CAREERSIGNAL_ALLOWED_EMAIL: 'operator@example.com',
    CAREERSIGNAL_ENTRA_TENANT_ID: 'tenant-id',
    CAREERSIGNAL_ENTRA_CLIENT_ID: 'client-id',
    CAREERSIGNAL_ENTRA_CLIENT_SECRET: 'test-secret',
    CAREERSIGNAL_SESSION_ENCRYPTION_KEY: 'ab'.repeat(32),
  };
  const server = createCareerSignalServer({ assetDirectory, env: authEnv });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  authEnv.CAREERSIGNAL_PUBLIC_ORIGIN = `https://careersignal.example`;

  try {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const html = await page.text();
    assert.match(html, /<app-root/);
    assert.match(html, /rel="stylesheet"/);

    const stylesheet = await fetch(`${baseUrl}/styles-test.css`);
    assert.equal(stylesheet.status, 200);
    assert.ok(stylesheet.headers.get('content-type').startsWith('text/css'));
    assert.equal(await stylesheet.text(), 'body { color: green; }');

    const unauthorized = await fetch(`${baseUrl}/api/searches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ cvText: 'fictional test', preferences: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/access-login`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    const loginUrl = new URL(login.headers.get('location'));
    assert.equal(loginUrl.origin, 'https://login.microsoftonline.com');
    assert.equal(loginUrl.pathname, '/tenant-id/oauth2/v2.0/authorize');
    assert.equal(loginUrl.searchParams.get('client_id'), 'client-id');
    assert.equal(loginUrl.searchParams.get('redirect_uri'), 'https://careersignal.example/api/auth/callback');
    assert.equal(loginUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));

    const principal = Buffer.from(JSON.stringify({
      userId: 'operator-1',
      userDetails: 'operator@example.com',
      claims: [],
    })).toString('base64');
    const forgedPrincipal = await fetch(`${baseUrl}/api/searches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        'x-ms-client-principal': principal,
      },
      body: JSON.stringify({ cvText: 'fictional test', preferences: {} }),
    });
    assert.equal(forgedPrincipal.status, 401);
  } finally {
    server.close();
    await once(server, 'close');
    await rm(assetDirectory, { recursive: true, force: true });
  }
});
