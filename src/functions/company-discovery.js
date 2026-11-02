"use strict";

const df = require("durable-functions");
const { searchCompanies } = require("../services/getprospect");
const { scoreCompanies } = require("../services/matching");

const COMPANY_SHORTLIST_SIZE = 20;

function normalizeCompany(company) {
    const location = company.location || company.headquarters || null;
    return {
        id: company.id,
        name: company.name || company.company_name || "Unknown company",
        website: company.website || company.website_url || null,
        domain: company.domain || company.website_domain || null,
        industry: company.industry || company.industries || null,
        description: company.description || company.company_description || null,
        specialties: company.specialties || null,
        keywords: company.keywords || company.company_keywords || null,
        technologies: company.technologies || null,
        employeeCount: company.employee_count || company.employeeCount || null,
        location,
        linkedinUrl: company.linkedin_url || company.linkedinUrl || null
    };
}

df.app.activity("CompanyDiscovery", {
    handler: async ({ analysis = {}, preferences = {} }) => {
        const keywords = Array.isArray(analysis.companyKeywords) && analysis.companyKeywords.length
            ? analysis.companyKeywords
            : ["software development", "cloud computing", "IT services"];
        const countryCodes = Array.isArray(analysis.countryCodes) && analysis.countryCodes.length
            ? analysis.countryCodes
            : (preferences.countryCodes || []);

        const discovered = await searchCompanies({
            keywords,
            countryCodes,
            perPage: 100,
            maxPages: 3
        });

        const normalized = discovered.map(normalizeCompany).filter(company => company.id && company.name);
        const ranked = scoreCompanies(normalized, analysis, preferences);

        // A zero score means the available company profile contains no evidence
        // for the candidate's extracted criteria. Do not represent it as a match.
        return ranked
            .filter(company => company.fitScore > 0)
            .slice(0, COMPANY_SHORTLIST_SIZE);
    }
});
