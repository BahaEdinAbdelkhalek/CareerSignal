import { Injectable } from '@angular/core';
import { Analysis, CareerSignalResult, Preferences } from './models';

@Injectable({ providedIn: 'root' })
export class DemoDataService {
  async run(cvText: string, preferences: Preferences): Promise<CareerSignalResult> {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const skills = ['Python', 'Docker', 'Linux', 'CI/CD', 'AWS'];
    const analysis: Analysis = {
      candidateSummary: 'Cloud and DevOps-focused candidate with hands-on experience building deployment pipelines, containerizing services, and supporting Linux-based workloads. This profile is fictional demonstration content.',
      skills, targetRoles: preferences.targetRoles.length ? preferences.targetRoles : ['Cloud / DevOps Engineer'],
      companyKeywords: ['cloud infrastructure', 'developer tools', 'platform engineering'], hrJobTitles: ['Technical Recruiter', 'Talent Acquisition Partner'],
      countryCodes: preferences.countryCodes, matchingCriteria: ['Cloud infrastructure teams', 'Early-career engineering opportunities'],
      gaps: ['No verified internship availability is provided by this demonstration.']
    };
    return {
      analysis,
      companies: [
        { id: 'demo-1', name: 'Northstar Cloud', industry: 'Cloud infrastructure', location: 'Amsterdam, Netherlands', fitScore: 91, matchReasons: ['Cloud infrastructure', 'Platform engineering'] },
        { id: 'demo-2', name: 'Atlas Systems', industry: 'Developer tools', location: 'Berlin, Germany', fitScore: 84, matchReasons: ['Developer tools', 'CI/CD'] },
        { id: 'demo-3', name: 'Brightline Labs', industry: 'Technology consulting', location: 'Paris, France', fitScore: 78, matchReasons: ['Cloud infrastructure', 'Python'] }
      ],
      contacts: [
        { id: 'demo-person-1', fullName: 'Maya Vermeer', title: 'Technical Talent Partner', company: 'Northstar Cloud', linkedinUrl: 'https://www.linkedin.com/', email: 'maya.vermeer@example.com', emailStatus: 'demo', enrichmentStatus: 'Demo only', fitScore: 89, matchReasons: ['HR role matches a recruiting or people-function title', 'Cloud infrastructure'] },
        { id: 'demo-person-2', fullName: 'Jonas Richter', title: 'Talent Acquisition Specialist', company: 'Atlas Systems', linkedinUrl: 'https://www.linkedin.com/', email: 'jonas.richter@example.com', emailStatus: 'demo', enrichmentStatus: 'Demo only', fitScore: 85, matchReasons: ['HR role matches a recruiting or people-function title', 'Developer tools'] },
        { id: 'demo-person-3', fullName: 'Inès Laurent', title: 'People Operations Lead', company: 'Brightline Labs', email: null, emailStatus: 'not_found', enrichmentStatus: 'Demo only', fitScore: 76, matchReasons: ['People-function title', 'Python'] }
      ],
      drafts: { results: [
        { recipient: 'Maya Vermeer', fullName: 'Maya Vermeer', company: 'Northstar Cloud', email: 'maya.vermeer@example.com', emailStatus: 'demo', subject: 'Early-career cloud engineering opportunities', body: 'Hi Maya,\n\nI’m exploring early-career opportunities in cloud and platform engineering. My recent work with Python, Docker, Linux, and CI/CD has made me especially interested in Northstar Cloud’s infrastructure work.\n\nWould you be the right person to ask about potential internship opportunities? I’d be glad to share my CV.\n\nBest,\nCandidate', personalizationEvidence: ['Demo profile: Python, Docker, Linux and CI/CD', 'Northstar Cloud focuses on cloud infrastructure'] },
        { recipient: 'Jonas Richter', fullName: 'Jonas Richter', company: 'Atlas Systems', email: 'jonas.richter@example.com', emailStatus: 'demo', subject: 'Interest in platform engineering at Atlas Systems', body: 'Hi Jonas,\n\nI’m looking for an early-career role where I can contribute to reliable developer platforms. My experience with Docker, Linux, and CI/CD aligns with the kind of developer tooling Atlas Systems builds.\n\nWould you be open to pointing me toward the right person to speak with about internships?\n\nBest,\nCandidate', personalizationEvidence: ['Demo profile: Docker, Linux and CI/CD', 'Atlas Systems works on developer tools'] },
        { recipient: 'Inès Laurent', fullName: 'Inès Laurent', company: 'Brightline Labs', email: null, emailStatus: 'not_found', subject: 'Early-career cloud engineering interest', body: 'Hi Inès,\n\nI’m exploring early-career opportunities in cloud engineering and have been building experience with Python and cloud infrastructure. Brightline Labs’ technology consulting work caught my attention.\n\nCould you suggest the best way to learn about relevant internship opportunities?\n\nBest,\nCandidate', personalizationEvidence: ['Demo profile: Python and cloud infrastructure', 'Brightline Labs works in technology consulting'] }
      ] }
    };
  }
}
