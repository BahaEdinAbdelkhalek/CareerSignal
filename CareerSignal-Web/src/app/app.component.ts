import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoDataService } from './demo-data.service';
import { CareerSignalApiService } from './career-signal-api.service';
import { CareerSignalResult, Contact, Draft, Preferences } from './models';


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

            <div class="field-grid">
              <label class="field"><span>Target roles</span><input [(ngModel)]="rolesText" name="roles" placeholder="Cloud / DevOps Engineer"></label>
              <div class="field"><span>Preferred countries</span><div class="country-picker"><div class="selected-countries"><span class="country-chip" *ngFor="let country of selectedCountries">{{ flag(country.code) }} {{ country.name }}<button type="button" [attr.aria-label]="'Remove '+country.name" (click)="removeCountry(country.code)">×</button></span><input [(ngModel)]="countrySearch" name="countrySearch" placeholder="Search countries" autocomplete="off" (focus)="showCountryOptions=true" (input)="showCountryOptions=true" (keydown)="countryKeydown($event)"></div><div class="country-options" *ngIf="showCountryOptions && filteredCountries.length" role="listbox"><button type="button" role="option" [attr.aria-selected]="false" *ngFor="let country of filteredCountries" (mousedown)="$event.preventDefault()" (click)="addCountry(country)"><span class="country-flag">{{ flag(country.code) }}</span><span>{{ country.name }}</span><small>{{ country.code }}</small></button></div></div></div>
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
              <div><dt>Target roles</dt><dd>{{ roleList.join(', ') || 'Not specified' }}</dd></div>
              <div><dt>Countries</dt><dd>{{ countryList.join(', ') || 'Not specified' }}</dd></div>
              <div><dt>Duration</dt><dd>{{ preferences.internshipDuration || 'Not specified' }}</dd></div>
              <div><dt>Start date</dt><dd>{{ preferences.startDate || 'Not specified' }}</dd></div>
              <div *ngIf="preferences.additionalRequirements"><dt>Requirements</dt><dd>{{ preferences.additionalRequirements }}</dd></div>
            </dl>
            <label *ngIf="liveMode" class="privacy-consent"><input type="checkbox" [(ngModel)]="privacyAcknowledged" name="privacyAcknowledged"><span>This uploads your CV to AWS for processing. CareerSignal sends CV text to the configured AI provider; GetProspect searches companies and contacts and may enrich up to five emails. Email drafts are not sent.</span></label>
            <div class="form-actions"><button class="button primary" type="button" (click)="runAnalysis()" [disabled]="busy || (liveMode && !privacyAcknowledged)">{{ busy ? 'Waiting for results' : 'Get results' }}</button></div>
          </div>
          <div *ngIf="busy" class="loading" role="status">{{ environmentMode ? 'Loading demo results…' : 'Waiting for workflow results…' }}</div>
          <div *ngIf="error" class="error-panel" role="alert">{{ error }}</div>
        </section>

        <section *ngIf="result" class="panel profile-panel">
          <div class="panel-heading"><div><h2>Candidate</h2></div><button class="text-button" type="button" (click)="reset()">New search</button></div>
          <p class="profile-summary">{{ result.analysis.candidateSummary }}</p>
          <small class="source-label">AI-generated summary</small>
          <div class="profile-section"><h3>Skills</h3><div class="tag-list"><span *ngFor="let item of result.analysis.skills">{{ item }}</span></div></div>
          <div class="profile-section"><h3>Target roles</h3><div class="tag-list"><span *ngFor="let item of result.analysis.targetRoles">{{ item }}</span></div></div>
          <div class="profile-section"><h3>Search preferences</h3><p>{{ countryList.join(', ') || 'Countries not specified' }}<span *ngIf="preferences.internshipDuration"> · {{ preferences.internshipDuration }}</span></p></div>
          <div class="profile-section gaps" *ngIf="result.analysis.gaps.length"><h3>Gaps to review</h3><ul><li *ngFor="let item of result.analysis.gaps">{{ item }}</li></ul></div>
          <div class="demo-note" *ngIf="environmentMode">Fictional demo data. No external services contacted.</div>
        </section>
      </aside>

      <section *ngIf="!result" class="panel discovery-empty">
        <div class="empty-orbit"><span></span><span></span><span></span></div>

        <h2>Your contact matches<br>will appear here.</h2>

      </section>

      <section *ngIf="result" class="panel discovery-panel">
        <div class="discovery-heading"><div><h1>Review contacts</h1></div><div class="review-count"><strong>{{ reviewIndex < result.contacts.length ? reviewIndex + 1 : result.contacts.length }}</strong><span>of {{ result.contacts.length }}</span></div></div>
        <div class="swipe-track"><span [class.done]="reviewIndex > 0">Profile</span><i [class.done]="reviewIndex > 0"></i><span [class.done]="reviewIndex > 0">Companies</span><i [class.done]="reviewIndex > 0"></i><span class="current">Contacts</span></div>

        <div *ngIf="activeContact as person" class="contact-stage">
          <article class="swipe-card" [class.dragging]="swipeOffset !== 0" [style.transform]="cardTransform" (pointerdown)="startSwipe($event)" (pointermove)="moveSwipe($event)" (pointerup)="endSwipe($event)" (pointercancel)="cancelSwipe()">
            <span class="card-kicker">CONTACT {{ reviewIndex + 1 }} / {{ result.contacts.length }}</span>
            <div class="contact-card-top"><div class="contact-avatar">{{ initials(person.fullName) }}</div><div class="contact-score" *ngIf="person.fitScore !== undefined"><strong>{{ person.fitScore }}</strong><span>{{ fitLabel }}</span></div></div>
            <h2>{{ person.fullName || 'Name unavailable' }}</h2>
            <p class="contact-title">{{ person.title || 'Title unavailable' }}</p>
            <div class="company-chip"><span>{{ initials(person.company) }}</span><div><strong>{{ person.company || 'Company unavailable' }}</strong><small>{{ companyIndustry(person) }}</small></div></div>
            <div class="match-reasons" *ngIf="person.matchReasons?.length"><span class="card-kicker">MATCH REASONS</span><p *ngFor="let reason of person.matchReasons">{{ reason }}</p></div>
            <a *ngIf="person.linkedinUrl" class="linkedin-link" [href]="person.linkedinUrl" target="_blank" rel="noreferrer">View LinkedIn profile</a>
            <div class="swipe-stamp keep" *ngIf="swipeOffset > 40">SAVE</div><div class="swipe-stamp pass" *ngIf="swipeOffset < -40">PASS</div>
          </article>

          <div class="swipe-actions"><button class="decision-button pass-button" type="button" (click)="decide('pass')" aria-label="Skip contact">Skip</button><span>Swipe to review</span><button class="decision-button keep-button" type="button" (click)="decide('keep')">Save contact</button></div>

          <div class="reveal-area">
            <div class="destination-row"><label for="destination-address">To</label><input id="destination-address" [ngModel]="revealedDraft?.email || ''" (ngModelChange)="updateDraftEmail($event)" [ngModelOptions]="{standalone:true}" [placeholder]="revealedDraft ? 'Email unavailable' : 'Address hidden'" [readonly]="!revealedDraft"><button class="reveal-button" type="button" (click)="revealDraft(person)">{{ revealedDraft ? 'Hide draft' : 'Reveal' }}</button></div>
            <div *ngIf="revealedDraft as draft" class="draft-reveal">
              <label class="field"><span>Subject</span><input [(ngModel)]="draft.subject" [name]="'subject'+reviewIndex"></label>
              <label class="field"><span>Message</span><textarea [(ngModel)]="draft.body" [name]="'body'+reviewIndex" rows="7"></textarea></label>
              <div class="draft-evidence" *ngIf="draft.personalizationEvidence?.length"><span *ngFor="let reason of draft.personalizationEvidence">{{ reason }}</span></div>
              <div class="draft-actions"><button class="button secondary" type="button" (click)="copyAddress(draft)">Copy address</button><button class="button secondary" type="button" (click)="copyDraft(draft)">Copy email</button><button class="button primary" type="button" (click)="markReviewed(reviewIndex)">{{ reviewed.has(reviewIndex) ? 'Reviewed' : 'Mark reviewed' }}</button></div>
            </div>
          </div>
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
  rolesText = '';
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
  startX = 0;
  startY = 0;
  keptContacts = new Set<string>();
  skippedContacts = 0;
  revealedDraft: Draft | null = null;
  toast = '';
  reviewed = new Set<number>();
  preferences: Preferences = { countryCodes: [], targetRoles: [], internshipDuration: '6 months', startDate: '', additionalRequirements: '' };

  liveMode = false;
  privacyAcknowledged = false;

  get environmentMode(): boolean { return !this.liveMode; }
  get fitLabel(): string { return this.liveMode ? 'FIT SCORE' : 'DEMO FIT'; }

  constructor(private readonly demo: DemoDataService, private readonly api: CareerSignalApiService) {
    this.liveMode = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('careersignal-live-mode') === 'true';
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

  get roleList(): string[] { return this.rolesText.split(',').map(value => value.trim()).filter(Boolean); }
  get countryList(): string[] { return this.selectedCountries.map(country => country.name); }
  get filteredCountries(): CountryOption[] {
    const query = this.countrySearch.trim().toLocaleLowerCase();
    return COUNTRY_OPTIONS.filter(country =>
      !this.selectedCountries.some(selected => selected.code === country.code) &&
      (!query || country.name.toLocaleLowerCase().includes(query) || country.code.toLowerCase().includes(query))
    ).slice(0, 8);
  }
  flag(code: string): string { return String.fromCodePoint(...[...code.toUpperCase()].map(char => char.charCodeAt(0) + 127397)); }
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

  initials(name?: string): string { return (name || 'CS').split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase(); }
  companyIndustry(person: Contact): string { return this.result?.companies.find(company => company.id === person.companyId || company.name === person.company)?.industry || 'Company match'; }
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
    this.fileError = '';
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

  startSwipe(event: PointerEvent): void { if ((event.target as HTMLElement).closest('a,button,input,textarea')) return; this.startX = event.clientX; this.startY = event.clientY; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
  moveSwipe(event: PointerEvent): void { if (!this.startX) return; const dx = event.clientX - this.startX; const dy = event.clientY - this.startY; if (Math.abs(dx) > Math.abs(dy)) this.swipeOffset = dx; }
  endSwipe(event: PointerEvent): void {
    if (!this.startX) return;
    const dx = event.clientX - this.startX;
    this.startX = 0; this.startY = 0;
    if (dx > 85) this.decide('keep'); else if (dx < -85) this.decide('pass'); else this.swipeOffset = 0;
  }
  cancelSwipe(): void { this.startX = 0; this.swipeOffset = 0; }
  decide(action: 'keep' | 'pass'): void {
    const contact = this.activeContact;
    if (!contact) return;
    if (action === 'keep') this.keptContacts.add(this.contactKey(contact)); else this.skippedContacts++;
    this.reviewIndex++;
    this.revealedDraft = null;
    this.swipeOffset = 0;
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
    this.result = null; this.view = 'contacts'; this.reviewing = false; this.file = null; this.fileError = ''; this.reviewed.clear(); this.error = ''; this.selectedCountries = []; this.countrySearch = ''; this.preferences.countryCodes = []; this.privacyAcknowledged = false;
    this.reviewIndex = 0; this.keptContacts.clear(); this.skippedContacts = 0; this.revealedDraft = null;
  }
}
