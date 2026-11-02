"use strict";

const df = require("durable-functions");
const { searchHrContacts } = require("../services/getprospect");
const { selectTopContacts } = require("../services/matching");

function mapContact(person) {
    const position = person.primary_position || person.current_position ||
        (Array.isArray(person.positions) ? person.positions[0] : {}) || {};
    const company = position.company || person.company || {};
    const email = person.email && typeof person.email === "object" ? person.email : {};

    return {
        id: person.id || null,
        fullName: person.full_name || [person.first_name, person.last_name].filter(Boolean).join(" "),
        firstName: person.first_name || null,
        lastName: person.last_name || null,
        linkedinUrl: person.linkedin_url || null,
        title: position.job_title || person.job_title || person.title || null,
        company: company.name || person.company_name || null,
        companyId: company.id || person.company_id || null,
        hasEmail: Boolean(person.has_email || email.status === "valid" || person.email_status === "valid"),
        email: email.status === "valid" ? (email.address || null) : null,
        emailStatus: email.status || person.email_status || null
    };
}

df.app.activity("HRContactDiscovery", {
    handler: async ({ companies = [], analysis = {} }) => {
        const companyIds = companies.map(company => company.id).filter(Boolean);
        if (!companyIds.length) return [];

        const discovered = await searchHrContacts({
            companyIds,
            jobTitles: analysis.hrJobTitles || [],
            perPage: 100,
            maxPages: 3
        });

        const contacts = discovered.map(mapContact).filter(contact => contact.id && contact.fullName && contact.title);
        return selectTopContacts(contacts, companies, analysis, {
            limit: 5,
            minimumScore: 50,
            minimumCompanyScore: 20,
            maxPerCompany: 2
        });
    }
});
