"use strict";

const df = require("durable-functions");
const { searchCompanies } = require("../services/getprospect");

df.app.activity("CompanyDiscovery", {
    handler: async ({ analysis, preferences }) => {
        const keywords = analysis?.companyKeywords?.length
            ? analysis.companyKeywords
            : ["software development", "cloud computing", "IT services"];

        const countryCodes = analysis?.countryCodes?.length
            ? analysis.countryCodes
            : (preferences?.countryCodes || []);

        const companies = await searchCompanies({ keywords, countryCodes, perPage: 100 });

        // Keep a bounded list for the next activity and orchestration history.
        return companies.slice(0, 20).map(company => ({
            id: company.id,
            name: company.name,
            website: company.website || null,
            industry: company.industry || null,
            employeeCount: company.employee_count || null,
            location: company.location || null,
            linkedinUrl: company.linkedin_url || null
        }));
    }
});