"use strict";

const df = require("durable-functions");
const { searchHrContacts } = require("../services/getprospect");

df.app.activity("HRContactDiscovery", {
    handler: async ({ companies, analysis }) => {
        const companyIds = (companies || []).map(company => company.id).filter(Boolean);
        if (!companyIds.length) return [];

        const contacts = await searchHrContacts({
            companyIds,
            jobTitles: analysis?.hrJobTitles || [],
            perPage: 100
        });

        return contacts.slice(0, 25).map(person => ({
            id: person.id,
            fullName: person.full_name || [person.first_name, person.last_name].filter(Boolean).join(" "),
            firstName: person.first_name || null,
            lastName: person.last_name || null,
            linkedinUrl: person.linkedin_url || null,
            title: person.primary_position?.job_title || null,
            company: person.primary_position?.company?.name || null,
            companyId: person.primary_position?.company?.id || null,
            hasEmail: Boolean(person.has_email),
            emailStatus: person.email_status || person.email?.status || null
        }));
    }
});