"use strict";

const { getSecret } = require("./key-vault");

function extractJson(text) {
    const cleaned = String(text || "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw new Error("Azure AI Foundry returned content that was not valid JSON.");
    }
}

async function chatJson(systemPrompt, userPrompt) {
    const endpoint = process.env.FOUNDRY_ENDPOINT?.replace(/\/+$/, "");
  const apiKey = await getSecret("FOUNDRY-API-KEY");

    const deployment = process.env.FOUNDRY_MODEL_DEPLOYMENT || "careersignal-model";

    if (!endpoint) throw new Error("Missing app setting: FOUNDRY_ENDPOINT");
    if (!apiKey) throw new Error("Missing app setting: FOUNDRY_API_KEY");

    const response = await fetch(`${endpoint}/openai/v1/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "api-key": apiKey
        },
        body: JSON.stringify({
            model: deployment,
            temperature: 0.2,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ]
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Azure AI Foundry failed (${response.status}): ${payload.error?.message || response.statusText}`);
    }

    return extractJson(payload.choices?.[0]?.message?.content);
}

async function analyseCv(cvText, preferences) {
    const system = [
        "You are CareerSignal, an assistant that analyses a candidate CV for targeted internship outreach.",
        "Return JSON only. Do not invent skills, experience, education, languages, achievements, or qualifications.",
        "Extract evidence from the CV and map it to the candidate's stated preferences.",
        "Return this shape: {\"candidateSummary\":string,\"skills\":[string],\"targetRoles\":[string],\"companyKeywords\":[string],\"hrJobTitles\":[string],\"countryCodes\":[string],\"matchingCriteria\":[string],\"gaps\":[string]}",
        "companyKeywords must contain 1-8 meaningful search phrases, each at least 3 characters.",
        "countryCodes must be ISO-3166-1 alpha-2 country codes when countries are provided."
    ].join(" ");

    return chatJson(system, JSON.stringify({ cvText, preferences }));
}

async function createDrafts({ analysis, preferences, companies, contacts }) {
    const system = [
        "You are CareerSignal, an honest professional internship application writing assistant.",
        "Return JSON only. Never invent candidate experience, skills, qualifications, or facts about a company/contact.",
        "Generate one concise, personalized outreach email for each enriched contact.",
        "If an email address is unavailable, preserve it as null and still return the draft.",
        "Return JSON shape: {\"results\":[{\"contactId\":string,\"fullName\":string,\"companyName\":string,\"email\":string|null,\"emailStatus\":string|null,\"subject\":string,\"body\":string,\"personalizationEvidence\":[string]}]}",
        "Emails should be professional, specific, concise, and request a six-month end-of-studies internship (PFE) only if this appears in preferences."
    ].join(" ");

    return chatJson(system, JSON.stringify({
        analysis,
        preferences,
        companies,
        contacts
    }));
}

module.exports = { analyseCv, createDrafts };
