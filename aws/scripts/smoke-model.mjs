import { createRequire } from 'node:module';
import { createModelChatJson } from '../lib/model-provider.mjs';

const endpoint = process.env.MODEL_API_ENDPOINT;
const model = process.env.MODEL_API_MODEL;
const provider = process.env.MODEL_API_PROVIDER || 'openai-compatible';
const apiKey = process.env.MODEL_API_KEY;

if (!endpoint || !model || !apiKey) {
  console.error('Set MODEL_API_ENDPOINT, MODEL_API_MODEL, and MODEL_API_KEY before running this script.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const foundry = require('../../src/services/foundry.js');
foundry.setChatJsonProvider(createModelChatJson({
  endpoint,
  model,
  provider,
  getApiKey: async () => apiKey,
}));

const preferences = {
  targetRoles: ['Software Engineering Intern'],
  countryCodes: ['FR'],
  internshipDuration: '6 months',
  startDate: '2027-01',
};
const fictionalCv = [
  'FICTIONAL TEST CANDIDATE',
  'Computer science student with coursework in software engineering.',
  'Built a fictional course project using JavaScript, TypeScript, and Node.js.',
  'Interested in a six-month software engineering internship in France.',
].join('\n');

try {
  const analysis = await foundry.analyseCv(fictionalCv, preferences);
  console.log('CV analysis passed CareerSignal validation:');
  console.log(JSON.stringify(analysis, null, 2));

  if (process.argv.includes('--draft')) {
    const contacts = [{
      id: 'fictional-contact-1',
      fullName: 'Alex Example',
      firstName: 'Alex',
      title: 'Talent Acquisition Specialist',
      company: 'Fictional Robotics',
      fitScore: 80,
      matchReasons: ['Fictional company match for the target role.'],
      email: null,
      emailStatus: null,
    }];
    const drafts = await foundry.createDrafts({
      analysis,
      preferences,
      companies: [{ name: 'Fictional Robotics' }],
      contacts,
    });
    console.log('Fictional contact draft passed CareerSignal validation:');
    console.log(JSON.stringify(drafts, null, 2));
  }
} catch (error) {
  console.error(`Model smoke test failed: ${error.message}`);
  process.exitCode = 1;
}
