import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoDataService } from './demo-data.service';
import { CareerSignalApiService } from './career-signal-api.service';
import { CareerSignalResult, Company, Contact, Draft, Preferences } from './models';


type CountryOption = { code: string; name: string };
const ISO_COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`;
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const COUNTRY_OPTIONS: CountryOption[] = ISO_COUNTRY_CODES.split(' ').map(code => ({ code, name: countryNames.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header class="app-header">
      <a class="brand" href="#workspace"><img class="brand-logo" src="/assets/careersignal-logo.png" alt="CareerSignal"></a>
      <button class="mode-label mode-toggle" type="button" (click)="toggleMode()" [attr.aria-label]="liveMode ? 'Switch to demo mode' : 'Sign in for live search'">{{ liveMode ? 'Live' : 'Demo' }}</button>
    </header>

    <main id="workspace" class="app-shell">
      <aside class="left-column">
        <section *ngIf="!result" class="panel upload-panel">
          <div class="panel-heading">
            <div><h1>{{ reviewing ? 'Review search' : 'Start a search' }}</h1></div>

          </div>

          <form *ngIf="!reviewing" (submit)="submit($event)" novalidate>
            <label class="field-label" for="cv">CV <span>PDF, max 10 MB</span></label>
            <label class="upload-zone" for="cv" [class.has-file]="file" (dragover)="allowDrop($event)" (drop)="dropFile($event)">
              <input id="cv" type="file" accept="application/pdf,.pdf" (change)="selectFile($event)">
              <span class="upload-mark">+</span>
              <strong>{{ file?.name || 'Choose a PDF or drop it here' }}</strong>
              <small>{{ file ? (file.size / 1024 / 1024 | number:'1.1-1') + ' MB' : (liveMode ? 'Uploaded after confirmation' : 'Stays on this device in demo mode') }}</small>
            </label>
            <div *ngIf="fileError" class="error-text" role="alert">{{ fileError }}</div>

            <div class="field target-company-field">
              <span>Companies to search <small>Required · 1–5</small></span>
              <div class="target-company-chips" aria-label="Selected companies">
                <span class="target-company-chip" *ngFor="let company of selectedCompanies">
                  <span class="company-picker-logo"><span>{{ companyInitials(company.name) }}</span><img *ngIf="companyLogoUrlFor(company) as logoUrl" [src]="logoUrl" alt="" loading="lazy" (error)="$any($event.target).hidden=true"></span>
                  <span class="target-company-name">{{ company.name }}</span>
                  <button type="button" [attr.aria-label]="'Remove '+company.name" (click)="removeCompany(company)">×</button>
                </span>
              </div>
              <div class="company-search-control"><input [(ngModel)]="companySearch" name="companySearch" placeholder="Search company name" aria-label="Company name" autocomplete="off" maxlength="100" [disabled]="selectedCompanies.length >= 5" (keydown)="companyKeydown($event)"><button class="button secondary" type="button" (click)="lookupCompanyMatches()" [disabled]="companyLookupBusy || selectedCompanies.length >= 5 || !companySearch.trim()">{{ companyLookupBusy ? 'Searching…' : 'Search' }}</button></div>
              <div class="company-options" *ngIf="showCompanyOptions && companyResults.length" role="listbox" aria-label="Company search results">
                <button type="button" role="option" *ngFor="let company of companyResults" (click)="selectCompany(company)"><span class="company-picker-logo"><span>{{ companyInitials(company.name) }}</span><img *ngIf="companyLogoUrlFor(company) as logoUrl" [src]="logoUrl" alt="" loading="lazy" (error)="$any($event.target).hidden=true"></span><span class="company-option-copy"><strong>{{ company.name }}</strong><small>{{ company.industry || company.domain || company.website || 'Company' }}</small></span></button>
              </div>
              <small *ngIf="!liveMode" class="targeting-hint">Switch to Live mode to search GetProspect and load company logos.</small>
              <div *ngIf="companyLookupError" class="error-text" role="alert">{{ companyLookupError }}</div>
              <div *ngIf="targetingError" class="error-text" role="alert">{{ targetingError }}</div>
            </div>

            <div class="field contact-type-field">
              <span>People to find <small>Choose one or more</small></span>
              <div class="contact-type-options"><label class="contact-type-option" *ngFor="let type of contactTypeOptions"><input type="checkbox" [checked]="selectedContactTypes.includes(type)" (change)="toggleContactType(type, $any($event.target).checked)"><span>{{ type }}</span></label></div>
              <div class="selected-contact-types"><span class="contact-type-chip" *ngFor="let type of customContactTypes">{{ type }}<button type="button" [attr.aria-label]="'Remove '+type" (click)="removeContactType(type)">×</button></span></div>
              <div class="custom-contact-entry"><input [(ngModel)]="customContactTitle" name="customContactTitle" placeholder="Add another HR or recruiting title" aria-label="Other HR or recruiting title" maxlength="100" (keydown)="contactTitleKeydown($event)"><button class="button secondary" type="button" (click)="addCustomContactType()">Add title</button></div>
              <div *ngIf="contactTypeError" class="error-text" role="alert">{{ contactTypeError }}</div>
              <small class="targeting-hint">Only contacts with the selected HR or recruiting titles will be searched.</small>
            </div>

            <div class="field-grid">
              <div class="field"><span>Target roles</span><div class="role-picker"><div class="selected-roles"><span class="role-chip" *ngFor="let role of selectedRoles">{{ role }}<button type="button" [attr.aria-label]="'Remove '+role" (click)="removeRole(role)">×</button></span><input [(ngModel)]="roleSearch" name="roleSearch" placeholder="Search job titles" autocomplete="off" (focus)="showRoleOptions=true" (input)="showRoleOptions=true" (keydown)="roleKeydown($event)"></div><div class="role-options" *ngIf="showRoleOptions && filteredRoles.length" role="listbox"><button type="button" role="option" [attr.aria-selected]="selectedRoles.includes(role)" *ngFor="let role of filteredRoles" (mousedown)="$event.preventDefault()" (click)="toggleRole(role)"><span class="role-check" aria-hidden="true">{{ selectedRoles.includes(role) ? '✓' : '' }}</span><span>{{ role }}</span></button></div><small class="role-hint">Select one or more job titles</small></div></div>
              <div class="field"><span>Preferred countries</span><div class="country-picker"><div class="selected-countries"><span class="country-chip" *ngFor="let country of selectedCountries"><img class="country-flag" [src]="flagImage(country.code)" alt="" loading="lazy" (error)="$any($event.target).hidden=true; $any($event.target.nextElementSibling).hidden=false"><span class="country-code-fallback" aria-hidden="true" hidden>{{ country.code }}</span><span>{{ country.name }}</span><button type="button" [attr.aria-label]="'Remove '+country.name" (click)="removeCountry(country.code)">×</button></span><input [(ngModel)]="countrySearch" name="countrySearch" placeholder="Search countries" autocomplete="off" (focus)="showCountryOptions=true" (input)="showCountryOptions=true" (keydown)="countryKeydown($event)"></div><div class="country-options" *ngIf="showCountryOptions && filteredCountries.length" role="listbox"><button type="button" role="option" [attr.aria-selected]="false" *ngFor="let country of filteredCountries" (mousedown)="$event.preventDefault()" (click)="addCountry(country)"><img class="country-flag" [src]="flagImage(country.code)" alt="" loading="lazy" (error)="$any($event.target).hidden=true"><span>{{ country.name }}</span><small>{{ country.code }}</small></button></div></div></div>
              <label class="field"><span>Internship duration</span><select [(ngModel)]="preferences.internshipDuration" name="duration"><option value="">Select duration</option><option>3 months</option><option>6 months</option><option>12 months</option><option>Flexible</option></select></label>
              <label class="field"><span>Start date</span><input [(ngModel)]="preferences.startDate" name="startDate" type="month"></label>
            </div>
            <label class="field"><span>Additional requirements <small>Optional</small></span><textarea [(ngModel)]="preferences.additionalRequirements" name="requirements" rows="3" placeholder="Work authorization, industries, or other preferences"></textarea></label>
            <div class="form-actions"><button class="button primary" type="submit" [disabled]="busy">Review</button></div>
          </form>

          <div *ngIf="reviewing" class="review-content">
            <button class="back-link" type="button" (click)="reviewing=false">Edit details</button>
            <dl class="review-list">
              <div><dt>CV</dt><dd>{{ file?.name }}</dd></div>
              <div><dt>Companies</dt><dd>{{ selectedCompanyNames.join(', ') }}</dd></div>
              <div><dt>People to find</dt><dd>{{ selectedContactTypes.join(', ') }}</dd></div>
              <div><dt>Target roles</dt><dd>{{ roleList.join(', ') || 'Not specified' }}</dd></div>
              <div><dt>Countries</dt><dd>{{ countryList.join(', ') || 'Not specified' }}</dd></div>
              <div><dt>Duration</dt><dd>{{ preferences.internshipDuration || 'Not specified' }}</dd></div>
              <div><dt>Start date</dt><dd>{{ preferences.startDate || 'Not specified' }}</dd></div>
              <div *ngIf="preferences.additionalRequirements"><dt>Requirements</dt><dd>{{ preferences.additionalRequirements }}</dd></div>
            </dl>
            <label *ngIf="liveMode" class="privacy-consent"><input type="checkbox" [(ngModel)]="privacyAcknowledged" name="privacyAcknowledged"><span>This uploads your CV to AWS for processing. CareerSignal sends CV text to the configured AI provider; GetProspect searches only the companies and HR/recruiting titles you selected and may enrich up to five emails. Email drafts are not sent.</span></label>
            <div class="form-actions"><button class="button primary" type="button" (click)="runAnalysis()" [disabled]="busy || (liveMode && !privacyAcknowledged)">{{ busy ? 'Waiting for results' : 'Get results' }}</button></div>
          </div>
          <div *ngIf="busy" class="loading" role="status">{{ environmentMode ? 'Loading demo results…' : 'Waiting for workflow results…' }}</div>
          <div *ngIf="error" class="error-panel" role="alert">{{ error }}</div>
        </section>

        <section *ngIf="result" class="panel profile-panel">
          <div class="panel-heading"><div><h2>Candidate</h2></div><button class="text-button" type="button" (click)="reset()">New search</button></div>
          <p class="profile-summary">{{ result.analysis.candidateSummary }}</p>

          <div class="profile-section"><h3>Skills</h3><div class="tag-list"><span *ngFor="let item of result.analysis.skills">{{ item }}</span></div></div>
          <div class="profile-section"><h3>Target roles</h3><div class="tag-list"><span *ngFor="let item of result.analysis.targetRoles">{{ item }}</span></div></div>
          <div class="profile-section"><h3>Search preferences</h3><p>Companies: {{ selectedCompanyNames.join(', ') }}<br>People: {{ selectedContactTypes.join(', ') }}<br>{{ countryList.join(', ') || 'Countries not specified' }}<span *ngIf="preferences.internshipDuration"> · {{ preferences.internshipDuration }}</span></p></div>


        </section>
      </aside>

      <section *ngIf="!result" class="panel discovery-empty">
        <div class="empty-orbit"><span></span><span></span><span></span></div>

        <h2>Your contact matches<br>will appear here.</h2>

      </section>

      <section *ngIf="result" class="panel discovery-panel">
        <div class="discovery-heading"><div><h1>Review contacts</h1></div><div class="review-count"><strong>{{ reviewIndex < result.contacts.length ? reviewIndex + 1 : result.contacts.length }}</strong><span>of {{ result.contacts.length }}</span></div></div>

        <div *ngIf="activeContact as person" class="contact-stage" [class.email-revealed]="!!revealedDraft">
          <div class="stack-card stack-card-back" aria-hidden="true"></div>
          <div class="stack-card stack-card-middle" aria-hidden="true"></div>
          <article class="swipe-card" [class.dragging]="isDragging" [style.transform]="cardTransform" (pointerdown)="startSwipe($event)" (pointermove)="moveSwipe($event)" (pointerup)="endSwipe($event)" (pointercancel)="cancelSwipe()">

            <div class="contact-card-top"><div class="company-identity"><img *ngIf="companyLogoUrl(person) as logoUrl" [src]="logoUrl" [alt]="''" loading="lazy" (error)="$any($event.target).hidden=true; $any($event.target.nextElementSibling).hidden=false"><span class="company-monogram" aria-hidden="true" hidden>{{ companyInitials(person.company) }}</span><h2>{{ person.company || 'Company unavailable' }}</h2></div><div class="contact-score" *ngIf="person.fitScore !== undefined"><strong>{{ person.fitScore }}</strong></div></div>
            <div class="contact-person-section"><div class="contact-person-row"><p class="contact-person-name">{{ person.fullName || 'Name unavailable' }}</p><a *ngIf="person.linkedinUrl" class="linkedin-link" [href]="person.linkedinUrl" target="_blank" rel="noreferrer"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.26 2.37 4.26 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.23 0Z"/></svg><span>View LinkedIn profile</span></a></div><p class="contact-title">{{ person.title || 'Title unavailable' }}<span *ngIf="companyIndustry(person) !== 'Company match'"> · {{ companyIndustry(person) }}</span></p></div>
            <div class="reveal-area">
              <div class="destination-row"><input id="destination-address" [ngModel]="revealedDraft?.email || ''" (ngModelChange)="updateDraftEmail($event)" [ngModelOptions]="{standalone:true}" [placeholder]="revealedDraft ? 'Email unavailable' : 'Address hidden'" [readonly]="!revealedDraft"><button class="reveal-button" type="button" (click)="revealDraft(person)">{{ revealedDraft ? 'Hide draft' : 'Reveal' }}</button></div>
              <div *ngIf="revealedDraft as draft" class="draft-reveal">
                <label class="field"><span>Subject</span><input [(ngModel)]="draft.subject" [name]="'subject'+reviewIndex"></label>
                <label class="field"><span>Message</span><textarea [(ngModel)]="draft.body" [name]="'body'+reviewIndex" rows="7"></textarea></label>

                <div class="draft-actions"><button class="button secondary" type="button" (click)="copyAddress(draft)">Copy address</button><button class="button secondary" type="button" (click)="copyDraft(draft)">Copy email</button><button class="button primary" type="button" (click)="markReviewed(reviewIndex)">{{ reviewed.has(reviewIndex) ? 'Reviewed' : 'Mark reviewed' }}</button></div>
              </div>
            </div>
            <div class="swipe-actions"><button class="decision-button pass-button" type="button" (click)="decide('pass')" aria-label="Skip contact" title="Skip contact"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button><button class="decision-button keep-button" type="button" (click)="decide('keep')" aria-label="Save contact" title="Save contact"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7"/></svg></button></div>
            <div class="swipe-stamp keep" *ngIf="swipeOffset > 40">SAVE</div><div class="swipe-stamp pass" *ngIf="swipeOffset < -40">PASS</div>
          </article>
        </div>

        <div *ngIf="result.contacts.length === 0" class="review-finished"><div class="finished-mark">0</div><h2>No HR contacts found</h2><p>CareerSignal found {{ result.companies.length }} companies, but no matching recruiter contacts. Try another search after checking your contact-provider access.</p><button class="button primary" type="button" (click)="reset()">Start a new search</button><button class="text-button" type="button" (click)="view='analysis'">View profile signals</button></div>
        <div *ngIf="result.contacts.length > 0 && !activeContact" class="review-finished"><div class="finished-mark">{{ keptContacts.size }}</div><h2>Contact review complete</h2><p>{{ keptContacts.size }} saved · {{ skippedContacts }} skipped</p><button class="button primary" type="button" (click)="restartReview()">Review again</button><button class="text-button" type="button" (click)="view='analysis'">View profile signals</button></div>

        <section *ngIf="view==='analysis'" class="profile-extra"><h2>Profile signals</h2><div *ngFor="let item of result.analysis.companyKeywords">{{ item }}</div><button class="text-button" (click)="view='contacts'">Back to contacts</button></section>
      </section>
    </main>
    <div class="toast" *ngIf="toast" role="status">{{ toast }}</div>
  `
})
export class AppComponent {
  file: File | null = null;
  fileError = '';
  companySearch = '';
  selectedCompanies: Company[] = [];
  companyResults: Company[] = [];
  showCompanyOptions = false;
  companyLookupBusy = false;
  companyLookupError = '';
  targetingError = '';
  contactTypeError = '';
  contactTypeOptions = ['Talent Acquisition', 'Recruiter', 'Technical Recruiter', 'Campus Recruiter', 'HR Manager', 'HR Business Partner', 'People Operations', 'Head of People'];
  selectedContactTypes: string[] = [];
  customContactTypes: string[] = [];
  customContactTitle = '';
  roleSearch = '';
  roleOptions: string[] = [];
  showRoleOptions = false;
  selectedRoles: string[] = [];
  countrySearch = '';
  showCountryOptions = false;
  selectedCountries: CountryOption[] = [];
  reviewing = false;
  busy = false;

