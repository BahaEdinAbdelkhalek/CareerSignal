"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { searchCompanies, searchHrContacts, searchPages } = require("../src/services/getprospect");

test("company search merges CV-keyword matches with exact priority-employer matches", async () => {
    const requests = [];
    const results = await searchCompanies({
        keywords: ["cloud infrastructure"],
        companyNames: ["ALTEN", "Safran"],
        countryCodes: ["FR"],
        postRequest: async (_path, body) => {
            requests.push(body);
            return { data: body.filters.company
                ? [{ id: "alten-id", name: "ALTEN" }]
                : [{ id: "alten-id", name: "ALTEN" }, { id: "cloud-id", name: "Cloud Co" }] };
        }
    });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].filters.company_keywords.include, ["cloud infrastructure"]);
    assert.deepEqual(requests[0].filters.company_country.include, ["FR"]);
    assert.deepEqual(requests[1].filters.company.name.include, ["ALTEN", "Safran"]);
    assert.equal(requests[1].filters.company_country, undefined);
    assert.deepEqual(results.map(company => company.id), ["alten-id", "cloud-id"]);
});

test("caps exact company suggestion searches to the requested page count", async () => {
    const requestedPages = [];
    await searchCompanies({
        companyNames: ["Example"],
        perPage: 25,
        maxPages: 1,
        postRequest: async (_path, body) => {
            requestedPages.push(body.page);
            return { data: [{ id: "company-1", name: "Example" }], metadata: { pagination: { total_pages: 4 } } };
        }
    });

    assert.deepEqual(requestedPages, [1]);
});

test("searches HR contacts by selected company domains and people locations", async () => {
    let request;
    await searchHrContacts({
        companyIds: ["company-1"],
        companyDomains: ["https://www.pwc.com/global/en.html", "ey.com"],
        personLocations: ["Tunisia", "Morocco"],
        contactTypes: ["Talent Acquisition"],
        postRequest: async (_path, body) => {
            request = body;
            return { data: [] };
        }
    });

    assert.deepEqual(request.filters.company.domain.include, ["pwc.com", "ey.com"]);
    assert.equal(request.filters.company.domain.match_mode, "ORGANIZATION");
    assert.deepEqual(request.filters.person_location.include, ["Tunisia", "Morocco"]);
    assert.deepEqual(request.filters.person_job_title.include, [
        "Talent Acquisition", "Talent Acquisition Manager", "Talent Acquisition Specialist",
        "Talent Acquisition Partner", "Talent Acquisition Director"
    ]);
    assert.equal(request.filters.person_job_title.match_mode, "CONTAINS");
    assert.equal(request.filters.max_person_per_company, 5);
});

test("searchPages follows API pagination metadata but respects the configured cap", async () => {
    const requestedPages = [];
    const result = await searchPages("/search", { filters: {} }, 2, 2, async (_path, body) => {
        requestedPages.push(body.page);
        return {
            data: [{ id: String(body.page * 10) }, { id: String(body.page * 10 + 1) }],
            metadata: { pagination: { page: body.page, per_page: 2, total_pages: 9 } }
        };
    });

    assert.deepEqual(requestedPages, [1, 2]);
    assert.deepEqual(result.map(item => item.id), ["10", "11", "20", "21"]);
});

test("searchPages stops when pagination metadata says there is only one page", async () => {
    const requestedPages = [];
    const result = await searchPages("/search", {}, 100, 3, async (_path, body) => {
        requestedPages.push(body.page);
        return { data: [{ id: "only-result" }], metadata: { pagination: { total_pages: 1 } } };
    });

    assert.deepEqual(requestedPages, [1]);
    assert.equal(result.length, 1);
});

test("searchPages safely stops on a short page when pagination metadata is absent", async () => {
    const requestedPages = [];
    const result = await searchPages("/search", {}, 2, 3, async (_path, body) => {
        requestedPages.push(body.page);
        return { data: [{ id: "one" }] };
    });

    assert.deepEqual(requestedPages, [1]);
    assert.equal(result.length, 1);
});
