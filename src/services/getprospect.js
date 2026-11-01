"use strict";

const BASE_URL = "https://api.getprospect.com";

async function post(path, body) {
    const apiKey = process.env.GETPROSPECT_API_KEY;
    if (!apiKey) throw new Error("Missing app setting: GETPROSPECT_API_KEY");

    const response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey
        },
        body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.success === false) {
        const detail = payload.errors?.[0]?.message || payload.message || response.statusText;
        throw new Error(`GetProspect ${path} failed (${response.status}): ${detail}`);
    }

    return payload;
}

async function searchCompanies({ keywords, countryCodes = [], perPage = 100 }) {
    const cleanKeywords = [...new Set((keywords || [])
        .map(value => String(value).trim())
        .filter(value => value.length >= 3))].slice(0, 20);

    if (cleanKeywords.length === 0) {
        throw new Error("Company discovery requires at least one company keyword (3+ characters).");
    }

    const filters = {
        company_keywords: { include: cleanKeywords }
    };

    const countries = [...new Set((countryCodes || [])
        .map(value => String(value).trim().toUpperCase())
        .filter(value => /^[A-Z]{2}$/.test(value)))];

    if (countries.length) {
        filters.company_country = { include: countries };
    }

    const result = await post("/v2/companies/search", {
        filters,
        per_page: [25, 50, 100].includes(perPage) ? perPage : 100,
        page: 1
    });

    return Array.isArray(result.data) ? result.data : [];
}

async function searchHrContacts({ companyIds, jobTitles, perPage = 100 }) {
    const ids = [...new Set((companyIds || []).filter(Boolean))].slice(0, 100);
    if (!ids.length) return [];

    const titles = [...new Set((jobTitles || []).map(x => String(x).trim()).filter(Boolean))];

    const filters = {
        company: { id: { include: ids } },
        person_job_title: {
            include: titles.length ? titles : [
                "Talent Acquisition",
                "Talent Acquisition Manager",
                "Recruiter",
                "Technical Recruiter",
                "HR Manager",
                "Human Resources Manager",
                "People Operations",
                "HR Business Partner",
                "Head of People",
                "Chief Human Resources Officer"
            ]
        }
    };

    const result = await post("/v2/people/search", {
        filters,
        per_page: [25, 50, 100].includes(perPage) ? perPage : 100,
        page: 1
    });

    return Array.isArray(result.data) ? result.data : [];
}

async function enrichPerson(person) {
    if (!person?.id) return null;

    const result = await post("/v2/people/enrich", {
        data: { id: person.id },
        enrich_email: true,
        enrich_phone: false
    });

    return result.data || null;
}

module.exports = { searchCompanies, searchHrContacts, enrichPerson };