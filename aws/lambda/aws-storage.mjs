import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { documentClient, s3Client, stepFunctionsClient } from './aws-clients.mjs';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const SEARCH_TTL_SECONDS = 30 * 24 * 60 * 60;

const bucketName = () => process.env.CAREERSIGNAL_DATA_BUCKET;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing runtime setting: ${name}`);
  return value;
}

export function hashOwner(ownerId) {
  return createHash('sha256').update(ownerId).digest('hex');
}

async function getItem(ownerId, searchId) {
  const result = await documentClient.send(new GetCommand({
    TableName: requiredEnv('CAREERSIGNAL_SEARCH_TABLE'),
    Key: { ownerId, searchId },
    ConsistentRead: true,
  }));
  return result.Item || null;
}

async function putJson(key, value) {
  await s3Client.send(new PutObjectCommand({
    Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
    Key: key,
    Body: JSON.stringify(value),
    ContentType: 'application/json; charset=utf-8',
  }));
}

async function getJson(key) {
  const result = await s3Client.send(new GetObjectCommand({
    Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
    Key: key,
  }));
  return JSON.parse(await result.Body.transformToString());
}

async function deletePrefix(prefix) {
  let token;
  do {
    const page = await s3Client.send(new ListObjectsV2Command({
      Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
      Prefix: prefix,
      ContinuationToken: token,
    }));
    const objects = (page.Contents || []).filter(item => item.Key).map(item => ({ Key: item.Key }));
    if (objects.length) {
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
        Delete: { Objects: objects, Quiet: true },
      }));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export async function consumeGatewayNonce(ownerId, nonce, expiresAt) {
  try {
    await documentClient.send(new PutCommand({
      TableName: requiredEnv('CAREERSIGNAL_SEARCH_TABLE'),
      Item: { ownerId, searchId: `nonce#${nonce}`, expiresAt },
      ConditionExpression: 'attribute_not_exists(ownerId) AND attribute_not_exists(searchId)',
    }));
    return true;
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

export async function createUpload({ ownerId, size }) {
  const key = `cv/${hashOwner(ownerId)}/${randomUUID()}.pdf`;
  const command = new PutObjectCommand({
    Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
    Key: key,
    ContentType: 'application/pdf',
  });
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  return { uploadUrl, objectKey: key, declaredSize: size };
}

export async function startSearch({ ownerId, cvText, cvObjectKey, preferences }) {
  const owner = hashOwner(ownerId);
  let uploadedPdf = null;
  if (cvObjectKey) {
    const allowedPrefix = `cv/${owner}/`;
    if (!cvObjectKey.startsWith(allowedPrefix) || cvObjectKey.includes('..')) {
      throw Object.assign(new Error('The uploaded PDF does not belong to this account.'), { status: 400, publicMessage: 'The uploaded PDF is invalid or expired.' });
    }
    try {
      const metadata = await s3Client.send(new HeadObjectCommand({
        Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
        Key: cvObjectKey,
      }));
      if (!Number.isInteger(metadata.ContentLength) || metadata.ContentLength < 1 || metadata.ContentLength > MAX_PDF_BYTES) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: cvObjectKey }));
        throw Object.assign(new Error('PDF size is outside the permitted range.'), { status: 413, publicMessage: 'PDF exceeds the 10 MB limit.' });
      }
      uploadedPdf = cvObjectKey;
    } catch (error) {
      if (error?.status) throw error;
      throw Object.assign(new Error('The uploaded PDF is missing or expired.'), { status: 400, publicMessage: 'The uploaded PDF is missing or expired. Upload it again.' });
    }
  }

  const searchId = randomUUID();
  const inputKey = `jobs/${owner}/${searchId}/input.json`;
  const now = Math.floor(Date.now() / 1000);
  const item = {
    ownerId,
    searchId,
    status: 'Running',
    inputKey,
    cvObjectKey: uploadedPdf,
    createdAt: now,
    expiresAt: now + SEARCH_TTL_SECONDS,
  };
  await putJson(inputKey, { cvText: cvText || null, cvObjectKey: uploadedPdf, preferences });
  try {
    await documentClient.send(new PutCommand({
      TableName: requiredEnv('CAREERSIGNAL_SEARCH_TABLE'),
      Item: item,
      ConditionExpression: 'attribute_not_exists(ownerId) AND attribute_not_exists(searchId)',
    }));
    await stepFunctionsClient.send(new StartExecutionCommand({
      stateMachineArn: requiredEnv('CAREERSIGNAL_STATE_MACHINE_ARN'),
      name: searchId,
      input: JSON.stringify({ ownerId, searchId, inputKey }),
    }));
  } catch (error) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: inputKey })).catch(() => undefined);
    await s3Client.send(new DeleteCommand({
      TableName: requiredEnv('CAREERSIGNAL_SEARCH_TABLE'),
      Key: { ownerId, searchId },
    })).catch(() => undefined);
    if (uploadedPdf) await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: uploadedPdf })).catch(() => undefined);
    throw error;
  }
  return { searchId, expiresInSeconds: 2 * 60 * 60 };
}

