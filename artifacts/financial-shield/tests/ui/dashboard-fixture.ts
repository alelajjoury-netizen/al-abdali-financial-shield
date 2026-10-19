import { test as base, expect } from '@playwright/test';
import type { Dashboard, ProtectionSettings } from '@workspace/api-client-react';

/** Read-only API boundary: no server, database, or shared demo data. */
class DashboardApi {
  reads = 0;
  unexpectedRequests: string[] = [];
  dashboard: Dashboard = {
    account: { displayName: 'حساب اختبار أول', availableBalance: 12345.678, currency: 'KWD' },
    virtualCard: { holderName: 'حامل بطاقة أول', lastFour: '9071', status: 'active' },
    protectionEnabled: false,
    recentSimulations: [],
    pendingSimulations: [],
  };
  settings: ProtectionSettings = {
    enabled: false, blockStartHour: 22, blockEndHour: 6, cooldownMinutes: 15,
  };
}

export const test = base.extend<{ api: DashboardApi }>({
  api: async ({ context }, use) => {
    const api = new DashboardApi();
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/dashboard') {
        api.reads++;
        return route.fulfill({ json: api.dashboard });
      }
      if (request.method() === 'GET' && path === '/api/protection-settings') {
        return route.fulfill({ json: api.settings });
      }
      api.unexpectedRequests.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 501, json: { error: 'Unexpected test API request' } });
    });
    await use(api);
    expect(api.unexpectedRequests).toEqual([]);
  },
});

export { expect };
