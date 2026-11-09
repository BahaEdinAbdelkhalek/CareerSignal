"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_HR_JOB_TITLES, normalizeHrJobTitles, getHrJobTitleSearchTerms } = require("../src/services/hr-titles");

test("rejects candidate and technical roles as HR contact-search titles", () => {
    assert.deepEqual(normalizeHrJobTitles(["Software Engineer", "Cloud Engineer", "PFE Intern"]), DEFAULT_HR_JOB_TITLES);
});

test("keeps valid HR titles and always includes broad recruiter defaults in provider search", () => {
    const titles = getHrJobTitleSearchTerms(["Technical Recruiter", "Cloud Engineer", "Talent Acquisition Partner"]);
    assert.deepEqual(titles, [...DEFAULT_HR_JOB_TITLES, "Talent Acquisition Partner"]);
});
