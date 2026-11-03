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
  const server = createCareerSignalServer({
    assetDirectory,
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
    await rm(assetDirectory, { recursive: true, force: true });
  }
});
