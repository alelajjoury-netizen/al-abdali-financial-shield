import type { Page } from '@playwright/test';
import { test, expect } from './dashboard-fixture';

async function expectOverview(
  page: Page,
  values: { name: string; balance: string; holder: string; lastFour: string; status: string },
) {
  await expect(page.getByTestId('text-welcome')).toHaveText(`مرحباً، ${values.name}`);
  // Literal expectations catch locale, separator and decimal precision regressions.
  const balance = page.getByTestId('text-available-balance');
  await expect(balance.locator('small')).toHaveText('د.ك');
  await expect(balance).toHaveText(`د.ك${values.balance}`);
  const card = page.getByTestId('card-virtual-card');
  await expect(card.locator('.card-holder')).toHaveText(values.holder);
  await expect(card.locator('.card-number')).toHaveText(`•••• •••• •••• ${values.lastFour}`);
  await expect(card.locator('.card-number')).toHaveAttribute('dir', 'ltr');
  await expect(card.locator('.card-status')).toHaveText(values.status);
}

async function expectUnavailableOverview(page: Page) {
  await expect(page.getByTestId('message-balance-unavailable')).toContainText('الرصيد غير متاح');
  await expect(page.getByTestId('message-card-unavailable')).toHaveText('بيانات البطاقة غير متاحة');
  await expect(page.getByTestId('text-available-balance')).toHaveCount(0);
  const card = page.getByTestId('card-virtual-card');
  await expect(card.locator('.card-holder, .card-number, .card-status')).toHaveCount(0);
  await expect(page.getByTestId('text-welcome')).toHaveText('مرحباً، بك');
}

test('503 shows unavailable account/card data and explicit retry restores confirmed values', async ({ page, api }) => {
  api.dashboardUnavailable = true;
  await page.goto('/');
  // Include the query's automatic retries: success must come from the user's
  // explicit retry, not a later automatic response.
  await expect(page.getByTestId('message-dashboard-error')).toBeVisible({ timeout: 15_000 });
  await expectUnavailableOverview(page);
  api.dashboardUnavailable = false;
  await page.getByTestId('button-retry-account').click();
  await expectOverview(page, {
    name: 'حساب اختبار أول', balance: '١٢٬٣٤٥٫٦٧٨',
    holder: 'حامل بطاقة أول', lastFour: '9071', status: 'نشطة · تجريبية',
  });
  await expect(page.getByTestId('message-balance-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('message-card-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('message-dashboard-error')).toHaveCount(0);
});

test('failed polling hides cached account/card values until retry confirms a genuine zero balance', async ({ page, api }) => {
  await page.clock.install();
  await page.goto('/');
  await expectOverview(page, {
    name: 'حساب اختبار أول', balance: '١٢٬٣٤٥٫٦٧٨',
    holder: 'حامل بطاقة أول', lastFour: '9071', status: 'نشطة · تجريبية',
  });
  api.dashboardUnavailable = true;
  await page.clock.fastForward(30_100);
  await expect(page.getByTestId('message-dashboard-error')).toBeVisible({ timeout: 15_000 });
  await expectUnavailableOverview(page);

  api.dashboard = {
    ...api.dashboard,
    account: { displayName: 'حساب اختبار محدّث', availableBalance: 0, currency: 'KWD' },
    virtualCard: { holderName: 'حامل بطاقة محدّث', lastFour: '0042', status: 'inactive' },
  };
  api.dashboardUnavailable = false;
  await page.getByTestId('button-retry-account').click();
  await expectOverview(page, {
    name: 'حساب اختبار محدّث', balance: '٠٫٠٠٠',
    holder: 'حامل بطاقة محدّث', lastFour: '0042', status: 'غير نشطة',
  });
  await expect(page.getByTestId('message-balance-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('message-card-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('message-dashboard-error')).toHaveCount(0);
});

for (const [initialStatus, updatedStatus, initialLabel, updatedLabel] of [
  ['active', 'inactive', 'نشطة · تجريبية', 'غير نشطة'],
  ['ENABLED', 'DISABLED', 'نشطة · تجريبية', 'غير نشطة'],
  ['frozen', 'expired', 'frozen', 'expired'],
] as const) {
  test(`dashboard refresh replaces account/card values and renders ${initialStatus} → ${updatedStatus}`, async ({ page, api }) => {
    await page.clock.install();
    api.dashboard.virtualCard.status = initialStatus;
    await page.goto('/');
    await expectOverview(page, {
      name: 'حساب اختبار أول', balance: '١٢٬٣٤٥٫٦٧٨',
      holder: 'حامل بطاقة أول', lastFour: '9071', status: initialLabel,
    });

    api.dashboard = {
      ...api.dashboard,
      account: { displayName: 'حساب اختبار محدّث', availableBalance: 98.5, currency: 'KWD' },
      virtualCard: { holderName: 'حامل بطاقة محدّث', lastFour: '0042', status: updatedStatus },
    };
    const reads = api.reads;
    // Exercise the actual dashboard polling and query cache, not a remount.
    await page.clock.fastForward(30_100);
    await expect.poll(() => api.reads).toBeGreaterThan(reads);
    const updated = {
      name: 'حساب اختبار محدّث', balance: '٩٨٫٥٠٠',
      holder: 'حامل بطاقة محدّث', lastFour: '0042', status: updatedLabel,
    };
    await expectOverview(page, updated);
    await expect(page.getByTestId('text-welcome')).not.toContainText('حساب اختبار أول');
    await expect(page.getByTestId('card-virtual-card')).not.toContainText('حامل بطاقة أول');
    await expect(page.getByTestId('card-virtual-card')).not.toContainText('9071');

    await page.reload();
    await expectOverview(page, updated);
  });
}
