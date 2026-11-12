import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCareerSignalServer } from './server.mjs';

test('container serves runtime configuration and allows its API origins in CSP', async t => {
  const assetDirectory = await mkdtemp(join(tmpdir(), 'careersignal-assets-'));
  await writeFile(join(assetDirectory, 'index.html'), '<link rel="stylesheet" href="styles-test.css"><app-root>test</app-root>');
  await writeFile(join(assetDirectory, 'styles-test.css'), 'body { color: green; }');

  const server = createCareerSignalServer({
    env: {
      ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
      ACCESS_AUD: 'test-audience',
      CAREERSIGNAL_ALLOWED_EMAIL: 'operator@example.com',
      CAREERSIGNAL_PUBLIC_API_BASE_URL: 'https://api.example.com',
      CAREERSIGNAL_COGNITO_DOMAIN: 'https://login.example.com',
      CAREERSIGNAL_COGNITO_CLIENT_ID: 'public-client-id',
      LOGO_DEV_PUBLISHABLE_KEY: 'logo-key-must-stay-server-side',
    },
    assetDirectory,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(assetDirectory, { recursive: true, force: true });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin);
  const contentSecurityPolicy = page.headers.get('content-security-policy');
  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy, /connect-src 'self' https:\/\/api\.example\.com https:\/\/login\.example\.com/);
  const html = await page.text();
  assert.match(html, /<app-root/);
  assert.match(html, /rel="stylesheet"/);

  const stylesheet = await fetch(`${origin}/styles-test.css`);
  assert.equal(stylesheet.status, 200);
  assert.ok(stylesheet.headers.get('content-type').startsWith('text/css'));
  assert.equal(await stylesheet.text(), 'body { color: green; }');

  const unauthorized = await fetch(`${origin}/api/searches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ cvText: 'fictional test', preferences: {} }),
  });
  assert.equal(unauthorized.status, 401);

  const login = await fetch(`${origin}/api/access-login`, { redirect: 'manual' });
  assert.equal(login.status, 401);

  const response = await fetch(`${origin}/runtime-config.json`);
  assert.equal(response.status, 200);
  const runtimeConfig = await response.json();
  assert.deepEqual(runtimeConfig, {
    apiBaseUrl: 'https://api.example.com',
    cognitoDomain: 'https://login.example.com',
    cognitoClientId: 'public-client-id',
    linkedinUrl: '',
    githubUrl: '',
  });
  assert.ok(!JSON.stringify(runtimeConfig).includes('logo-key-must-stay-server-side'));
});
