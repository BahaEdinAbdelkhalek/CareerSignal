"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_HR_JOB_TITLES, normalizeHrJobTitles, getHrJobTitleSearchTerms } = require("../src/services/hr-titles");

test("rejects candidate and technical roles as HR contact-search titles", () => {
    assert.deepEqual(normalizeHrJobTitles(["Software Engineer", "Cloud Engineer", "PFE Intern"]), DEFAULT_HR_JOB_TITLES);
});

test("searches only the selected contact types and their matching title variants", () => {
    const titles = getHrJobTitleSearchTerms(["Technical Recruiter", "Cloud Engineer", "Talent Acquisition Partner"]);
    assert.deepEqual(titles, [
        "Technical Recruiter", "Engineering Recruiter", "IT Recruiter", "Technology Recruiter",
        "Talent Acquisition Partner"
    ]);
    assert.equal(titles.includes("HR Manager"), false);
});

test("retains defaults only for callers that did not select contact types", () => {
    assert.deepEqual(getHrJobTitleSearchTerms([]), DEFAULT_HR_JOB_TITLES);
});
