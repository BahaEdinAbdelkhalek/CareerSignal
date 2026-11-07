import { verifyGatewayRequest } from '../lib/gateway-auth.mjs';
import { createSearchApi } from '../lib/search-api.mjs';
import {
  consumeGatewayNonce,
  createUpload,
  deleteSearch,
  getSearch,
  startSearch,
} from './aws-storage.mjs';
import { getProviderSecrets } from './provider-secrets.mjs';

const handlerImpl = createSearchApi({
  verifyRequest: async event => {
    const secrets = await getProviderSecrets();
    return verifyGatewayRequest(event, {
      secret: secrets.gatewayHmacKey,
      consumeNonce: consumeGatewayNonce,
    });
  },
  services: { createUpload, startSearch, getSearch, deleteSearch },
});

export async function handler(event) {
  return handlerImpl(event);
}
