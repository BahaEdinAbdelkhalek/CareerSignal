"use strict";

const df = require("durable-functions");
const { enrichPerson } = require("../services/getprospect");

df.app.activity("EmailEnrichment", {
    handler: async ({ contacts }) => {
        const selected = (contacts || []).slice(0, 5);
        const enriched = [];

        // Sequential by design: caps credit usage and avoids burst requests.
        for (const contact of selected) {
            try {
                const person = await enrichPerson(contact);
                enriched.push({
                    id: contact.id,
                    fullName: person?.full_name || contact.fullName,
                    linkedinUrl: person?.linkedin_url || contact.linkedinUrl,
                    title: person?.primary_position?.job_title || contact.title,
                    company: person?.primary_position?.company?.name || contact.company,
                    email: person?.email?.address || null,
                    emailStatus: person?.email?.status || "not_found"
                });
            } catch (error) {
                enriched.push({
                    id: contact.id,
                    fullName: contact.fullName,
                    linkedinUrl: contact.linkedinUrl,
                    title: contact.title,
                    company: contact.company,
                    email: null,
                    emailStatus: "enrichment_failed",
                    error: error.message
                });
            }
        }

        return enriched;
    }
});