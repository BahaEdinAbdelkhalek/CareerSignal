"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    scoreCompany,
    scoreCompanies,
    selectTopContacts
} = require("../src/services/matching");

test("company scoring rewards profile relevance and preferred country", () => {
    const company = {
        id: "1",
        name: "Cloud Platform Labs",
        industry: "Software Development",
        description: "Cloud infrastructure and DevOps platform engineering",
        keywords: ["cloud computing", "infrastructure", "DevOps"],
        location: { country_code: "FR", country: "France" }
    };
    const scored = scoreCompany(company, {
        companyKeywords: ["cloud computing", "DevOps"],
        targetRoles: ["Cloud Engineer"],
        skills: ["Terraform", "Docker"],
        matchingCriteria: ["infrastructure"]
    }, { countryCodes: ["FR"] });

    assert.ok(scored.fitScore >= 60);
    assert.ok(scored.matchReasons.includes("Location matches preferred country"));
});

test("company ranking is deterministic and removes duplicate IDs", () => {
    const companies = [
        { id: "1", name: "Cloud Co", industry: "Cloud Computing", description: "DevOps services" },
        { id: "2", name: "Retail Co", industry: "Retail", description: "Stores" },
        { id: "1", name: "Cloud Co duplicate", industry: "Cloud Computing" }
    ];
    const ranked = scoreCompanies(companies, { companyKeywords: ["cloud computing", "DevOps"] });

    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].id, "1");
    assert.ok(ranked[0].fitScore > ranked[1].fitScore);
});

test("contact selection ranks HR relevance, company fit and limits concentration", () => {
    const companies = [
        { id: "c1", name: "Cloud Co", fitScore: 90, matchReasons: ["Matches cloud keywords"] },
        { id: "c2", name: "Retail Co", fitScore: 15, matchReasons: [] },
        { id: "c3", name: "Platform Co", fitScore: 75, matchReasons: ["Matches platform keywords"] }
    ];
    const contacts = [
        { id: "p1", fullName: "Alex Recruiter", title: "Technical Recruiter", company: "Cloud Co", companyId: "c1", hasEmail: true },
        { id: "p2", fullName: "Sam HR", title: "HR Manager", company: "Retail Co", companyId: "c2", hasEmail: true },
        { id: "p3", fullName: "Taylor Talent", title: "Talent Acquisition Partner", company: "Platform Co", companyId: "c3", hasEmail: false },
        { id: "p4", fullName: "Morgan Engineer", title: "Software Engineer", company: "Cloud Co", companyId: "c1", hasEmail: true },
        { id: "p5", fullName: "Jordan Recruiter", title: "Recruiter", company: "Cloud Co", companyId: "c1", hasEmail: true }
    ];

    const selected = selectTopContacts(contacts, companies, {
        hrJobTitles: ["Technical Recruiter", "Talent Acquisition"]
    }, { minimumCompanyScore: 20 });

    assert.deepEqual(selected.map(contact => contact.id), ["p1", "p5", "p3"]);
    assert.ok(selected.every(contact => contact.fitScore >= 50));
    assert.ok(selected[0].matchReasons.length > 0);
});

test("selected HR contact types exclude other HR titles", () => {
    const selected = selectTopContacts([
        { id: "p1", title: "Talent Acquisition Partner", companyId: "c1", company: "Example Co" },
        { id: "p2", title: "HR Manager", companyId: "c1", company: "Example Co" }
    ], [
        { id: "c1", name: "Example Co", fitScore: 80, isRequestedTarget: true }
    ], {}, { contactTypes: ["Talent Acquisition"] });

    assert.deepEqual(selected.map(contact => contact.id), ["p1"]);
});

test("contact selection allows HR contacts at explicitly prioritized employers", () => {
    const selected = selectTopContacts([
        { id: "p1", title: "Human Resources Manager", companyId: "c1", company: "Safran" }
    ], [
        { id: "c1", name: "Safran", fitScore: 0, isPriorityTarget: true, matchReasons: ["Priority employer"] }
    ], { hrJobTitles: ["HR Manager"] });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].isPriorityTarget, true);
    assert.ok(selected[0].matchReasons.includes("Priority employer"));
});

test("contact selection rejects non-HR titles and weak company matches", () => {
    const selected = selectTopContacts([
        { id: "p1", title: "Software Engineer", companyId: "c1", company: "Cloud Co" },
        { id: "p2", title: "Recruiter", companyId: "c2", company: "Retail Co" }
    ], [
        { id: "c1", name: "Cloud Co", fitScore: 95, matchReasons: [] },
        { id: "c2", name: "Retail Co", fitScore: 0, matchReasons: [] }
    ], { hrJobTitles: ["Recruiter"] });

    assert.equal(selected.length, 0);
});
