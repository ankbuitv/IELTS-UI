import type { Env } from '../env';

/**
 * Platform settings live in `platform_settings` as JSON values. They are read on
 * the server only: a setting cannot be "turned on" by the browser.
 */
export interface PlatformSettings {
  bandEstimationEnabled: boolean;
  aiImportEnabled: boolean;
  registrationEnabled: boolean;
  integrityNotice: string;
}

export const DEFAULT_INTEGRITY_NOTICE =
  'This exam records observable browser events (visibility changes, fullscreen exits, copy/paste) for the integrity log. ' +
  'A web page cannot block operating-system shortcuts such as Alt+Tab, cannot see other applications, and these events ' +
  'are not proof of misconduct on their own.';

const DEFAULTS: PlatformSettings = {
  bandEstimationEnabled: true,
  aiImportEnabled: true,
  registrationEnabled: true,
  integrityNotice: DEFAULT_INTEGRITY_NOTICE,
};

export async function loadPlatformSettings(env: Env): Promise<PlatformSettings> {
  const rows = await env.DB.prepare('SELECT key, value_json FROM platform_settings')
    .all<{ key: string; value_json: string }>()
    .catch(() => ({ results: [] as Array<{ key: string; value_json: string }> }));

  const settings: PlatformSettings = { ...DEFAULTS };
  for (const row of rows.results) {
    const value = parseValue(row.value_json);
    switch (row.key) {
      case 'band_estimation_enabled':
        if (typeof value === 'boolean') settings.bandEstimationEnabled = value;
        break;
      case 'ai_import_enabled':
        if (typeof value === 'boolean') settings.aiImportEnabled = value;
        break;
      case 'registration_enabled':
        if (typeof value === 'boolean') settings.registrationEnabled = value;
        break;
      case 'integrity_notice':
        if (typeof value === 'string' && value.trim()) settings.integrityNotice = value.slice(0, 1000);
        break;
      default:
        break;
    }
  }
  return settings;
}

export function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
