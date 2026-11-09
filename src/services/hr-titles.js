"use strict";

const DEFAULT_HR_JOB_TITLES = [
    "Talent Acquisition",
    "Talent Acquisition Manager",
    "Recruiter",
    "Technical Recruiter",
    "HR Manager",
    "Human Resources Manager",
    "People Operations",
    "HR Business Partner",
    "Head of People",
    "Chief Human Resources Officer",
    "Campus Recruiter"
];

const HR_TITLE_PATTERN = /\b(?:recruit(?:er|ing|ment)?|talent acquisition|human resources|hr|people operations|people ops|talent partner|head of people|chief people)\b/i;

function normalizeHrJobTitles(value) {
    if (!Array.isArray(value)) return [...DEFAULT_HR_JOB_TITLES];
    const titles = [...new Set(value
        .filter(item => typeof item === "string")
        .map(item => item.trim().slice(0, 100))
        .filter(item => item && HR_TITLE_PATTERN.test(item)))].slice(0, 20);
    return titles.length ? titles : [...DEFAULT_HR_JOB_TITLES];
}

function getHrJobTitleSearchTerms(value) {
    return [...new Set([...DEFAULT_HR_JOB_TITLES, ...normalizeHrJobTitles(value)])];
}

module.exports = { DEFAULT_HR_JOB_TITLES, normalizeHrJobTitles, getHrJobTitleSearchTerms };
