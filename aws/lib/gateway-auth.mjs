import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const CLOCK_SKEW_SECONDS = 60;
const MUTATING_METHODS = new Set(['POST', 'DELETE']);

function header(event, name) {
  const headers = event.headers || {};
  const target = name.toLowerCase();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === target);
  return key ? String(headers[key] || '') : '';
}

export function rawBody(event) {
  if (!event.body) return Buffer.alloc(0);
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'utf8');
}

export function canonicalRequest({ method, path, timestamp, nonce, userId, body }) {
  const digest = createHash('sha256').update(body).digest('hex');
  return [method.toUpperCase(), path, timestamp, nonce, userId, digest].join('\n');
}

export function signGatewayRequest(secret, request) {
  return createHmac('sha256', secret).update(canonicalRequest(request)).digest('hex');
}

export async function verifyGatewayRequest(event, {
  secret,
  consumeNonce = async () => true,
  now = Date.now(),
} = {}) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    return { ok: false, status: 503, error: 'The gateway authentication is not configured.' };
  }

  const method = event.requestContext?.http?.method || event.httpMethod || '';
  const path = event.rawPath || event.path || '';
  const timestamp = header(event, 'x-careersignal-timestamp');
  const nonce = header(event, 'x-careersignal-nonce');
  const userId = header(event, 'x-careersignal-user');
  const signature = header(event, 'x-careersignal-signature');
  const currentSeconds = Math.floor(now / 1000);

  if (!method || !path || !/^\d{10}$/.test(timestamp) ||
      Math.abs(currentSeconds - Number(timestamp)) > CLOCK_SKEW_SECONDS ||
      !/^[0-9a-f-]{36}$/i.test(nonce) || !userId || userId.length > 256 ||
      !/^[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, status: 401, error: 'The gateway request could not be verified.' };
  }

  const body = rawBody(event);
  const expected = Buffer.from(signGatewayRequest(secret, {
    method,
    path,
    timestamp,
    nonce,
    userId,
    body,
  }), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return { ok: false, status: 401, error: 'The gateway request could not be verified.' };
  }

  if (MUTATING_METHODS.has(method.toUpperCase())) {
    let accepted;
    try {
      accepted = await consumeNonce(userId, nonce, currentSeconds + CLOCK_SKEW_SECONDS);
    } catch {
      return { ok: false, status: 503, error: 'Gateway replay protection is unavailable.' };
    }
    if (!accepted) return { ok: false, status: 409, error: 'The gateway request was already used.' };
  }

  return { ok: true, userId, body };
}