  result: CareerSignalResult | null = null;
  error = '';
  view = 'contacts';
  reviewIndex = 0;
  swipeOffset = 0;
  isDragging = false;
  isDeciding = false;
  startX = 0;
  startY = 0;
  keptContacts = new Set<string>();
  skippedContacts = 0;
  revealedDraft: Draft | null = null;
  toast = '';
  reviewed = new Set<number>();
  preferences: Preferences = { companyNames: [], contactTypes: [], countryCodes: [], targetRoles: [], internshipDuration: '6 months', startDate: '', additionalRequirements: '' };

  liveMode = false;
  privacyAcknowledged = false;

  get environmentMode(): boolean { return !this.liveMode; }

  constructor(private readonly demo: DemoDataService, private readonly api: CareerSignalApiService) {
    this.liveMode = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('careersignal-live-mode') === 'true';
    void fetch('/data/onet-computing-job-titles.json')
      .then(response => response.ok ? response.json() as Promise<string[]> : [])
      .then(titles => { this.roleOptions = Array.isArray(titles) ? titles : []; })
      .catch(() => { this.roleOptions = []; });
    void this.api.handleAuthCallback().then(authenticated => {
      if (authenticated) {
        this.liveMode = true;
        sessionStorage.setItem('careersignal-live-mode', 'true');
      }
    }).catch(error => {
      this.error = error instanceof Error ? error.message : 'Cognito sign-in failed.';
    });
  }

