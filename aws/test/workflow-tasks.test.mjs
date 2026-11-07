import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowTaskHandler } from '../lib/workflow-tasks.mjs';

const OWNER = 'access-user-1';
const SEARCH_ID = '9e6621af-14f4-4758-b334-2c098cb95950';

function createStorage(initial = {}) {
  const objects = new Map(Object.entries(initial));
  const deleted = [];
  let completed;
  let failed = false;
  return {
    objects,
    deleted,
    get completed() { return completed; },
    get failed() { return failed; },
    async getJson(key) {
      if (!objects.has(key)) throw new Error('missing object');
      return objects.get(key);
    },
    async putJson(key, value) { objects.set(key, value); },
    async getObject() { return Buffer.from('%PDF-test'); },
    async deleteObject(key) { deleted.push(key); objects.delete(key); },
    async cleanupSearchArtifacts() {},
    async markCompleted(ownerId, searchId, resultKey) { completed = { ownerId, searchId, resultKey }; },
    async markFailed() { failed = true; },
  };
}

const analysis = {
  candidateSummary: 'A candidate with relevant skills.',
  skills: ['TypeScript'],
  targetRoles: ['Software Engineer'],
  companyKeywords: ['software development'],
  hrJobTitles: ['Talent Acquisition'],
  countryCodes: ['FR'],
  matchingCriteria: [],
  gaps: [],
};

function testProspect({ contacts = [], enrichPerson = async contact => ({
  full_name: contact.fullName,
  email: { address: `${contact.id}@example.test`, status: 'valid' },
}) } = {}) {
  return {
    async searchCompanies() {
      return [{ id: 'company-1', name: 'Example Software', description: 'Software development' }];
    },
    scoreCompanies(companies) { return companies.map(company => ({ ...company, fitScore: 90, matchReasons: ['software development'] })); },
    async searchHrContacts() { return contacts; },
    selectTopContacts(values) { return values.slice(0, 5); },
    enrichPerson,
  };
}

test('runs the same analysis-to-draft stages while keeping CV content out of task outputs', async () => {
  const storage = createStorage({ 'jobs/input.json': { cvText: 'fictional CV text', preferences: { countryCodes: ['FR'] } } });
  const modelCalls = [];
  const model = {
    async analyseCv(text, preferences) {
      modelCalls.push(['analyse', text, preferences]);
      return analysis;
    },
    async createDrafts(input) {
      modelCalls.push(['drafts', input.contacts.length]);
      return { results: input.contacts.map(contact => ({ contactId: contact.id, subject: 'Hello', body: 'A concise note.' })) };
    },
  };
  const contacts = Array.from({ length: 7 }, (_, index) => ({
    id: `person-${index}`,
    full_name: `Person ${index}`,
    title: 'Talent Acquisition Manager',
    company: { id: 'company-1', name: 'Example Software' },
  }));
  const task = createWorkflowTaskHandler({ storage, prospect: testProspect({ contacts }), model, extractPdfText: async () => 'unused' });

  const analysisOutput = await task({ action: 'analyse', ownerId: OWNER, searchId: SEARCH_ID, inputKey: 'jobs/input.json' });
  assert.deepEqual(Object.keys(analysisOutput), ['analysisKey']);
  assert.equal(JSON.stringify(analysisOutput).includes('fictional CV text'), false);
  const companiesOutput = await task({ action: 'discoverCompanies', ownerId: OWNER, searchId: SEARCH_ID, ...analysisOutput });
  const contactsOutput = await task({ action: 'discoverContacts', ownerId: OWNER, searchId: SEARCH_ID, ...analysisOutput, ...companiesOutput });
  const enrichmentOutput = await task({ action: 'enrichContacts', ownerId: OWNER, searchId: SEARCH_ID, ...contactsOutput });
  const finalOutput = await task({ action: 'createDrafts', ownerId: OWNER, searchId: SEARCH_ID, ...analysisOutput, ...companiesOutput, ...contactsOutput, ...enrichmentOutput });

  assert.deepEqual(finalOutput, { completed: true });
  assert.equal(modelCalls[0][0], 'analyse');
  assert.deepEqual(modelCalls[0].slice(1), ['fictional CV text', { countryCodes: ['FR'] }]);
  assert.deepEqual(modelCalls[1], ['drafts', 5]);
  assert.deepEqual(storage.completed, {
    ownerId: OWNER,
    searchId: SEARCH_ID,
    resultKey: `results/${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(OWNER).digest('hex'))}/${SEARCH_ID}/result.json`,
  });
  const result = storage.objects.get(storage.completed.resultKey);
  assert.equal(result.contacts.length, 5);
  assert.equal(result.summary.contactsShortlisted, 5);
  assert.equal(result.summary.draftsGenerated, 5);
});

test('deletes the temporary uploaded PDF after analysis, including failed analysis', async () => {
  const storage = createStorage({ 'jobs/input.json': { cvObjectKey: 'cv/private/cv.pdf', preferences: {} } });
  let deletedPdf = false;
  storage.getObject = async () => Buffer.from('%PDF-test');
  storage.deleteObject = async key => { if (key === 'cv/private/cv.pdf') deletedPdf = true; };
  const task = createWorkflowTaskHandler({
    storage,
    prospect: testProspect(),
    model: { analyseCv: async () => { throw new Error('private model detail'); } },
    extractPdfText: async () => 'fictional text',
  });

  await assert.rejects(() => task({ action: 'analyse', ownerId: OWNER, searchId: SEARCH_ID, inputKey: 'jobs/input.json' }), /task failed/);
  assert.equal(deletedPdf, true);
});

test('sequentially limits email enrichment to five contacts', async () => {
  const contacts = Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, fullName: `Person ${index}`, title: 'Recruiter', company: 'Example' }));
  const storage = createStorage({ 'contacts.json': contacts });
  let active = 0;
  let maximumActive = 0;
  let attempts = 0;
  const task = createWorkflowTaskHandler({
    storage,
    prospect: testProspect({ contacts, enrichPerson: async contact => {
      attempts++;
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return { email: { address: `${contact.id}@example.test`, status: 'valid' } };
    } }),
    model: {},
    extractPdfText: async () => '',
  });

  const result = await task({ action: 'enrichContacts', ownerId: OWNER, searchId: SEARCH_ID, contactsKey: 'contacts.json' });
  assert.deepEqual(result, { enrichedKey: `jobs/${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(OWNER).digest('hex'))}/${SEARCH_ID}/enriched-contacts.json` });
  assert.equal(attempts, 5);
  assert.equal(maximumActive, 1);
});
