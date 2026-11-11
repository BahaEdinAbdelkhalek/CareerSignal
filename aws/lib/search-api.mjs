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
  if (value === undefined || value === null) return { error: response(400, { error: 'Search preferences are required.' }) };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: response(400, { error: 'Preferences must be a JSON object.' }) };
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PREFERENCES_BYTES) {
    return { error: response(413, { error: 'Preferences exceed the 10 KB limit.' }) };
  }

  const companyNames = normalizePreferenceList(value.companyNames, 100);
  if (!companyNames || companyNames.length < 1) {
    return { error: response(400, { error: 'Enter at least one company to search.' }) };
  }
  if (companyNames.length > 5) {
    return { error: response(400, { error: 'Search up to five companies at a time.' }) };
  }
  if (companyNames.some(name => name.length < 2)) {
    return { error: response(400, { error: 'Company names must be at least two characters.' }) };
  }
  const contactTypes = normalizePreferenceList(value.contactTypes, 100);
  if (!contactTypes || !contactTypes.length) {
    return { error: response(400, { error: 'Choose at least one HR or recruiting contact type.' }) };
  }
  if (contactTypes.length > 20) {
    return { error: response(400, { error: 'Choose no more than twenty contact titles.' }) };
  }
  if (contactTypes.some(type => !/(recruit|talent acquisition|talent sourc(?:er|ing)|human resources|\bhr\b|hris|people operations|people ops|people partner|talent partner|head of people|chief people|vp of people|people and culture|employee relations|compensation and benefits|learning and development|organizational development)/i.test(type))) {
    return { error: response(400, { error: 'Contact types must be HR, recruiting, talent, or people-function titles.' }) };
  }
  return { value: { ...value, companyNames, contactTypes } };
}

function secureCompanyUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const input = value.trim();
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

function getCompanyLogo(company) {
  const logo = company?.logo || company?.logo_url || company?.logoUrl || company?.company_logo ||
    company?.company_logo_url || company?.image_url;
  if (typeof logo === 'string') return logo;
  if (logo && typeof logo === 'object') return logo.url || logo.original || logo.src || null;
  return null;
}

function normalizeCompanySuggestion(company) {
  const id = typeof company?.id === 'string' ? company.id : '';
  const name = typeof (company?.name || company?.company_name) === 'string' ? (company.name || company.company_name).trim() : '';
  if (!id || !name) return null;
  const domain = company.domain || company.website_domain || null;
  const industry = Array.isArray(company.industry) ? company.industry.join(', ') : company.industry || company.industries || null;
  return {
    id,
    name,
    logoUrl: secureCompanyUrl(getCompanyLogo(company)),
    website: secureCompanyUrl(company.website || company.website_url),
    domain: typeof domain === 'string' ? domain.replace(/^https?:\/\//i, '').split('/')[0] : null,
    industry: typeof industry === 'string' ? industry : null,
  };
}

function normalizePreferenceList(value, maximumLength) {
  if (!Array.isArray(value)) return null;
  const items = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const normalized = item.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > maximumLength) return null;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
  }
  return items;
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
      if (method === 'POST' && path === '/api/companies/search') {
        const input = parseJson(body);
        const query = typeof input?.query === 'string' ? input.query.trim().replace(/\s+/g, ' ') : '';
        if (query.length < 2 || query.length > 100) {
          return response(400, { error: 'Search using a company name between 2 and 100 characters.' });
        }
        const discovered = await services.lookupCompanies({ query });
        const companies = (Array.isArray(discovered) ? discovered : [])
          .map(normalizeCompanySuggestion)
          .filter(Boolean)
          .slice(0, 10);
        return response(200, { companies });
      }

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
