import { test, expect, ID, START, openHome, advance, answerNo } from './purchase-fixture';

for (const action of ['continue', 'postpone'] as const) {
  test(`an older pending attempt survives a full history, expiry and reload; ${action} preserves other attempts`, async ({ page, api }) => {
    api.seed(60);
    const deadline = api.purchase!.cooldownEndsAt;
    api.otherPurchases = Array.from({ length: 10 }, (_, index) => ({
      ...api.snapshot(),
      id: `recent-${index}`,
      merchantName: `متجر حديث ${index}`,
      createdAt: new Date(START - index * 1000).toISOString(),
      // Keep another unresolved attempt to catch clearing the whole pending list.
      status: index === 0 ? 'cooling_down' : 'simulated',
      cooldownEndsAt: index === 0 ? deadline : null,
      decidedAt: index === 0 ? null : new Date(START).toISOString(),
    }));
    const recentIds = api.otherPurchases.map((purchase) => purchase.id);
    expect(api.dashboard().recentSimulations.map((purchase) => purchase.id)).toEqual(recentIds);
    expect(api.dashboard().pendingSimulations.map((purchase) => purchase.id)).toEqual(['recent-0', ID]);

    async function expectOtherAttempts() {
      await expect(page.getByTestId(/^row-simulation-/)).toHaveCount(10);
      for (const id of recentIds) {
        await expect(page.getByTestId(`row-simulation-${id}`)).toBeVisible();
      }
      await expect(page.getByTestId('row-simulation-recent-0')).toContainText('بانتظار القرار');
      await expect(page.getByTestId('cooldown-recent-0')).toBeVisible();
    }

    await openHome(page, api);
    const olderCard = page.getByTestId(`cooldown-${ID}`);
    await expect(olderCard).toBeVisible();
    await expect(page.getByTestId(`timer-${ID}`)).toBeVisible();
    await expect(page.getByTestId(`continue-${ID}`)).toBeDisabled();
    await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(0);
    await expectOtherAttempts();

    await page.reload();
    await expect(olderCard).toBeVisible();
    await expect(page.getByTestId(`continue-${ID}`)).toBeDisabled();
    expect(api.purchase!.cooldownEndsAt).toBe(deadline);
    await advance(page, api, 61_000);
    await expect(page.getByTestId(`timer-${ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`question-need-${ID}`)).toBeVisible();
    await answerNo(page);
    await expect(page.getByTestId(`continue-${ID}`)).toBeEnabled();
    expect(api.decisions).toEqual([]);

    // Restore from pendingSimulations alone after expiry, not from the history.
    await page.reload();
    await expect(olderCard).toBeVisible();
    await expect(page.getByTestId(`timer-${ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`question-need-${ID}`)).toHaveValue('');
    await expect(page.getByTestId(`question-budget-${ID}`)).toHaveValue('');
    expect(api.purchase!.cooldownEndsAt).toBe(deadline);
    await answerNo(page);
    await expect(page.getByTestId(`continue-${ID}`)).toBeEnabled();
    await expectOtherAttempts();

    const reads = api.dashboardReads;
    await page.getByTestId(`${action}-${ID}`).click();
    await expect(olderCard).toHaveCount(0);
    await expectOtherAttempts();
    // Also check the invalidated/refetched dashboard, not only the local cache.
    await expect.poll(() => api.dashboardReads).toBeGreaterThan(reads);
    expect(api.decisions).toEqual([action === 'continue'
      ? { action, isNecessary: false, fitsBudget: false }
      : { action }]);
    expect(api.purchase!.status).toBe(action === 'continue' ? 'simulated' : 'postponed');
    expect(api.dashboard().pendingSimulations.map((purchase) => purchase.id)).toEqual(['recent-0']);
    await page.reload();
    await expect(olderCard).toHaveCount(0);
    await expectOtherAttempts();
    await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(0);
    expect(api.decisions).toHaveLength(1);
  });
}