  toggleMode(): void {
    if (this.liveMode) {
      this.liveMode = false;
      this.privacyAcknowledged = false;
      this.api.signOut();
      return;
    }
    this.privacyAcknowledged = false;
    try {
      this.api.signIn();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Cognito is not configured.';
    }
  }

  get roleList(): string[] { return this.selectedRoles; }
  get countryList(): string[] { return this.selectedCountries.map(country => country.name); }
  get selectedCompanyNames(): string[] { return this.selectedCompanies.map(company => company.name); }
  companyKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') { event.preventDefault(); void this.lookupCompanyMatches(); }
    if (event.key === 'Escape') this.showCompanyOptions = false;
  }
  async lookupCompanyMatches(): Promise<void> {
    const query = this.companySearch.trim().replace(/\s+/g, ' ');
    if (!this.liveMode) { this.companyLookupError = 'Switch to Live mode to search GetProspect companies.'; return; }
    if (query.length < 2 || query.length > 100) { this.companyLookupError = 'Enter a company name between 2 and 100 characters.'; return; }
    if (this.selectedCompanies.length >= 5) { this.targetingError = 'Search up to five companies at a time.'; return; }
    this.companyLookupBusy = true;
    this.companyLookupError = '';
    this.showCompanyOptions = false;
    try {
      const companies = await this.api.searchCompanies(query);
      const selectedIds = new Set(this.selectedCompanies.map(company => company.id));
      this.companyResults = companies.filter(company => !selectedIds.has(company.id));
      this.showCompanyOptions = this.companyResults.length > 0;
      if (!this.companyResults.length) this.companyLookupError = 'No matching companies found. Try the full company name.';
    } catch (error) {
      this.companyLookupError = error instanceof Error ? error.message : 'Company search failed.';
    } finally {
      this.companyLookupBusy = false;
    }
  }
  selectCompany(company: Company): void {
    if (this.selectedCompanies.some(selected => selected.id === company.id)) return;
    if (this.selectedCompanies.length >= 5) { this.targetingError = 'Search up to five companies at a time.'; return; }
    this.selectedCompanies = [...this.selectedCompanies, company];
    this.preferences.companyNames = this.selectedCompanies.map(selected => selected.name);
    this.companySearch = '';
    this.companyResults = [];
    this.showCompanyOptions = false;
    this.companyLookupError = '';
    this.targetingError = '';
  }
  removeCompany(company: Company): void {
    this.selectedCompanies = this.selectedCompanies.filter(selected => selected.id !== company.id);
    this.preferences.companyNames = this.selectedCompanies.map(selected => selected.name);
  }
  toggleContactType(type: string, checked: boolean): void {
    if (checked && !this.selectedContactTypes.includes(type) && this.selectedContactTypes.length >= 10) {
      this.contactTypeError = 'Choose no more than ten contact types.';
      return;
    }
    this.selectedContactTypes = checked
      ? [...new Set([...this.selectedContactTypes, type])]
      : this.selectedContactTypes.filter(selected => selected !== type);
    this.preferences.contactTypes = [...this.selectedContactTypes];
    this.contactTypeError = '';
  }
  removeContactType(type: string): void {
    this.selectedContactTypes = this.selectedContactTypes.filter(selected => selected !== type);
    this.customContactTypes = this.customContactTypes.filter(selected => selected !== type);
    this.preferences.contactTypes = [...this.selectedContactTypes];
    this.contactTypeError = '';
  }
  contactTitleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') { event.preventDefault(); this.addCustomContactType(); }
  }
  addCustomContactType(): void {
    const title = this.customContactTitle.trim().replace(/\s+/g, ' ');
    if (!title) return;
    if (!/(recruit|talent acquisition|talent sourc(?:er|ing)|human resources|\bhr\b|people operations|people ops|people partner|talent partner|head of people|chief people|vp people)/i.test(title)) {
      this.contactTypeError = 'Enter an HR, recruiting, talent, or people-function title.';
      return;
    }
    if (this.selectedContactTypes.some(type => type.toLocaleLowerCase() === title.toLocaleLowerCase())) { this.customContactTitle = ''; return; }
    if (this.selectedContactTypes.length >= 10) { this.contactTypeError = 'Choose no more than ten contact types.'; return; }
    this.selectedContactTypes = [...this.selectedContactTypes, title];
    this.customContactTypes = [...this.customContactTypes, title];
    this.preferences.contactTypes = [...this.selectedContactTypes];
    this.customContactTitle = '';
    this.contactTypeError = '';
  }
  get filteredRoles(): string[] {
    const query = this.roleSearch.trim().toLocaleLowerCase();
    return this.roleOptions.filter(role => !this.selectedRoles.includes(role) && (!query || role.toLocaleLowerCase().includes(query))).slice(0, 10);
  }
  toggleRole(role: string): void {
    this.selectedRoles = this.selectedRoles.includes(role) ? this.selectedRoles.filter(selected => selected !== role) : [...this.selectedRoles, role];
    this.preferences.targetRoles = [...this.selectedRoles];
    this.roleSearch = '';
    this.showRoleOptions = false;
  }
  removeRole(role: string): void {
    this.selectedRoles = this.selectedRoles.filter(selected => selected !== role);
    this.preferences.targetRoles = [...this.selectedRoles];
  }
  roleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.showRoleOptions = false;
    if (event.key === 'Enter' && this.filteredRoles.length) { event.preventDefault(); this.toggleRole(this.filteredRoles[0]); }
  }
  get filteredCountries(): CountryOption[] {
    const query = this.countrySearch.trim().toLocaleLowerCase();
    return COUNTRY_OPTIONS.filter(country =>
      !this.selectedCountries.some(selected => selected.code === country.code) &&
      (!query || country.name.toLocaleLowerCase().includes(query) || country.code.toLowerCase().includes(query))
    ).slice(0, 8);
  }
  flagImage(code: string): string { return `https://flagcdn.com/w40/${code.toLowerCase()}.png`; }
  addCountry(country: CountryOption): void {
    if (!this.selectedCountries.some(selected => selected.code === country.code)) this.selectedCountries = [...this.selectedCountries, country];
    this.countrySearch = '';
    this.showCountryOptions = false;
    this.preferences.countryCodes = this.selectedCountries.map(selected => selected.code);
  }
  removeCountry(code: string): void {
    this.selectedCountries = this.selectedCountries.filter(country => country.code !== code);
    this.preferences.countryCodes = this.selectedCountries.map(country => country.code);
  }
  countryKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.showCountryOptions = false;
    if (event.key === 'Enter' && this.filteredCountries.length) { event.preventDefault(); this.addCountry(this.filteredCountries[0]); }
  }
  get activeContact(): Contact | null { return this.result?.contacts[this.reviewIndex] || null; }
  get cardTransform(): string { return `translateX(${this.swipeOffset}px) rotate(${this.swipeOffset * 0.035}deg)`; }


  private matchedCompany(person: Contact) { return this.result?.companies.find(company => company.id === person.companyId || company.name === person.company); }
  companyLogoUrl(person: Contact): string | null {
    if (person.companyLogoUrl) return this.secureLogoUrl(person.companyLogoUrl);
    const company = this.matchedCompany(person);
    return company ? this.companyLogoUrlFor(company) : null;
  }
  companyLogoUrlFor(company: Company): string | null {
    return company.logoUrl ? this.secureLogoUrl(company.logoUrl) : null;
  }
  private secureLogoUrl(value: string): string | null {
    try {
      const logo = new URL(value);
      return logo.protocol === 'https:' || logo.protocol === 'http:' ? (logo.protocol = 'https:', logo.href) : null;
    } catch { return null; }
  }
  companyInitials(name?: string): string { return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
  companyIndustry(person: Contact): string { return this.matchedCompany(person)?.industry || 'Company match'; }
  allowDrop(event: DragEvent): void { event.preventDefault(); }
  dropFile(event: DragEvent): void { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file) this.setFile(file); }
  selectFile(event: Event): void { const file = (event.target as HTMLInputElement).files?.[0]; if (file) this.setFile(file); }

  private setFile(file: File): void {
    this.fileError = '';
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { this.file = null; this.fileError = 'Choose a PDF file.'; return; }
    if (file.size > 10 * 1024 * 1024) { this.file = null; this.fileError = 'PDF must be 10 MB or smaller.'; return; }
    this.file = file;
    this.reviewing = false;
  }
  submit(event: Event): void {
    event.preventDefault();
    if (!this.file) { this.fileError = 'Choose a PDF CV first.'; return; }
    this.targetingError = '';
    this.contactTypeError = '';
    if (this.companySearch.trim()) { this.targetingError = 'Search and select a company from the GetProspect results.'; return; }
    if (!this.selectedCompanies.length) { this.targetingError = 'Select at least one company from the GetProspect results.'; return; }
    if (this.selectedCompanies.length > 5) { this.targetingError = 'Search up to five companies at a time.'; return; }
    if (!this.selectedContactTypes.length) { this.contactTypeError = 'Choose at least one HR or recruiting contact type.'; return; }
    this.fileError = '';
    this.preferences.companyNames = this.selectedCompanies.map(company => company.name);
    this.preferences.contactTypes = [...this.selectedContactTypes];
    this.preferences.targetRoles = this.roleList;
    this.preferences.countryCodes = this.selectedCountries.map(country => country.code);
    this.reviewing = true;
  }
  async runAnalysis(): Promise<void> {
    if (this.liveMode && !this.privacyAcknowledged) return;
    this.busy = true;
    this.error = '';
    try {
      this.result = this.liveMode ? await this.api.run(this.file!, this.preferences) : await this.demo.run('Fictional demonstration profile', this.preferences);
      this.reviewIndex = 0;
      this.keptContacts.clear();
      this.skippedContacts = 0;
      this.view = 'contacts';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Request failed.';
    } finally { this.busy = false; }
  }

  startSwipe(event: PointerEvent): void { if (this.isDeciding || (event.target as HTMLElement).closest('a,button,input,textarea')) return; this.startX = event.clientX; this.startY = event.clientY; this.isDragging = true; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
  moveSwipe(event: PointerEvent): void { if (!this.startX) return; const dx = event.clientX - this.startX; const dy = event.clientY - this.startY; if (Math.abs(dx) > Math.abs(dy)) this.swipeOffset = dx; }
  endSwipe(event: PointerEvent): void {
    if (!this.startX) return;
    const dx = event.clientX - this.startX;
    this.startX = 0; this.startY = 0; this.isDragging = false;
    if (dx > 85) this.decide('keep'); else if (dx < -85) this.decide('pass'); else this.swipeOffset = 0;
  }
  cancelSwipe(): void { this.startX = 0; this.isDragging = false; this.swipeOffset = 0; }
  decide(action: 'keep' | 'pass'): void {
    const contact = this.activeContact;
    if (!contact || this.isDeciding) return;
    this.isDeciding = true;
    this.swipeOffset = action === 'keep' ? window.innerWidth : -window.innerWidth;
    window.setTimeout(() => {
      if (action === 'keep') this.keptContacts.add(this.contactKey(contact)); else this.skippedContacts++;
      this.reviewIndex++;
      this.revealedDraft = null;
      this.swipeOffset = 0;
      this.isDeciding = false;
    }, 380);
  }
  private contactKey(contact: Contact): string { return String(contact.id || contact.linkedinUrl || contact.fullName || this.reviewIndex); }
  restartReview(): void { this.reviewIndex = 0; this.keptContacts.clear(); this.skippedContacts = 0; this.revealedDraft = null; }

  async revealDraft(person: Contact): Promise<void> {
    if (this.revealedDraft) { this.revealedDraft = null; return; }
    const found = this.result?.drafts.results.find(draft =>
      (person.id && draft.contactId === person.id) ||
      (draft.fullName && draft.fullName === person.fullName && (draft.companyName || draft.company) === person.company)
    );
    if (found) { this.revealedDraft = { ...found }; return; }
    if (!person.email) { this.showToast('No email or draft available'); return; }
    this.revealedDraft = { recipient: person.fullName, fullName: person.fullName, company: person.company, email: person.email, emailStatus: person.emailStatus, subject: '', body: '', personalizationEvidence: person.matchReasons || [] };
  }
  updateDraftEmail(email: string): void { if (this.revealedDraft) this.revealedDraft.email = email; }
  async copyDraft(draft: Draft): Promise<void> { await this.copy(`${draft.subject}\\n\\n${draft.body}`, 'Email copied'); }
  async copyAddress(draft: Draft): Promise<void> { if (!draft.email) { this.showToast('No recipient address available'); return; } await this.copy(draft.email, 'Address copied'); }
  private async copy(text: string, message: string): Promise<void> { try { await navigator.clipboard.writeText(text); this.showToast(message); } catch { this.showToast('Clipboard unavailable'); } }
  private showToast(message: string): void { this.toast = message; setTimeout(() => this.toast = '', 2500); }
  markReviewed(index: number): void { this.reviewed.add(index); this.reviewed = new Set(this.reviewed); }
  reset(): void {
    this.result = null; this.view = 'contacts'; this.reviewing = false; this.file = null; this.fileError = ''; this.reviewed.clear(); this.error = ''; this.selectedCountries = []; this.countrySearch = ''; this.preferences.countryCodes = []; this.selectedCompanies = []; this.companyResults = []; this.companySearch = ''; this.showCompanyOptions = false; this.companyLookupError = ''; this.preferences.companyNames = []; this.targetingError = ''; this.selectedContactTypes = []; this.customContactTypes = []; this.preferences.contactTypes = []; this.customContactTitle = ''; this.contactTypeError = ''; this.privacyAcknowledged = false;
    this.reviewIndex = 0; this.keptContacts.clear(); this.skippedContacts = 0; this.revealedDraft = null;
  }
}
