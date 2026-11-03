import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './worker.mjs';

const MAX_REQUEST_BYTES = 11 * 1024 * 1024;
const WINDOW_MS = 60_000;
const SUBMISSION_LIMIT = 3;
const windows = new Map();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function limitForUser(userId) {
  const now = Date.now();
  const current = windows.get(userId);
  if (!current || current.resetAt <= now) {
    windows.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return { success: true };
  }
  if (current.count >= SUBMISSION_LIMIT) return { success: false };
  current.count += 1;
  return { success: true };
}

function secureStaticHeaders(headers) {
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  headers.set('strict-transport-security', 'max-age=31536000');
  return headers;
}

function makeAssetFetcher(assetDirectory) {
  const root = resolve(assetDirectory);
  return async request => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const candidate = resolve(root, `.${pathname}`);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      return new Response('Not found', { status: 404 });
    }

    let filePath = candidate;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = resolve(filePath, 'index.html');
    } catch {
      filePath = resolve(root, 'index.html');
    }

    try {
      const content = await readFile(filePath);
      const headers = secureStaticHeaders(new Headers({
        'content-type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      }));
      return new Response(content, { headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
}

async function readRequestBody(request) {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createCareerSignalServer({ env = process.env, assetDirectory = fileURLToPath(new URL('./dist/careersignal/browser', import.meta.url)) } = {}) {
  const gatewayEnv = {
    ...env,
    SEARCH_SUBMIT_LIMITER: { limit: ({ key }) => limitForUser(key) },
    ASSETS: { fetch: makeAssetFetcher(assetDirectory) },
  };

  return createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method || 'GET';
      const hasBody = !['GET', 'HEAD'].includes(method);
      const body = hasBody ? await readRequestBody(incoming) : undefined;
      if (hasBody && body === null) {
        outgoing.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        outgoing.end(JSON.stringify({ error: 'CV upload exceeds the gateway limit.' }));
        return;
      }

      const forwardedProto = incoming.headers['x-forwarded-proto'];
      const protocol = typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https' ? 'https' : 'http';
      const host = incoming.headers['x-forwarded-host'] || incoming.headers.host || 'localhost';
      const requestUrl = new URL(incoming.url || '/', `${protocol}://${host}`);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }

      const requestInit = { method, headers };
      if (hasBody) requestInit.body = body;
      const request = new Request(requestUrl, requestInit);
      const response = await worker.fetch(request, gatewayEnv);
      const responseHeaders = new Headers(response.headers);
      outgoing.writeHead(response.status, Object.fromEntries(responseHeaders.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Request handling failed:', error instanceof Error ? error.message : 'unknown error');
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      }
      outgoing.end(JSON.stringify({ error: 'The application could not process this request.' }));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const server = createCareerSignalServer();
  server.listen(port, '0.0.0.0', () => console.log(`CareerSignal listening on port ${port}`));
}
