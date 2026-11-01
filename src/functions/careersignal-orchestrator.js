"use strict";

const df = require("durable-functions");

df.app.orchestration("CareerSignalOrchestrator", function* (context) {
    const input = context.df.getInput();

    // Step 1: CV analysis with Azure AI Foundry.
    const analysis = yield context.df.callActivity("FoundryActivity", {
        action: "analyse",
        cvBlobName: input.cvBlobName,
        preferences: input.preferences
    });

    // Step 2: Discover companies using GetProspect.
    const companies = yield context.df.callActivity("CompanyDiscovery", {
        analysis,
        preferences: input.preferences
    });

    // Step 3: Find HR / Talent Acquisition contacts at those companies.
    const contacts = yield context.df.callActivity("HRContactDiscovery", {
        companies,
        analysis
    });

    // Step 4: Enrich no more than five contacts, sequentially.
    const enrichedContacts = yield context.df.callActivity("EmailEnrichment", {
        contacts: (contacts || []).slice(0, 5)
    });

    // Step 5: Generate honest, personalized application drafts.
    const drafts = yield context.df.callActivity("FoundryActivity", {
        action: "drafts",
        analysis,
        preferences: input.preferences,
        companies,
        contacts: enrichedContacts
    });

    return {
        analysis,
        companies,
        contacts: enrichedContacts,
        drafts
    };
});