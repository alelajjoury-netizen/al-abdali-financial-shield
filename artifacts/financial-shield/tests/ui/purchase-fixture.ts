import { test as base, expect, type Page } from '@playwright/test';
import type {
  Dashboard, PurchaseSimulation, PurchaseDecisionInput, ProtectionSettings, PurchaseSimulationInput,
} from '@workspace/api-client-react';

export const START = Date.parse('2026-10-19T10:00:00.000Z');
export const ID = 'purchase-cooldown-test';

/** In-memory API boundary, shared by both pages but discarded after each test.
 * Production React components, generated API hooks and React Query run unmocked.
 * This is deliberately not a test of server enforcement (covered in API tests).
 */
export class PurchaseApi {
  now = START;
  clockInstalled = false;
  purchase: PurchaseSimulation | null = null;
  decisions: PurchaseDecisionInput[] = [];
  dashboardReads = 0;
  failure: 'server' | 'network' | null = null;
  holdDecision: Promise<void> | null = null;
  creations: PurchaseSimulationInput[] = [];
  lostCreationResponse = false;
  holdCreation: Promise<void> | null = null;
  creationCount = 0;
  purchasesByKey = new Map<string, PurchaseSimulation>();
  unexpectedRequests: string[] = [];
  settings: ProtectionSettings = {
    enabled: true, blockStartHour: 0, blockEndHour: 23, cooldownMinutes: 1,
  };

  seed(remainingSeconds = 10) {
    this.purchase = {
      id: ID, merchantName: 'متجر اختبار التهدئة', amount: 12.5,
      currency: 'KWD', status: 'cooling_down',
      cooldownEndsAt: new Date(this.now + remainingSeconds * 1000).toISOString(),
      serverTime: new Date(this.now).toISOString(), decidedAt: null,
      createdAt: new Date(START - 50_000).toISOString(),
    };
  }

  snapshot(): PurchaseSimulation {
    if (!this.purchase) throw new Error('No purchase seeded');
    return { ...this.purchase, serverTime: new Date(this.now).toISOString() };
  }

  dashboard(): Dashboard {
    const purchases = this.purchase ? [this.snapshot()] : [];
    return {
      account: { displayName: 'حساب الاختبار', availableBalance: 250, currency: 'KWD' },
      virtualCard: { holderName: 'حساب الاختبار', lastFour: '1234', status: 'active' },
      protectionEnabled: this.settings.enabled,
      recentSimulations: purchases,
      pendingSimulations: purchases.filter((p) => p.status === 'cooling_down'),
    };
  }

  finish(action: PurchaseDecisionInput['action']) {
    if (!this.purchase) throw new Error('No purchase seeded');
    this.purchase.status = action === 'postpone' ? 'postponed' : 'simulated';
    this.purchase.decidedAt = new Date(this.now).toISOString();
  }
}

export const test = base.extend<{ api: PurchaseApi }>({
  api: async ({ context }, use) => {
    const api = new PurchaseApi();
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (path === '/api/dashboard' && method === 'GET') {
        api.dashboardReads++;
        return route.fulfill({ json: api.dashboard() });
      }
      if (path === '/api/protection-settings' && method === 'GET') {
        return route.fulfill({ json: api.settings });
      }
      if (path === '/api/purchases/simulate' && method === 'POST') {
        const input: PurchaseSimulationInput = request.postDataJSON();
        api.creations.push(input);
        expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
        if (api.holdCreation) await api.holdCreation;
        const existing = api.purchasesByKey.get(input.idempotencyKey);
        if (!existing) {
          api.seed(60);
          Object.assign(api.purchase!, {
            merchantName: input.merchantName, amount: input.amount, currency: input.currency,
          });
          api.purchasesByKey.set(input.idempotencyKey, api.purchase!);
          api.creationCount++;
        } else {
          api.purchase = existing;
        }
        if (api.lostCreationResponse) return route.abort('failed');
        return route.fulfill({ status: existing ? 200 : 201, json: api.snapshot() });
      }
      if (path === `/api/purchases/${ID}/decision` && method === 'POST') {
        const decision: PurchaseDecisionInput = request.postDataJSON();
        api.decisions.push(decision);
        if (api.holdDecision) await api.holdDecision;
        if (api.failure === 'network') return route.abort('failed');
        if (api.failure === 'server') {
          return route.fulfill({ status: 503, json: { error: 'تعذر حفظ القرار للاختبار' } });
        }
        // Reject stale second-window submissions instead of pretending success.
        if (api.purchase?.status !== 'cooling_down') {
          return route.fulfill({ status: 409, json: { error: 'سبق حفظ القرار' } });
        }
        api.finish(decision.action);
        return route.fulfill({ json: api.snapshot() });
      }
      api.unexpectedRequests.push(`${method} ${path}`);
      return route.fulfill({ status: 501, json: { error: 'Unexpected test API request' } });
    });
    await use(api);
    expect(api.unexpectedRequests).toEqual([]);
  },
});

export { expect };

export async function openHome(page: Page, api: PurchaseApi) {
  // Playwright's clock is context-wide: installing it again for the second
  // window would reset the first window's monotonic countdown.
  if (!api.clockInstalled) {
    await page.clock.install({ time: api.now });
    api.clockInstalled = true;
  }
  await page.goto('/');
  await expect(page.getByTestId('text-welcome')).toContainText('حساب الاختبار');
}

export async function advance(page: Page, api: PurchaseApi, milliseconds: number) {
  api.now += milliseconds;
  await page.clock.runFor(milliseconds);
}

export async function answerNo(page: Page) {
  await page.getByTestId(`question-need-${ID}`).selectOption('no');
  await page.getByTestId(`question-budget-${ID}`).selectOption('no');
}
