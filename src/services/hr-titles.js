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

const CONTACT_TYPE_TITLE_TERMS = {
    "Talent Acquisition": [
        "Talent Acquisition", "Talent Acquisition Manager", "Talent Acquisition Specialist",
        "Talent Acquisition Partner", "Talent Acquisition Director"
    ],
    Recruiter: ["Recruiter", "Recruitment Manager", "Technical Recruiter", "Engineering Recruiter"],
    "Technical Recruiter": ["Technical Recruiter", "Engineering Recruiter", "IT Recruiter", "Technology Recruiter"],
    "Campus Recruiter": ["Campus Recruiter", "University Recruiter", "Graduate Recruiter", "Early Careers Recruiter"],
    "HR Manager": ["HR Manager", "Human Resources Manager", "HR Director", "Chief Human Resources Officer"],
    "HR Business Partner": ["HR Business Partner", "Human Resources Business Partner", "People Partner"],
    "People Operations": ["People Operations", "People Ops", "People Operations Manager"],
    "Head of People": ["Head of People", "Chief People Officer", "VP People", "People Director"]
};

const HR_TITLE_PATTERN = /\b(?:recruit(?:er|ing|ment)?|talent acquisition|talent sourc(?:er|ing)|human resources|hr|people operations|people ops|people partner|talent partner|head of people|chief people|vp people)\b/i;

function normalizeHrJobTitles(value) {
    if (!Array.isArray(value)) return [...DEFAULT_HR_JOB_TITLES];
    const titles = [...new Set(value
        .filter(item => typeof item === "string")
        .map(item => item.trim().slice(0, 100))
        .filter(item => item && HR_TITLE_PATTERN.test(item)))].slice(0, 20);
    return titles.length ? titles : [...DEFAULT_HR_JOB_TITLES];
}

function getHrJobTitleSearchTerms(value) {
    if (!Array.isArray(value) || !value.length) return [...DEFAULT_HR_JOB_TITLES];

    const titles = [];
    for (const item of value) {
        if (typeof item !== "string") continue;
        const title = item.trim().slice(0, 100);
        if (!title) continue;
        const standardTerms = Object.entries(CONTACT_TYPE_TITLE_TERMS)
            .find(([standardType]) => standardType.toLocaleLowerCase() === title.toLocaleLowerCase())?.[1];
        if (standardTerms) titles.push(...standardTerms);
        else if (HR_TITLE_PATTERN.test(title)) titles.push(title);
    }
    return [...new Set(titles)].slice(0, 50);
}

module.exports = { DEFAULT_HR_JOB_TITLES, CONTACT_TYPE_TITLE_TERMS, normalizeHrJobTitles, getHrJobTitleSearchTerms };
