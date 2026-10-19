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
