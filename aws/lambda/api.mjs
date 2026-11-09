
import { createSearchApi } from '../lib/search-api.mjs';
import {

  createUpload,
  deleteSearch,
  getSearch,
  startSearch,
} from './aws-storage.mjs';
const handlerImpl = createSearchApi({
  verifyRequest: async event => {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    const userId = typeof claims?.sub === 'string' ? claims.sub : '';
    if (!userId) return { ok: false, status: 401, error: 'Sign in to use live search.' };
    return { ok: true, userId, body: Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8') };
  },
  services: { createUpload, startSearch, getSearch, deleteSearch },
});

export async function handler(event) {
  return handlerImpl(event);
}
