function parseObject(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const value = JSON.parse(cleaned);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const value = JSON.parse(cleaned.slice(start, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
  }
  throw new Error('The configured model returned invalid JSON.');
}

function chatCompletionsUrl(baseUrl) {
  if (!baseUrl) throw new Error('The model API endpoint is not configured.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('The model API endpoint must be a clean HTTPS URL.');
  }
  const path = base.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) return base.href;
  base.pathname = `${path}/chat/completions`.replace(/^\/+/, '/');
  return base.href;
}

export function createModelChatJson({ endpoint, model, getApiKey, fetchImpl = fetch }) {
  return async function chatJson(systemPrompt, userPrompt) {
    if (typeof getApiKey !== 'function') throw new TypeError('A model API key provider is required.');
    if (!model) throw new Error('The model deployment name is not configured.');
    const apiKey = await getApiKey();
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('The model API key is not configured.');
    const url = chatCompletionsUrl(endpoint);

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Return a valid JSON object only.\n${userPrompt}` },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(120000),
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('The configured model request timed out.');
      }
      throw new Error('The configured model endpoint could not be reached.');
    }

    if (!response.ok) {
      throw new Error(`The configured model request failed (HTTP ${response.status}).`);
    }

    const payload = await response.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('The configured model returned no text.');
    }
    return parseObject(content);
  };
}
