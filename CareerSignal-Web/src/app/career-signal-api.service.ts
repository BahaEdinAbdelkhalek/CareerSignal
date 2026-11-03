import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { CareerSignalResult, Preferences } from './models';

interface SearchStarted {
  searchId: string;
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

    const body: BodyInit = typeof cv === 'string'
      ? JSON.stringify({ cvText: cv, preferences })
      : this.createUpload(cv, preferences);
    const headers: HeadersInit = typeof cv === 'string' ? { 'Content-Type': 'application/json' } : {};
    const startResponse = await fetch(this.endpoint('/api/searches'), {
      method: 'POST',
      headers,
      body,
      credentials: 'include',
      cache: 'no-store',
    });
    const started = await this.readJson<SearchStarted>(startResponse);
    if (!started.searchId) throw new Error('The gateway did not return a search handle.');

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      const response = await fetch(this.endpoint(`/api/searches/${encodeURIComponent(started.searchId)}`), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const status = await this.readJson<SearchStatus>(response);
      if (status.status === 'Completed' && status.result) return status.result;
      if (['Failed', 'Terminated', 'Canceled'].includes(status.status)) {
        throw new Error(status.error || `The workflow ${status.status.toLowerCase()}.`);
      }
    }

    throw new Error('The search is taking longer than expected. Retry later; the workflow may still be running.');
  }

  private createUpload(file: File, preferences: Preferences): FormData {
    const form = new FormData();
    form.append('cv', file);
    form.append('preferences', JSON.stringify(preferences));
    return form;
  }

  private endpoint(path: string): string {
    const configuredBase = environment.apiBaseUrl.replace(/\/+$/, '');
    if (!configuredBase) return path;
    const base = new URL(configuredBase, window.location.origin);
    if (base.origin !== window.location.origin) {
      throw new Error('Live API requests must use the same-origin protected gateway.');
    }
    return `${base.pathname.replace(/\/$/, '')}${path}`;
  }

  private async readJson<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 401 || response.redirected || !contentType.includes('application/json')) {
      window.location.assign('/api/access-login');
      throw new Error('Sign in with the authorized account, then submit the search again.');
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