export async function getSearch({ ownerId, searchId }) {
  const item = await getItem(ownerId, searchId);
  if (!item) return null;
  if (item.status === 'Completed') {
    if (!item.resultKey) throw new Error('Completed search has no result.');
    return { status: 'Completed', result: await getJson(item.resultKey) };
  }
  if (item.status === 'Failed') return { status: 'Failed', error: 'The workflow failed. Retry with a new search.' };
  if (item.status === 'Terminated') return { status: 'Terminated', error: 'The workflow was terminated.' };
  if (item.status === 'Canceled') return { status: 'Canceled', error: 'The workflow was canceled.' };
  return { status: 'Running' };
}

export async function cleanupSearchArtifacts(ownerId, searchId, { includeResult = false } = {}) {
  const item = await getItem(ownerId, searchId);
  if (item?.cvObjectKey) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'), Key: item.cvObjectKey }));
  }
  const owner = hashOwner(ownerId);
  await deletePrefix(`jobs/${owner}/${searchId}/`);
  if (includeResult) await deletePrefix(`results/${owner}/${searchId}/`);
}

export async function deleteSearch({ ownerId, searchId }) {
  const item = await getItem(ownerId, searchId);
  if (!item) return { deleted: false };
  if (['Queued', 'Running'].includes(item.status)) return { running: true };
  await cleanupSearchArtifacts(ownerId, searchId, { includeResult: true });
  await documentClient.send(new DeleteCommand({
    TableName: requiredEnv('CAREERSIGNAL_SEARCH_TABLE'),
    Key: { ownerId, searchId },
    ConditionExpression: 'attribute_exists(ownerId)',
  }));
  return { deleted: true };
}

export async function markCompleted(ownerId, searchId, resultKey) {
  await documentClient.send(new UpdateCommand({
    TableName: requiredEnv('CAREERSIGNAL_SEARCH_TABLE'),
    Key: { ownerId, searchId },
    UpdateExpression: 'SET #status = :status, resultKey = :resultKey, completedAt = :completedAt REMOVE inputKey, cvObjectKey',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'Completed',
      ':resultKey': resultKey,
      ':completedAt': Math.floor(Date.now() / 1000),
    },
    ConditionExpression: 'attribute_exists(ownerId)',
  }));
}

export async function markFailed(ownerId, searchId) {
  await documentClient.send(new UpdateCommand({
    TableName: requiredEnv('CAREERSIGNAL_SEARCH_TABLE'),
    Key: { ownerId, searchId },
    UpdateExpression: 'SET #status = :status, #error = :error, completedAt = :completedAt REMOVE inputKey, cvObjectKey',
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: {
      ':status': 'Failed',
      ':error': 'The workflow failed. Retry with a new search.',
      ':completedAt': Math.floor(Date.now() / 1000),
    },
    ConditionExpression: 'attribute_exists(ownerId)',
  }));
}

export const workflowStorage = {
  async getJson(key) { return getJson(key); },
  async putJson(key, value) { return putJson(key, value); },
  async getObject(key) {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
      Key: key,
    }));
    return Buffer.from(await response.Body.transformToByteArray());
  },
  async deleteObject(key) {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: requiredEnv('CAREERSIGNAL_DATA_BUCKET'),
      Key: key,
    }));
  },
  async cleanupSearchArtifacts(ownerId, searchId, options) {
    return cleanupSearchArtifacts(ownerId, searchId, options);
  },
  async markCompleted(ownerId, searchId, resultKey) { return markCompleted(ownerId, searchId, resultKey); },
  async markFailed(ownerId, searchId) { return markFailed(ownerId, searchId); },
};
