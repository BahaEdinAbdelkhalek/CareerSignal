import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { CareerSignalResult, Preferences } from './models';

interface SearchStarted {
  searchId: string;
}

interface UploadGrant {
  uploadUrl: string;
  objectKey: string;
}

interface SearchStatus {
  status: string;
  result?: CareerSignalResult;
  error?: string;
}

interface GatewayError {
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class CareerSignalApiService {
  private readonly pollIntervalMs = 2000;
  private readonly maxPollAttempts = 300;

  async run(cv: File | string, preferences: Preferences): Promise<CareerSignalResult> {
    let cvText: string | null = null;
    let cvObjectKey: string | null = null;
    if (typeof cv === 'string') {
      cvText = cv;
    } else {
      const grant = await this.requestJson<UploadGrant>('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ contentType: 'application/pdf', size: cv.size }),
      });
      const upload = await fetch(grant.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: cv,
      });
      if (!upload.ok) throw new Error(`The PDF upload failed (HTTP ${upload.status}).`);
      cvObjectKey = grant.objectKey;
    }
    const startResponse = await this.request('/api/searches', {
      method: 'POST',
      body: JSON.stringify({ cvText, cvObjectKey, preferences }),
    });
    const started = await this.readJson<SearchStarted>(startResponse);
    if (!started.searchId) throw new Error('The gateway did not return a search handle.');

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      const response = await this.request(`/api/searches/${encodeURIComponent(started.searchId)}`, { method: 'GET' });
      const status = await this.readJson<SearchStatus>(response);
      if (status.status === 'Completed' && status.result) return status.result;
      if (['Failed', 'Terminated', 'Canceled'].includes(status.status)) {
        throw new Error(status.error || `The workflow ${status.status.toLowerCase()}.`);
      }
    }

    throw new Error('The search is taking longer than expected. Retry later; the workflow may still be running.');
  }

  signIn(): void {
    if (!environment.cognitoDomain || !environment.cognitoClientId) {
      throw new Error('Cognito is not configured in the frontend environment.');
    }
    const verifier = this.randomUrlSafe(64);
    const state = this.randomUrlSafe(32);
    sessionStorage.setItem('careersignal-pkce-verifier', verifier);
    sessionStorage.setItem('careersignal-oauth-state', state);
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(digest => {
      const challenge = this.base64Url(new Uint8Array(digest));
      const url = new URL('/oauth2/authorize', environment.cognitoDomain);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: environment.cognitoClientId,
        redirect_uri: `${window.location.origin}/`,
        scope: 'openid email',
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
      }).toString();
      window.location.assign(url.toString());
    });
  }

  async handleAuthCallback(): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return Boolean(sessionStorage.getItem('careersignal-access-token'));
    const state = params.get('state');
    const expectedState = sessionStorage.getItem('careersignal-oauth-state');
    const verifier = sessionStorage.getItem('careersignal-pkce-verifier');
    sessionStorage.removeItem('careersignal-oauth-state');
    sessionStorage.removeItem('careersignal-pkce-verifier');
    if (!expectedState || state !== expectedState || !verifier) throw new Error('Cognito sign-in state did not match. Try signing in again.');
    const response = await fetch(new URL('/oauth2/token', environment.cognitoDomain), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: environment.cognitoClientId,
        code,
        redirect_uri: `${window.location.origin}/`,
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new Error(`Cognito token exchange failed (HTTP ${response.status}).`);
    const tokens = await response.json() as { access_token?: string };
    if (!tokens.access_token) throw new Error('Cognito did not return an access token.');
    sessionStorage.setItem('careersignal-access-token', tokens.access_token);
    window.history.replaceState({}, document.title, window.location.pathname);
    return true;
  }

  signOut(): void {
    sessionStorage.removeItem('careersignal-access-token');
    sessionStorage.removeItem('careersignal-live-mode');
    const url = new URL('/logout', environment.cognitoDomain);
    url.search = new URLSearchParams({ client_id: environment.cognitoClientId, logout_uri: `${window.location.origin}/` }).toString();
    window.location.assign(url.toString());
  }

  private endpoint(path: string): string {
    if (!environment.apiBaseUrl) throw new Error('The AWS API URL is not configured.');
    return `${environment.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const token = sessionStorage.getItem('careersignal-access-token');
    if (!token) {
      this.signIn();
      throw new Error('Sign in with Cognito, then retry the search.');
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetch(this.endpoint(path), { ...init, headers, cache: 'no-store' });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    return this.readJson<T>(await this.request(path, init));
  }

  private randomUrlSafe(length: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return this.base64Url(bytes);
  }

  private base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private async readJson<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 401 || response.redirected || !contentType.includes('application/json')) {
      sessionStorage.removeItem('careersignal-access-token');
      throw new Error('Your Cognito session expired. Sign in again and retry.');
    }

    let body: T & GatewayError;
    try {
      body = await response.json() as T & GatewayError;
    } catch {
      throw new Error('The protected gateway returned an invalid response.');
    }
    if (!response.ok) throw new Error(body.error || `The gateway returned HTTP ${response.status}.`);
    return body;
  }
}
