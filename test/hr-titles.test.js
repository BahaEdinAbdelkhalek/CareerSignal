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

test("expands the HR function categories into GetProspect job-title terms", () => {
    assert.deepEqual(getHrJobTitleSearchTerms([
        "Human Resources",
        "Compensation & Benefits",
        "Culture, Diversity & Inclusion",
        "Employee & Labor Relations",
        "HR Business Partner",
        "Learning & Development",
        "Organizational Development",
        "People Operations",
        "Recruiting & Talent Acquisition",
        "Talent Management",
        "Workforce Management"
    ]), [
        "Human Resources", "HR Manager", "HR Director", "HR Generalist", "HR Specialist",
        "Compensation and Benefits", "Compensation Manager", "Benefits Manager", "Total Rewards Manager",
        "Culture and Inclusion", "Diversity and Inclusion", "Diversity and Inclusion Manager", "DEI Manager",
        "Employee Relations", "Employee Relations Manager", "Labor Relations", "Labor Relations Manager",
        "HR Business Partner", "Human Resources Business Partner", "Senior HR Business Partner", "People Partner",
        "Learning and Development", "Learning and Development Manager", "Training and Development", "Talent Development Manager",
        "Organizational Development", "Organizational Development Manager", "Organizational Effectiveness", "Change Management",
        "People Operations", "People Ops", "People Operations Manager", "People Operations Specialist",
        "Recruiter", "Recruitment Manager", "Talent Acquisition", "Talent Acquisition Manager", "Talent Sourcer",
        "Talent Management", "Talent Management Manager", "Talent Management Specialist", "Succession Planning",
        "Workforce Management", "Workforce Management Manager", "Workforce Planning", "Workforce Analyst"
    ]);
});

test("retains defaults only for callers that did not select contact types", () => {
    assert.deepEqual(getHrJobTitleSearchTerms([]), DEFAULT_HR_JOB_TITLES);
});
