"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    extractJson,
    normalizeAnalysis,
    normalizeDraftResults
} = require("../src/services/foundry");

test("extractJson accepts a plain object and a fenced JSON response", () => {
    assert.deepEqual(extractJson('{"ok":true}'), { ok: true });
    assert.deepEqual(extractJson('```json\n{"ok":true}\n```'), { ok: true });
});

test("analysis normalization bounds fields and rejects invalid country codes", () => {
    const result = normalizeAnalysis({
        candidateSummary: "Cloud engineering student",
        skills: ["Terraform", "Docker", 12],
        targetRoles: ["Cloud Engineer"],
        companyKeywords: [],
        hrJobTitles: ["Talent Acquisition"],
        countryCodes: ["fr", "France", "DE"],
        matchingCriteria: ["Infrastructure"],
        gaps: ["No professional cloud experience stated"]
    });

    assert.deepEqual(result.skills, ["Terraform", "Docker"]);
    assert.deepEqual(result.countryCodes, ["FR", "DE"]);
    assert.deepEqual(result.companyKeywords, ["Cloud Engineer", "Terraform", "Docker"]);
});

test("draft normalization uses verified contact identity and email instead of model claims", () => {
    const contacts = [{
        id: "person-1",
        fullName: "Alex Martin",
        company: "Cloud Co",
        email: "alex@cloud.example",
        emailStatus: "valid",
        matchReasons: ["Technical Recruiter role", "Cloud keyword match"]
    }];
    const normalized = normalizeDraftResults({ results: [{
        contactId: "person-1",
        fullName: "Invented Name",
        companyName: "Invented Company",
        email: "fake@attacker.example",
        subject: "Internship enquiry",
        body: "Hello Alex, I am interested in an internship."
    }] }, contacts);

    assert.equal(normalized.results[0].fullName, "Alex Martin");
    assert.equal(normalized.results[0].companyName, "Cloud Co");
    assert.equal(normalized.results[0].email, "alex@cloud.example");
    assert.deepEqual(normalized.results[0].personalizationEvidence, ["Technical Recruiter role", "Cloud keyword match"]);
});

test("draft normalization fails closed when the model omits a selected contact", () => {
    assert.throws(() => normalizeDraftResults({ results: [] }, [{ id: "1" }]), /one valid draft/);
});
