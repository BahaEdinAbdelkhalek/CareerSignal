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
        if (start >= 0 && end > start) {
            return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error("Azure AI Foundry returned content that was not valid JSON.");
    }
}

function getResponseText(payload) {
    if (typeof payload.output_text === "string" && payload.output_text.trim()) {
        return payload.output_text.trim();
    }

    const parts = [];
    for (const item of payload.output || []) {
        if (!Array.isArray(item.content)) continue;
        for (const content of item.content) {
            if (content.type === "output_text" && typeof content.text === "string") {
                parts.push(content.text);
            }
        }
    }
    return parts.join("\n").trim();
}

async function chatJson(systemPrompt, userPrompt) {
    const endpoint = (process.env.FOUNDRY_ENDPOINT || "").replace(/\/+$/, "");
    const deployment = process.env.FOUNDRY_MODEL_DEPLOYMENT || "";

    if (!endpoint) throw new Error("Missing app setting: FOUNDRY_ENDPOINT");
    if (!deployment) throw new Error("Missing app setting: FOUNDRY_MODEL_DEPLOYMENT");

    // This is the exact Key Vault secret name already used by the project.
    const apiKey = await getSecret("FOUNDRY-API-KEY");
    if (!apiKey) throw new Error("Key Vault secret FOUNDRY-API-KEY is empty.");

    // Azure AI Foundry's Responses API endpoint (not chat/completions).
    const url = `${endpoint}/openai/v1/responses`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "api-key": apiKey
        },
        body: JSON.stringify({
            model: deployment,
            instructions: systemPrompt,
            input: userPrompt,
            text: {
                format: { type: "json_object" }
            }
        }),
        signal: AbortSignal.timeout(120000)
    });

    const rawBody = await response.text();
    let payload;
    try {
        payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        payload = {};
    }

    if (!response.ok) {
        const message = payload.error?.message || payload.message || rawBody || response.statusText;
        throw new Error(`Azure AI Foundry Responses API failed (${response.status}): ${String(message).slice(0, 1500)}`);
    }

    if (payload.status && payload.status !== "completed") {
        throw new Error(`Azure AI Foundry response status was '${payload.status}'. ${payload.incomplete_details?.reason || payload.error?.message || "No additional details."}`);
    }

    const generatedText = getResponseText(payload);
    if (!generatedText) {
        throw new Error("Azure AI Foundry returned HTTP 200 but no output text. Response ID: " + (payload.id || "unknown"));
    }

    return extractJson(generatedText);
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

    return chatJson(system, JSON.stringify({ analysis, preferences, companies, contacts }));
}

module.exports = { analyseCv, createDrafts };