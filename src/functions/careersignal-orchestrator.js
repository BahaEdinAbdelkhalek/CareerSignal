"use strict";

const df = require("durable-functions");

df.app.orchestration("CareerSignalOrchestrator", function* (context) {
    const input = context.df.getInput();

    const analysis = yield context.df.callActivity("FoundryActivity", {
        action: "analyse",
        cvBlobName: input.cvBlobName,
        preferences: input.preferences
    });

    const companies = yield context.df.callActivity("CompanyDiscovery", {
        analysis,
        preferences: input.preferences
    });

    const contacts = yield context.df.callActivity("HRContactDiscovery", {
        companies,
        analysis,
        preferences: input.preferences
    });

    const enrichedContacts = yield context.df.callActivity("EmailEnrichment", {
        contacts: (contacts || []).slice(0, 5)
    });

    const drafts = yield context.df.callActivity("FoundryActivity", {
        action: "drafts",
        analysis,
        preferences: input.preferences,
        companies,
        contacts: enrichedContacts
    });

    return {
        product: "CareerSignal",
        version: 2,
        analysis,
        companies,
        contacts: enrichedContacts,
        drafts,
        summary: {
            companiesShortlisted: companies.length,
            contactsShortlisted: contacts.length,
            contactsEnriched: enrichedContacts.length,
            draftsGenerated: Array.isArray(drafts?.results) ? drafts.results.length : 0
        }
    };
});
