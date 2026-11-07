const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_CV_TEXT_CHARS = 100000;
const MAX_PREFERENCES_BYTES = 10000;
const MAX_API_BODY_BYTES = 600000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, private',
  'x-content-type-options': 'nosniff',
};

function response(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function parseJson(body) {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}

function parsePreferences(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: response(400, { error: 'Preferences must be a JSON object.' }) };
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PREFERENCES_BYTES) {
    return { error: response(413, { error: 'Preferences exceed the 10 KB limit.' }) };
  }
  return { value };
}

export function createSearchApi({ verifyRequest, services }) {
  if (typeof verifyRequest !== 'function' || !services) {
    throw new TypeError('A gateway verifier and AWS service adapter are required.');
  }

  return async function handler(event) {
    let auth;
    try {
      auth = await verifyRequest(event);
    } catch {
      return response(503, { error: 'Gateway authentication is unavailable.' });
    }
    if (!auth?.ok) return response(auth?.status || 401, { error: auth?.error || 'The gateway request could not be verified.' });

    const method = event.requestContext?.http?.method || event.httpMethod || '';
    const path = event.rawPath || event.path || '';
    const body = auth.body || Buffer.alloc(0);
    if (body.length > MAX_API_BODY_BYTES) return response(413, { error: 'Request body exceeds the permitted limit.' });

    try {
      if (method === 'POST' && path === '/api/uploads') {
        const input = parseJson(body);
        if (!input || input.contentType !== 'application/pdf') {
          return response(415, { error: 'Only PDF uploads are supported.' });
        }
        if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_PDF_BYTES) {
          return response(413, { error: 'PDF must be between 1 byte and 10 MB.' });
        }
        const upload = await services.createUpload({ ownerId: auth.userId, size: input.size });
        if (!upload?.uploadUrl || !upload?.objectKey) {
          return response(502, { error: 'A temporary upload could not be created.' });
        }
        return response(201, { uploadUrl: upload.uploadUrl, objectKey: upload.objectKey, expiresInSeconds: 300 });
      }

      if (method === 'POST' && path === '/api/searches') {
        const input = parseJson(body);
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          return response(400, { error: 'Request body must be a JSON object.' });
        }
        const parsedPreferences = parsePreferences(input.preferences);
        if (parsedPreferences.error) return parsedPreferences.error;
        const preferences = parsedPreferences.value;

        const cvText = typeof input.cvText === 'string' ? input.cvText.trim() : '';
        const objectKey = typeof input.cvObjectKey === 'string' ? input.cvObjectKey : '';
        if (cvText && objectKey) return response(400, { error: 'Send either CV text or an uploaded PDF, not both.' });
        if (cvText.length > MAX_CV_TEXT_CHARS) return response(413, { error: 'CV text exceeds 100,000 characters.' });
        if (!cvText && !objectKey) return response(400, { error: 'CV text or a previously uploaded PDF is required.' });

        const started = await services.startSearch({
          ownerId: auth.userId,
          cvText: cvText || null,
          cvObjectKey: objectKey || null,
          preferences,
        });
        if (!started?.searchId || !UUID_PATTERN.test(started.searchId)) {
          return response(502, { error: 'The workflow did not return a valid search handle.' });
        }
        return response(202, {
          searchId: started.searchId,
          expiresInSeconds: Number.isInteger(started.expiresInSeconds) ? started.expiresInSeconds : 7200,
        });
      }

      const match = path.match(/^\/api\/searches\/([0-9a-f-]{36})$/i);
      if (match && method === 'GET') {
        if (!UUID_PATTERN.test(match[1])) return response(404, { error: 'Search not found.' });
        const search = await services.getSearch({ ownerId: auth.userId, searchId: match[1] });
        if (!search) return response(404, { error: 'Search not found.' });
        return response(200, search);
      }

      if (match && method === 'DELETE') {
        if (!UUID_PATTERN.test(match[1])) return response(404, { error: 'Search not found.' });
        const result = await services.deleteSearch({ ownerId: auth.userId, searchId: match[1] });
        if (result?.running) return response(409, { error: 'The workflow is still running. Try again after it finishes.' });
        if (!result?.deleted) return response(404, { error: 'Search not found.' });
        return response(200, { deleted: true });
      }

      return response(404, { error: 'Not found.' });
    } catch (error) {
      if ([400, 413, 415].includes(error?.status) && typeof error.publicMessage === 'string') {
        return response(error.status, { error: error.publicMessage });
      }
      return response(500, { error: 'CareerSignal could not complete the request. Retry shortly.' });
    }
  };
}
