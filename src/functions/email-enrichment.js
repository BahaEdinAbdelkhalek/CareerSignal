"use strict";

const df = require("durable-functions");
const { enrichPerson } = require("../services/getprospect");

const MAX_ENRICHMENTS = 25;

function getEmail(person) {
    const email = person?.email;
    if (email && typeof email.address === "string" && email.status === "valid") return email.address;
    return null;
}

df.app.activity("EmailEnrichment", {
    handler: async ({ contacts = [] }) => {
        const selected = contacts.slice(0, MAX_ENRICHMENTS);
        const enriched = [];

        // Sequential by design: predictable credit usage and no request burst.
        for (const contact of selected) {
            if (contact.email && contact.emailStatus === "valid") {
                enriched.push({ ...contact, enrichmentStatus: "already_available" });
                continue;
            }
            try {
                const person = await enrichPerson(contact);
                const email = getEmail(person);
                enriched.push({
                    ...contact,
                    fullName: person?.full_name || contact.fullName,
                    linkedinUrl: person?.linkedin_url || contact.linkedinUrl,
                    title: person?.primary_position?.job_title || contact.title,
                    company: person?.primary_position?.company?.name || contact.company,
                    email: email || contact.email || null,
                    emailStatus: email ? (person?.email?.status || "valid") : (person?.email?.status || "not_found"),
                    enrichmentStatus: "completed"
                });
            } catch {
                // Do not persist raw provider errors or contact details in logs/results.
                enriched.push({
                    ...contact,
                    email: contact.email || null,
                    emailStatus: contact.emailStatus || "enrichment_failed",
                    enrichmentStatus: "failed"
                });
            }
        }

        return enriched;
    }
});
