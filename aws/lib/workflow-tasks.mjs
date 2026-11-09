import { createHash } from 'node:crypto';

const MAX_ENRICHMENTS = 5;
const COMPANY_SHORTLIST_SIZE = 20;

function ownerHash(ownerId) {
  return createHash('sha256').update(ownerId).digest('hex');
}

function stageKey(ownerId, searchId, name) {
  return `jobs/${ownerHash(ownerId)}/${searchId}/${name}.json`;
}

function normalizeCompany(company) {
  const location = company.location || company.headquarters || null;
  return {
    id: company.id,
    name: company.name || company.company_name || 'Unknown company',
    website: company.website || company.website_url || null,
    domain: company.domain || company.website_domain || null,
    industry: company.industry || company.industries || null,
    description: company.description || company.company_description || null,
    specialties: company.specialties || null,
    keywords: company.keywords || company.company_keywords || null,
    technologies: company.technologies || null,
    employeeCount: company.employee_count || company.employeeCount || null,
    location,
    linkedinUrl: company.linkedin_url || company.linkedinUrl || null,
  };
}

function normalizeContact(person) {
  const position = person.primary_position || person.current_position ||
    (Array.isArray(person.positions) ? person.positions[0] : {}) || {};
  const company = position.company || person.company || {};
  const email = person.email && typeof person.email === 'object' ? person.email : {};
  return {
    id: person.id || null,
    fullName: person.full_name || [person.first_name, person.last_name].filter(Boolean).join(' '),
    firstName: person.first_name || null,
    lastName: person.last_name || null,
    linkedinUrl: person.linkedin_url || null,
    title: position.job_title || person.job_title || person.title || null,
    company: company.name || person.company_name || null,
    companyId: company.id || person.company_id || null,
    hasEmail: Boolean(person.has_email || email.status === 'valid' || person.email_status === 'valid'),
    email: email.status === 'valid' ? (email.address || null) : null,
    emailStatus: email.status || person.email_status || null,
  };
}

function getEmail(person) {
  const email = person?.email;
  return email && typeof email.address === 'string' && email.status === 'valid' ? email.address : null;
}

