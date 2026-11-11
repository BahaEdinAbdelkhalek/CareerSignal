"use strict";

const { getHrJobTitleSearchTerms } = require("./hr-titles");

const STOP_WORDS = new Set([
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "into",
    "of", "on", "or", "the", "to", "with", "your", "our"
]);

function asStrings(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .filter(item => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean))];
}

function toSearchableText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(toSearchableText).join(" ");
    if (typeof value === "object") {
        return Object.entries(value)
            .filter(([key]) => !["id", "url", "linkedin_url", "website", "domain"].includes(key))
            .map(([, child]) => toSearchableText(child))
            .join(" ");
    }
    return "";
}

function normalizeText(value) {
    return toSearchableText(value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9+#.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(value) {
    return normalizeText(value)
        .split(" ")
        .filter(token => token && (token.length > 1 || ["ai", "hr", "it", "r", "c"].includes(token)))
        .filter(token => !STOP_WORDS.has(token));
}

function termSimilarity(term, haystack, haystackTokens) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm || !haystack) return 0;
    if ((" " + haystack + " ").includes(" " + normalizedTerm + " ")) return 1;

    const termTokens = [...new Set(tokenize(term))];
    if (!termTokens.length) return 0;
    const matched = termTokens.filter(token => haystackTokens.has(token)).length;
    const overlap = matched / termTokens.length;
    return overlap >= 0.5 ? overlap * 0.8 : 0;
}

function scoreTermGroup(terms, profile) {
    const allTerms = asStrings(terms);
    if (!allTerms.length) return { score: null, matches: [] };

    const normalizedProfile = normalizeText(profile);
    const profileTokens = new Set(tokenize(normalizedProfile));
    const scored = allTerms.map(term => ({
        term,
        score: termSimilarity(term, normalizedProfile, profileTokens)
    }));

    return {
        score: Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length * 100),
        matches: scored.filter(item => item.score >= 0.5)
    };
}

function companyProfile(company) {
    return [
        company.name,
        company.industry,
        company.description,
        company.specialties,
        company.keywords,
        company.technologies,
        company.location,
        company.employeeCount,
        company.employee_count
    ].map(toSearchableText).filter(Boolean).join(" ");
}

function scoreCompany(company, analysis = {}, preferences = {}) {
    const profile = companyProfile(company);
    const groups = [
        { key: "companyKeywords", weight: 45, terms: asStrings(analysis.companyKeywords) },
        { key: "targetRoles", weight: 15, terms: asStrings(analysis.targetRoles) },
        { key: "skills", weight: 25, terms: asStrings(analysis.skills) },
        { key: "matchingCriteria", weight: 15, terms: asStrings(analysis.matchingCriteria) }
    ].filter(group => group.terms.length);

    let weightedTotal = 0;
    let totalWeight = 0;
    const matchedTerms = [];

    for (const group of groups) {
        const result = scoreTermGroup(group.terms, profile);
        weightedTotal += (result.score || 0) * group.weight;
        totalWeight += group.weight;
        matchedTerms.push(...result.matches.map(match => match.term));
    }

    const profileScore = totalWeight ? weightedTotal / totalWeight : 0;
    const preferredCountryValues = asStrings(preferences.countryCodes).length
        ? preferences.countryCodes
        : analysis.countryCodes;
    const requestedCountries = asStrings(preferredCountryValues)
        .map(code => code.toUpperCase())
        .filter(code => /^[A-Z]{2}$/.test(code));
    const locations = [company.location, ...(Array.isArray(company.other_locations) ? company.other_locations : [])]
        .filter(Boolean);
    const knownCountries = locations
        .map(location => String(location?.country_code || location?.countryCode || "").toUpperCase())
        .filter(Boolean);
    const countryMatch = requestedCountries.length && knownCountries.length
        ? requestedCountries.some(code => knownCountries.includes(code))
        : null;

    const fitScore = countryMatch === null
        ? profileScore
        : (profileScore * 0.85) + (countryMatch ? 15 : 0);

    const matchReasons = [...new Set(matchedTerms)].slice(0, 6);
    if (countryMatch === true) matchReasons.push("Location matches preferred country");
    if (countryMatch === false) matchReasons.push("Location is outside preferred countries");

    return {
        fitScore: Math.round(fitScore),
        scoreBreakdown: {
            profileRelevance: Math.round(profileScore),
            preferredCountry: countryMatch === null ? null : (countryMatch ? 100 : 0)
        },
        matchReasons
    };
}

