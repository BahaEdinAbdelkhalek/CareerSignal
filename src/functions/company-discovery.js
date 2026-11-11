"use strict";

const df = require("durable-functions");
const { searchCompanies } = require("../services/getprospect");
const { scoreCompanies } = require("../services/matching");

const MAX_TARGET_COMPANIES = 5;

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
        const companyNames = [...new Map((preferences.companyNames || [])
            .filter(value => typeof value === "string")
            .map(value => value.trim())
            .filter(value => value.length >= 2 && value.length <= 100)
            .map(value => [value.toLocaleLowerCase(), value])).values()].slice(0, MAX_TARGET_COMPANIES);
        if (!companyNames.length) throw new Error("Enter between one and five companies to search.");
        const countryCodes = Array.isArray(preferences.countryCodes) ? preferences.countryCodes : (analysis.countryCodes || []);

        const discovered = await searchCompanies({
            companyNames,
            countryCodes,
            perPage: 100,
            maxPages: 2
        });

        return scoreCompanies(
            discovered.map(normalizeCompany).filter(company => company.id && company.name),
            analysis,
            preferences
        ).map(company => ({
            ...company,
            isRequestedTarget: true,
            isPriorityTarget: true,
            matchReasons: [...new Set(["Requested company", ...(company.matchReasons || [])])].slice(0, 6)
        })).slice(0, MAX_TARGET_COMPANIES);
    }
});