export function createWorkflowTaskHandler({ storage, prospect, model, extractPdfText }) {
  if (!storage || !prospect || !model || typeof extractPdfText !== 'function') {
    throw new TypeError('Workflow task dependencies are required.');
  }

  return async function handler(event) {
    const { action, ownerId, searchId } = event || {};
    if (typeof ownerId !== 'string' || !ownerId || typeof searchId !== 'string' || !searchId) {
      throw new Error('Invalid workflow reference.');
    }

    try {
      if (action === 'analyse') {
        const input = await storage.getJson(event.inputKey);
        let cvText = typeof input.cvText === 'string' ? input.cvText : '';
        try {
          if (input.cvObjectKey) {
            const pdf = await storage.getObject(input.cvObjectKey);
            cvText = await extractPdfText(pdf);
          }
          if (!cvText) throw new Error('CV text is empty.');
          if (cvText.length > 100000) throw new Error('CV text exceeds the permitted limit.');
          const analysis = await model.analyseCv(cvText, input.preferences || {});
          const analysisKey = stageKey(ownerId, searchId, 'analysis');
          await storage.putJson(analysisKey, { analysis, preferences: input.preferences || {} });
          return { analysisKey };
        } finally {
          if (input.cvObjectKey) await storage.deleteObject(input.cvObjectKey).catch(() => undefined);
          await storage.deleteObject(event.inputKey).catch(() => undefined);
        }
      }

      if (action === 'discoverCompanies') {
        const profile = await storage.getJson(event.analysisKey);
        const keywords = Array.isArray(profile.analysis.companyKeywords) && profile.analysis.companyKeywords.length
          ? profile.analysis.companyKeywords
          : ['software development', 'cloud computing', 'IT services'];
        const countryCodes = Array.isArray(profile.analysis.countryCodes) && profile.analysis.countryCodes.length
          ? profile.analysis.countryCodes
          : (profile.preferences.countryCodes || []);
        const discovered = await prospect.searchCompanies({ keywords, countryCodes, perPage: 100, maxPages: 3 });
        const ranked = prospect.scoreCompanies(
          discovered.map(normalizeCompany).filter(company => company.id && company.name),
          profile.analysis,
          profile.preferences,
        ).filter(company => company.fitScore > 0).slice(0, COMPANY_SHORTLIST_SIZE);
        const companiesKey = stageKey(ownerId, searchId, 'companies');
        await storage.putJson(companiesKey, ranked);
        return { companiesKey };
      }

      if (action === 'discoverContacts') {
        const profile = await storage.getJson(event.analysisKey);
        const companies = await storage.getJson(event.companiesKey);
        const companyIds = companies.map(company => company.id).filter(Boolean);
        if (!companyIds.length) {
          const contactsKey = stageKey(ownerId, searchId, 'contacts');
          await storage.putJson(contactsKey, []);
          return { contactsKey };
        }
        const discovered = await prospect.searchHrContacts({
          companyIds,
          jobTitles: profile.analysis.hrJobTitles || [],
          perPage: 100,
          maxPages: 3,
        });
        const contacts = prospect.selectTopContacts(
          discovered.map(normalizeContact).filter(contact => contact.id && contact.fullName && contact.title),
          companies,
          profile.analysis,
          { limit: 5, minimumScore: 50, minimumCompanyScore: 20, maxPerCompany: 2 },
        );
        const contactsKey = stageKey(ownerId, searchId, 'contacts');
        await storage.putJson(contactsKey, contacts);
        return { contactsKey };
      }

      if (action === 'enrichContacts') {
        const contacts = (await storage.getJson(event.contactsKey)).slice(0, MAX_ENRICHMENTS);
        const enriched = [];
        for (const contact of contacts) {
          if (contact.email && contact.emailStatus === 'valid') {
            enriched.push({ ...contact, enrichmentStatus: 'already_available' });
            continue;
          }
          try {
            const person = await prospect.enrichPerson(contact);
            const email = getEmail(person);
            enriched.push({
              ...contact,
              fullName: person?.full_name || contact.fullName,
              linkedinUrl: person?.linkedin_url || contact.linkedinUrl,
              title: person?.primary_position?.job_title || contact.title,
              company: person?.primary_position?.company?.name || contact.company,
              email: email || contact.email || null,
              emailStatus: email ? (person?.email?.status || 'valid') : (person?.email?.status || 'not_found'),
              enrichmentStatus: 'completed',
            });
          } catch {
            enriched.push({
              ...contact,
              email: contact.email || null,
              emailStatus: contact.emailStatus || 'enrichment_failed',
              enrichmentStatus: 'failed',
            });
          }
        }
        const enrichedKey = stageKey(ownerId, searchId, 'enriched-contacts');
        await storage.putJson(enrichedKey, enriched);
        return { enrichedKey };
      }

      if (action === 'createDrafts') {
        const profile = await storage.getJson(event.analysisKey);
        const companies = await storage.getJson(event.companiesKey);
        const contacts = await storage.getJson(event.contactsKey);
        const enriched = await storage.getJson(event.enrichedKey);
        const drafts = await model.createDrafts({
          analysis: profile.analysis,
          preferences: profile.preferences,
          companies,
          contacts: enriched,
        });
        const result = {
          product: 'CareerSignal',
          version: 2,
          analysis: profile.analysis,
          companies,
          contacts: enriched,
          drafts,
          summary: {
            companiesShortlisted: companies.length,
            contactsShortlisted: contacts.length,
            contactsEnriched: enriched.length,
            draftsGenerated: Array.isArray(drafts?.results) ? drafts.results.length : 0,
          },
        };
        const resultKey = `results/${ownerHash(ownerId)}/${searchId}/result.json`;
        await storage.putJson(resultKey, result);
        await storage.cleanupSearchArtifacts(ownerId, searchId);
        await storage.markCompleted(ownerId, searchId, resultKey);
        return { completed: true };
      }

      if (action === 'markFailed') {
        await storage.cleanupSearchArtifacts(ownerId, searchId, { includeResult: true }).catch(() => undefined);
        await storage.markFailed(ownerId, searchId);
        return { failed: true };
      }

      throw new Error('Unknown workflow action.');
    } catch (error) {
      console.error('CareerSignal workflow task failed', {
        action,
        errorName: error?.name || 'Error',
        errorMessage: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Unknown error',
        errorCode: typeof error?.code === 'string' ? error.code : undefined,
        statusCode: Number.isInteger(error?.$metadata?.httpStatusCode) ? error.$metadata.httpStatusCode : undefined,
      });
      if (action === 'markFailed') throw new Error('Could not record workflow failure.');
      throw new Error('CareerSignal workflow task failed.');
    }
  };
}
