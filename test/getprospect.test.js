"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { searchPages } = require("../src/services/getprospect");

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