function scoreCompanies(companies, analysis, preferences = {}) {
    const seen = new Set();
    return (companies || [])
        .filter(company => company && company.id)
        .filter(company => {
            const key = String(company.id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(company => ({ ...company, ...scoreCompany(company, analysis, preferences) }))
        .sort((a, b) => b.fitScore - a.fitScore || String(a.name || "").localeCompare(String(b.name || "")));
}

function hrTitleSignal(title) {
    const value = normalizeText(title);
    if (!value) return 0;
    if (value.includes("campus recruiter") || value.includes("talent acquisition")) return 100;
    if (value.includes("technical recruiter") || value.includes("recruiter")) return 96;
    if (value.includes("recruitment")) return 92;
    if (value.includes("hr business partner")) return 92;
    if (value.includes("head of people") || value.includes("chief people")) return 95;
    if (value.includes("people operations") || value.includes("people ops")) return 88;
    if (value.includes("human resources")) return 86;
    if (value === "hr" || value.startsWith("hr ") || value.includes(" hr ")) return 84;
    if (value.includes("talent partner") || value.includes("talent specialist")) return 88;
    return 0;
}

function scoreContact(contact, companyById, analysis = {}, requestedTitles = []) {
    const normalizedTitle = normalizeText(contact.title);
    const titleTokens = new Set(tokenize(normalizedTitle));
    const requestedRoleScore = Math.max(0, ...requestedTitles.map(title =>
        termSimilarity(title, normalizedTitle, titleTokens) * 100
    ));
    const roleScore = Math.max(
        hrTitleSignal(contact.title),
        scoreTermGroup(analysis.hrJobTitles, contact.title).score || 0,
        requestedRoleScore
    );
    const company = companyById.get(String(contact.companyId || "")) ||
        [...companyById.values()].find(item =>
            normalizeText(item.name) && normalizeText(item.name) === normalizeText(contact.company)
        );
    const companyScore = company ? Number(company.fitScore) || 0 : 0;
    const emailScore = contact.hasEmail || contact.email ? 100 : 0;
    const isPriorityTarget = Boolean(company?.isPriorityTarget || contact.isRequestedTarget);
    const fitScore = Math.round((roleScore * 0.65) + (companyScore * 0.30) + (emailScore * 0.05));

    const matchReasons = [];
    if (roleScore >= 80) matchReasons.push("HR role matches a recruiting or people-function title");
    if (company?.isRequestedTarget) matchReasons.push("Requested company");
    else if (isPriorityTarget) matchReasons.push("Priority employer");
    if (company?.matchReasons?.length) matchReasons.push(...company.matchReasons.slice(0, 3));
    if (emailScore) matchReasons.push("GetProspect reports an email is available");

    return {
        ...contact,
        fitScore,
        isPriorityTarget,
        scoreBreakdown: {
            hrRoleRelevance: roleScore,
            companyRelevance: companyScore,
            emailAvailability: emailScore
        },
        matchReasons: [...new Set(matchReasons)].slice(0, 6)
    };
}

function selectTopContacts(contacts, companies, analysis = {}, options = {}) {
    const limit = Math.max(1, Math.min(25, Number(options.limit) || 25));
    const minimumScore = Number.isFinite(options.minimumScore) ? options.minimumScore : 50;
    const minimumCompanyScore = Number.isFinite(options.minimumCompanyScore) ? options.minimumCompanyScore : 10;
    const maxPerCompany = Math.max(1, Math.min(5, Number(options.maxPerCompany) || 5));
    const requestedContactTypes = Array.isArray(options.contactTypes) ? options.contactTypes : [];
    const requestedTitles = requestedContactTypes.length ? getHrJobTitleSearchTerms(requestedContactTypes) : [];
    const companyById = new Map((companies || []).map(company => [String(company.id), company]));
    const seen = new Set();

    const ranked = (contacts || [])
        .filter(contact => contact && (contact.id || contact.linkedinUrl || contact.fullName))
        .filter(contact => {
            const key = String(contact.id || contact.linkedinUrl || contact.fullName).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(contact => scoreContact(contact, companyById, analysis, requestedTitles))
        .filter(contact =>
            contact.fitScore >= minimumScore &&
            contact.scoreBreakdown.hrRoleRelevance >= 70 &&
            (!requestedContactTypes.length || requestedTitles.some(title => {
                const normalizedTitle = normalizeText(contact.title);
                const normalizedRequested = normalizeText(title);
                return normalizedTitle.includes(normalizedRequested) ||
                    termSimilarity(normalizedRequested, normalizedTitle, new Set(tokenize(normalizedTitle))) >= 0.5;
            })) &&
            (contact.isPriorityTarget || contact.scoreBreakdown.companyRelevance >= minimumCompanyScore)
        )
        .sort((a, b) =>
            b.fitScore - a.fitScore ||
            Number(Boolean(b.hasEmail || b.email)) - Number(Boolean(a.hasEmail || a.email)) ||
            String(a.fullName || "").localeCompare(String(b.fullName || ""))
        );

    const selected = [];
    const companyCounts = new Map();
    for (const contact of ranked) {
        const key = String(contact.companyId || contact.company || "unknown");
        const count = companyCounts.get(key) || 0;
        if (count >= maxPerCompany) continue;
        selected.push(contact);
        companyCounts.set(key, count + 1);
        if (selected.length === limit) break;
    }
    return selected;
}

module.exports = {
    normalizeText,
    scoreCompany,
    scoreCompanies,
    scoreContact,
    selectTopContacts
};
