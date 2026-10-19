import { test as base, expect, type Page } from '@playwright/test';
import type { Dashboard, ProtectionSettings } from '@workspace/api-client-react';

export const INITIAL: ProtectionSettings = {
  enabled: true, blockStartHour: 22, blockEndHour: 6, cooldownMinutes: 15,
};
export const EDITED: ProtectionSettings = {
  enabled: false, blockStartHour: 20, blockEndHour: 8, cooldownMinutes: 35,
};
export const EXTERNAL: ProtectionSettings = {
  enabled: true, blockStartHour: 19, blockEndHour: 9, cooldownMinutes: 55,
};

type Failure = 'server' | 'network' | null;

/** Only the API boundary is fake; the page, form, hooks and cache are real.
 * Every API request is intercepted, so these tests cannot touch shared settings.
 */
class SettingsApi {
  settings = { ...INITIAL };
  reads = 0;
  writes: ProtectionSettings[] = [];
  readFailure: Failure = null;
  writeFailure: Failure = null;
  holdRead: Promise<void> | null = null;
  holdWrite: Promise<void> | null = null;
  unexpectedRequests: string[] = [];

  dashboard(): Dashboard {
    return {
      account: { displayName: 'حساب اختبار الإعدادات', availableBalance: 250, currency: 'KWD' },
      virtualCard: { holderName: 'حساب الاختبار', lastFour: '1234', status: 'active' },
      protectionEnabled: this.settings.enabled,
      recentSimulations: [], pendingSimulations: [],
    };
  }
}

export const test = base.extend<{ api: SettingsApi }>({
  api: async ({ context }, use) => {
    const api = new SettingsApi();
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (path === '/api/dashboard' && method === 'GET') {
        return route.fulfill({ json: api.dashboard() });
      }
      if (path === '/api/protection-settings' && method === 'GET') {
        api.reads++;
        if (api.holdRead) await api.holdRead;
        if (api.readFailure === 'network') return route.abort('failed');
        if (api.readFailure === 'server') {
          return route.fulfill({ status: 503, json: { error: 'Settings unavailable' } });
        }
        return route.fulfill({ json: api.settings });
      }
      if (path === '/api/protection-settings' && method === 'PUT') {
        const input: ProtectionSettings = request.postDataJSON();
        api.writes.push(input);
        if (api.holdWrite) await api.holdWrite;
        if (api.writeFailure === 'network') return route.abort('failed');
        if (api.writeFailure === 'server') {
          return route.fulfill({ status: 503, json: { error: 'Settings not saved' } });
        }
        api.settings = { ...input };
        return route.fulfill({ json: api.settings });
      }
      api.unexpectedRequests.push(`${method} ${path}`);
      return route.fulfill({ status: 501, json: { error: 'Unexpected test API request' } });
    });
    await use(api);
    expect(api.unexpectedRequests).toEqual([]);
  },
});

export { expect };

export const panel = (page: Page) => page.getByTestId('panel-protection-settings');
export const saveButton = (page: Page) => panel(page).getByTestId('button-save-protection');

export async function expectValues(page: Page, settings: ProtectionSettings) {
  await expect(panel(page).getByRole('switch')).toBeChecked({ checked: settings.enabled });
  await expect(panel(page).getByTestId('select-block-start')).toHaveValue(String(settings.blockStartHour));
  await expect(panel(page).getByTestId('select-block-end')).toHaveValue(String(settings.blockEndHour));
  await expect(panel(page).getByTestId('input-cooldown-minutes')).toHaveValue(String(settings.cooldownMinutes));
}

export async function editValues(page: Page, settings = EDITED) {
  await panel(page).getByRole('switch').setChecked(settings.enabled);
  await panel(page).getByTestId('select-block-start').selectOption(String(settings.blockStartHour));
  await panel(page).getByTestId('select-block-end').selectOption(String(settings.blockEndHour));
  await panel(page).getByTestId('input-cooldown-minutes').fill(String(settings.cooldownMinutes));
}

export async function openSettings(page: Page) {
  await page.goto('/');
  await expectValues(page, INITIAL);
  await expect(saveButton(page)).toBeDisabled();
}
