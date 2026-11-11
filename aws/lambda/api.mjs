
import { createRequire } from 'node:module';
import { createSearchApi } from '../lib/search-api.mjs';
import { getProviderSecrets } from './provider-secrets.mjs';
import {

  createUpload,
  deleteSearch,
  getSearch,
  startSearch,
} from './aws-storage.mjs';

const require = createRequire(import.meta.url);
const getprospect = require('../../src/services/getprospect.js');
getprospect.setApiKeyProvider(async () => (await getProviderSecrets()).getProspectApiKey);

const handlerImpl = createSearchApi({
  verifyRequest: async event => {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    const userId = typeof claims?.sub === 'string' ? claims.sub : '';
    if (!userId) return { ok: false, status: 401, error: 'Sign in to use live search.' };
    return { ok: true, userId, body: Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8') };
  },
  services: {
    createUpload,
    startSearch,
    getSearch,
    deleteSearch,
    lookupCompanies: ({ query }) => getprospect.searchCompanies({
      companyNames: [query],
      perPage: 25,
      maxPages: 1,
    }),
  },
});

export async function handler(event) {
  return handlerImpl(event);
}
