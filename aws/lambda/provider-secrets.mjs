import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { ssmClient } from './aws-clients.mjs';

let cachedValue;
let cachedUntil = 0;

export async function getProviderSecrets() {
  if (cachedValue && cachedUntil > Date.now()) return cachedValue;
  const parameterName = process.env.CAREERSIGNAL_SECRETS_PARAMETER;
  if (!parameterName) throw new Error('Provider secret configuration is missing.');

  const result = await ssmClient.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
  if (typeof result.Parameter?.Value !== 'string') throw new Error('Provider secret value is unavailable.');
  let parsed;
  try {
    parsed = JSON.parse(result.Parameter.Value);
  } catch {
    throw new Error('Provider secret value is invalid.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Provider secret value is invalid.');
  cachedValue = parsed;
  cachedUntil = Date.now() + 5 * 60 * 1000;
  return cachedValue;
}

export function clearProviderSecretsCache() {
  cachedValue = undefined;
  cachedUntil = 0;
}
