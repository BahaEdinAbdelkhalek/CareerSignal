import { createRequire } from 'node:module';
import { createModelChatJson } from '../lib/model-provider.mjs';
import { extractPdfText } from '../lib/pdf-extractor.mjs';
import { createWorkflowTaskHandler } from '../lib/workflow-tasks.mjs';
import {
  cleanupSearchArtifacts,
  markCompleted,
  markFailed,
  workflowStorage,
} from './aws-storage.mjs';
import { getProviderSecrets } from './provider-secrets.mjs';

const require = createRequire(import.meta.url);
const foundry = require('../../src/services/foundry.js');
const getprospect = require('../../src/services/getprospect.js');
const matching = require('../../src/services/matching.js');

getprospect.setApiKeyProvider(async () => {
  const secrets = await getProviderSecrets();
  return secrets.getProspectApiKey;
});

foundry.setChatJsonProvider(createModelChatJson({
  endpoint: process.env.MODEL_API_ENDPOINT,
  model: process.env.MODEL_API_MODEL,
  provider: process.env.MODEL_API_PROVIDER || 'openai-compatible',
  getApiKey: async () => (await getProviderSecrets()).modelApiKey,
}));

const taskHandler = createWorkflowTaskHandler({
  storage: {
    ...workflowStorage,
    cleanupSearchArtifacts,
    markCompleted,
    markFailed,
  },
  prospect: {
    ...getprospect,
    ...matching,
  },
  model: {
    analyseCv: foundry.analyseCv,
    createDrafts: foundry.createDrafts,
  },
  extractPdfText,
});

export async function handler(event) {
  return taskHandler(event);
}
