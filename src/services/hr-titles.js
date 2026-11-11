"use strict";

const DEFAULT_HR_JOB_TITLES = [
    "Recruiter",
    "Technical Recruiter",
    "Engineering Recruiter",
    "Corporate Recruiter",
    "Executive Recruiter",
    "Campus Recruiter",
    "University Recruiter",
    "Graduate Recruiter",
    "Early Careers Recruiter",
    "Recruiting Coordinator",
    "Recruitment Manager",
    "Recruitment Consultant",
    "Talent Acquisition",
    "Talent Acquisition Manager",
    "Talent Acquisition Partner",
    "Talent Acquisition Specialist",
    "Talent Acquisition Director",
    "Talent Sourcer",
    "HR Manager",
    "Human Resources Manager",
    "HR Director",
    "HR Business Partner",
    "HR Generalist",
    "HR Specialist",
    "HR Coordinator",
    "HR Administrator",
    "HR Assistant",
    "HR Operations Manager",
    "HRIS Manager",
    "HRIS Analyst",
    "People Operations Manager",
    "People Operations Specialist",
    "People Partner",
    "People Director",
    "Head of People",
    "Chief People Officer",
    "Chief Human Resources Officer",
    "VP of Human Resources",
    "VP of People",
    "Employee Relations Manager",
    "Compensation and Benefits Manager",
    "Learning and Development Manager",
    "Organizational Development Manager",
    "People and Culture Manager"
];

const CONTACT_TYPE_TITLE_TERMS = {
    "Human Resources": ["Human Resources", "HR Manager", "HR Director", "HR Generalist", "HR Specialist"],
    "Compensation & Benefits": ["Compensation and Benefits", "Compensation Manager", "Benefits Manager", "Total Rewards Manager"],
    "Culture, Diversity & Inclusion": ["Culture and Inclusion", "Diversity and Inclusion", "Diversity and Inclusion Manager", "DEI Manager"],
    "Employee & Labor Relations": ["Employee Relations", "Employee Relations Manager", "Labor Relations", "Labor Relations Manager"],
    "HR Business Partner": ["HR Business Partner", "Human Resources Business Partner", "Senior HR Business Partner", "People Partner"],
    "Learning & Development": ["Learning and Development", "Learning and Development Manager", "Training and Development", "Talent Development Manager"],
    "Organizational Development": ["Organizational Development", "Organizational Development Manager", "Organizational Effectiveness", "Change Management"],
    "People Operations": ["People Operations", "People Ops", "People Operations Manager", "People Operations Specialist"],
    "Recruiting & Talent Acquisition": ["Recruiter", "Recruitment Manager", "Talent Acquisition", "Talent Acquisition Manager", "Talent Sourcer"],
    "Talent Management": ["Talent Management", "Talent Management Manager", "Talent Management Specialist", "Succession Planning"],
    "Workforce Management": ["Workforce Management", "Workforce Management Manager", "Workforce Planning", "Workforce Analyst"],
    "Talent Acquisition": ["Talent Acquisition", "Talent Acquisition Manager", "Talent Acquisition Specialist", "Talent Acquisition Partner", "Talent Acquisition Director"],
    Recruiter: ["Recruiter", "Recruitment Manager", "Technical Recruiter", "Engineering Recruiter"],
    "Technical Recruiter": ["Technical Recruiter", "Engineering Recruiter", "IT Recruiter", "Technology Recruiter"],
    "Campus Recruiter": ["Campus Recruiter", "University Recruiter", "Graduate Recruiter", "Early Careers Recruiter"],
    "HR Manager": ["HR Manager", "Human Resources Manager", "HR Director", "Chief Human Resources Officer"],
    "Head of People": ["Head of People", "Chief People Officer", "VP People", "People Director"]
};

const HR_TITLE_PATTERN = /\b(?:recruit(?:er|ing|ment)?|talent acquisition|talent management|talent sourc(?:er|ing)|human resources|hr|hris|people operations|people ops|people partner|talent partner|head of people|chief people|vp of people|people and culture|culture|diversity|inclusion|employee relations|labor relations|compensation\s*(?:&|and)\s*benefits|learning\s*(?:&|and)\s*development|organizational development|workforce management|workforce planning)\b/i;

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
