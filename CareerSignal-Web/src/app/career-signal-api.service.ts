import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { CareerSignalResult, Preferences } from './models';

interface DurableStart { id: string; statusQueryGetUri: string; }
interface DurableStatus { runtimeStatus: string; output?: CareerSignalResult; }

@Injectable({ providedIn: 'root' })
export class CareerSignalApiService {
  async run(cv: File | string, preferences: Preferences): Promise<CareerSignalResult> {
    if (environment.mode !== 'live' || !environment.apiBaseUrl) throw new Error('Live access is disabled. Configure a trusted server-side gateway before enabling it.');
    let body: BodyInit;
    const headers: HeadersInit = {};
    if (typeof cv === 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ cvText: cv, preferences });
    } else {
      const form = new FormData(); form.append('cv', cv); form.append('preferences', JSON.stringify(preferences)); body = form;
    }
    const response = await fetch(`${environment.apiBaseUrl}/api/career-signal`, { method: 'POST', headers, body, credentials: 'include' });
    if (!response.ok) throw new Error(`CareerSignal backend returned HTTP ${response.status}.`);
    const start = await response.json() as DurableStart;
    if (!start.statusQueryGetUri) throw new Error('Backend did not return a Durable status URL.');
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const poll = await fetch(start.statusQueryGetUri, { credentials: 'include' });
      if (!poll.ok) throw new Error(`Workflow status request returned HTTP ${poll.status}.`);
      const status = await poll.json() as DurableStatus;
      if (status.runtimeStatus === 'Completed' && status.output) return status.output;
      if (['Failed', 'Terminated', 'Canceled'].includes(status.runtimeStatus)) throw new Error(`Analysis ${status.runtimeStatus.toLowerCase()}.`);
    }
    throw new Error('Analysis timed out while waiting for the backend.');
  }
}
