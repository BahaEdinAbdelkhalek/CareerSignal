import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelChatJson } from '../lib/model-provider.mjs';

const common = {
  endpoint: 'https://model.example/v1/',
  model: 'test-model',
  getApiKey: async () => 'model-secret',
};

test('calls an OpenAI-compatible JSON endpoint and returns parsed content', async () => {
  let request;
  const chatJson = createModelChatJson({
    ...common,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({ choices: [{ message: { content: '{"skills":["TypeScript"]}' } }] });
    },
  });
  const result = await chatJson('system rules', 'user payload');

  assert.deepEqual(result, { skills: ['TypeScript'] });
  assert.equal(request.url, 'https://model.example/v1/chat/completions');
  assert.equal(new Headers(request.init.headers).get('authorization'), 'Bearer model-secret');
  assert.deepEqual(JSON.parse(request.init.body).response_format, { type: 'json_object' });
});

test('fails closed on invalid endpoint, response and HTTP errors without exposing provider body', async () => {
  const invalidEndpoint = createModelChatJson({ ...common, endpoint: 'http://model.example/v1' });
  await assert.rejects(() => invalidEndpoint('system', 'prompt'), /HTTPS/);

  const invalidJson = createModelChatJson({
    ...common,
    fetchImpl: async () => Response.json({ choices: [{ message: { content: 'not json' } }] }),
  });
  await assert.rejects(() => invalidJson('system', 'prompt'), /invalid JSON/);

  const failed = createModelChatJson({
    ...common,
    fetchImpl: async () => new Response('secret vendor detail', { status: 429 }),
  });
  await assert.rejects(() => failed('system', 'prompt'), error => {
    assert.match(error.message, /HTTP 429/);
    assert.doesNotMatch(error.message, /secret vendor detail/);
    return true;
  });
});
