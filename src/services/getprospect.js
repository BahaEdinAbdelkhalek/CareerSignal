"use strict";

const { getHrJobTitleSearchTerms } = require("./hr-titles");

let apiKeyProvider = secretName => require("./key-vault").getSecret(secretName);

const BASE_URL = "https://api.getprospect.com";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_SAFE_SEARCH_PAGES = 3;
const MAX_RETRIES = 2;

function parseRetryDelay(value, attempt) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10000);
    return Math.min(500 * (2 ** attempt), 4000);
}

function setApiKeyProvider(provider) {
    if (provider !== null && typeof provider !== "function") {
        throw new TypeError("GetProspect API key provider must be a function or null.");
    }
    apiKeyProvider = provider || (secretName => require("./key-vault").getSecret(secretName));
}

async function post(path, body, { retrySafe = false } = {}) {
    const apiKey = await apiKeyProvider("GetProspectApiKey");
    if (!apiKey) throw new Error("Key Vault secret GetProspectApiKey is empty.");

    for (let attempt = 0; ; attempt++) {
        let response;
        try {
            response = await fetch(`${BASE_URL}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
        } catch (error) {
            if (retrySafe && attempt < MAX_RETRIES && error.name !== "AbortError") {
                await new Promise(resolve => setTimeout(resolve, parseRetryDelay(null, attempt)));
                continue;
            }
            throw new Error(`GetProspect ${path} request failed: ${error.name || "network error"}`);
        }

        const payload = await response.json().catch(() => ({}));
        const transient = response.status === 429 || [500, 502, 503, 504].includes(response.status);
        if (retrySafe && transient && attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, parseRetryDelay(response.headers.get("retry-after"), attempt)));
            continue;
        }

        if (!response.ok || payload.success === false) {
            const detail = payload.errors?.[0]?.message || payload.message || response.statusText;
            const error = new Error(`GetProspect ${path} failed (${response.status}): ${String(detail).slice(0, 300)}`);
            error.status = response.status;
            error.code = payload.errors?.[0]?.code || payload.error?.code || payload.code || null;
            throw error;
        }

        return payload;
    }
}

async function searchPages(path, requestBody, perPage, maxPages = MAX_SAFE_SEARCH_PAGES, postRequest = post) {
    const results = [];
    let totalPages = maxPages;

    for (let page = 1; page <= maxPages && page <= totalPages; page++) {
        const payload = await postRequest(path, { ...requestBody, page, per_page: perPage }, { retrySafe: true });
        const pageData = Array.isArray(payload.data) ? payload.data : [];
        results.push(...pageData);

        const pagination = payload.metadata?.pagination || {};
        if (Number.isInteger(pagination.total_pages) && pagination.total_pages > 0) {
            totalPages = Math.min(pagination.total_pages, maxPages);
        } else if (pageData.length < perPage) {
            break;
        }
    }

    return results;
}

async function searchCompanies({ keywords = [], companyNames = [], countryCodes = [], perPage = 100, maxPages = MAX_SAFE_SEARCH_PAGES, postRequest = post }) {
    const cleanKeywords = [...new Set(keywords
        .map(value => String(value).trim())
        .filter(value => value.length >= 3 && value.length <= 100))].slice(0, 20);
    const cleanCompanyNames = [...new Set(companyNames
        .map(value => String(value).trim())
        .filter(value => value.length >= 2 && value.length <= 100))].slice(0, 150);

    if (!cleanKeywords.length && !cleanCompanyNames.length) {
        throw new Error("Company discovery requires at least one company keyword or company name.");
    }

    const countries = [...new Set(countryCodes
        .map(value => String(value).trim().toUpperCase())
        .filter(value => /^[A-Z]{2}$/.test(value)))];
    const safePageSize = [25, 50, 100].includes(perPage) ? perPage : 100;
    const searches = [];

    if (cleanKeywords.length) {
        const filters = { company_keywords: { include: cleanKeywords } };
        if (countries.length) filters.company_country = { include: countries };
        searches.push(searchPages("/v2/companies/search", { filters }, safePageSize, maxPages, postRequest));
    }
    if (cleanCompanyNames.length) {
        const filters = { company: { name: { include: cleanCompanyNames } } };
        if (countries.length) filters.company_country = { include: countries };
        const nameSearchPages = Math.max(1, Math.min(2, Number(maxPages) || 2));
        searches.push(searchPages("/v2/companies/search", { filters }, safePageSize, nameSearchPages, postRequest));
    }

    const results = (await Promise.all(searches)).flat();
    const seen = new Set();
    return results.filter(company => {
        const id = String(company?.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

async function searchHrContacts({ companyIds, jobTitles, contactTypes, perPage = 100, maxPages = MAX_SAFE_SEARCH_PAGES, postRequest = post }) {
    const ids = [...new Set((companyIds || []).filter(Boolean).map(String))].slice(0, 100);
    if (!ids.length) return [];

    const requestedTypes = Array.isArray(contactTypes) && contactTypes.length ? contactTypes : jobTitles;
    const titles = getHrJobTitleSearchTerms(requestedTypes);
    if (!titles.length) throw new Error("Choose at least one valid HR or recruiting contact type.");
    const filters = {
        company: { id: { include: ids } },
        person_job_title: {
            include: titles,
            match_mode: "CONTAINS"
        },
        max_person_per_company: 2
    };

    const safePageSize = [25, 50, 100].includes(perPage) ? perPage : 100;
    const payload = await searchPages("/v2/people/search", {
        filters,
        sort_by: "person_email_available",
        sort_direction: "desc"
    }, safePageSize, maxPages, postRequest);
    return payload;
}

async function enrichPerson(person) {
    if (!person?.id) return null;

    // This is the existing synchronous People Enrich endpoint used by this project.
    // Do not automatically retry: revealing an email can consume credits.
    const result = await post("/v2/people/enrich", {
        data: { id: person.id },
        enrich_email: true,
        enrich_phone: false
    });
    return result.data || null;
}

module.exports = { searchCompanies, searchHrContacts, enrichPerson, searchPages, setApiKeyProvider };
