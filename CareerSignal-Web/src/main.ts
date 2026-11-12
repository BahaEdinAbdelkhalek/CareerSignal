import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { environment } from './environments/environment';

interface RuntimeConfiguration {
  apiBaseUrl: string;
  cognitoDomain: string;
  cognitoClientId: string;
  linkedinUrl?: string;
  githubUrl?: string;
}

async function loadRuntimeConfiguration(): Promise<void> {
  const response = await fetch('/runtime-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Runtime configuration request failed (HTTP ${response.status}).`);

  const config = await response.json() as Partial<RuntimeConfiguration>;
  const keys: Array<keyof RuntimeConfiguration> = ['apiBaseUrl', 'cognitoDomain', 'cognitoClientId'];
  if (keys.some(key => typeof config[key] !== 'string' || !config[key]?.trim())) {
    throw new Error('Runtime configuration is incomplete.');
  }

  Object.assign(environment, config);
}

async function startApplication(): Promise<void> {
  try {
    await loadRuntimeConfiguration();
  } catch (error) {
    console.error('CareerSignal runtime configuration could not be loaded.', error);
  }

  await bootstrapApplication(AppComponent, { providers: [provideRouter(routes)] });
}

void startApplication().catch(error => console.error('CareerSignal failed to start.', error));
