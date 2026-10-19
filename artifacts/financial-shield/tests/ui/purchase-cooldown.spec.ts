import { test, expect, ID, openHome, advance, answerNo } from './purchase-fixture';

test('creating then reloading during cooldown keeps the original deadline and blocks continuation', async ({ page, api }) => {
  await openHome(page, api);
  await page.getByTestId('input-merchant-name').fill('متجر اختبار التهدئة');
  await page.getByTestId('input-purchase-amount').fill('12.5');
  await page.getByTestId('button-submit-simulation').click();
  const timer = page.getByTestId(`timer-${ID}`);
  const proceed = page.getByTestId(`continue-${ID}`);
  await expect(timer).toHaveText('01:00');
  const deadline = api.purchase!.cooldownEndsAt;

  await advance(page, api, 20_000);
  await expect(timer).toHaveText('00:40');
  await page.reload();
  await expect(timer).toHaveText('00:40');
  expect(api.purchase!.cooldownEndsAt).toBe(deadline);
  await expect(proceed).toBeDisabled();
  await expect(page.getByTestId(`question-need-${ID}`)).toHaveCount(0);
  await expect(page.getByTestId(`question-budget-${ID}`)).toHaveCount(0);
  // A client wall-clock jump must not shorten the server-anchored countdown.
  await page.clock.setSystemTime(api.now + 86_400_000);
  await page.clock.runFor(1000);
  await expect(timer).toHaveText('00:39');
  await expect(proceed).toBeDisabled();
  expect(api.decisions).toEqual([]);
});

test('the exact deadline unlocks questions, but both answers are required and no is valid', async ({ page, api }) => {
  api.seed();
  await openHome(page, api);
  const proceed = page.getByTestId(`continue-${ID}`);
  await advance(page, api, 9_000);
  await expect(page.getByTestId(`timer-${ID}`)).toHaveText('00:01');
  await expect(proceed).toBeDisabled();
  await advance(page, api, 1000);
  await expect(page.getByTestId(`timer-${ID}`)).toHaveCount(0);
  await expect(proceed).toBeDisabled();
  await page.getByTestId(`question-budget-${ID}`).selectOption('no');
  await expect(proceed).toBeDisabled();
  await page.getByTestId(`question-budget-${ID}`).selectOption('');
  await page.getByTestId(`question-need-${ID}`).selectOption('no');
  await expect(proceed).toBeDisabled();
  await page.getByTestId(`question-budget-${ID}`).selectOption('no');
  await expect(proceed).toBeEnabled();
  await proceed.click();
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
  expect(api.decisions).toEqual([{ action: 'continue', isNecessary: false, fitsBudget: false }]);
  await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('محاكاة مسجلة');
  await page.reload();
  await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('محاكاة مسجلة');
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
});

test('reload after expiry restores an unresolved attempt, not a new cooldown or an automatic decision', async ({ page, api }) => {
  api.seed();
  await openHome(page, api);
  // The server deadline passes while this document is not running.
  api.now += 15_000;
  await page.reload();
  await expect(page.getByTestId(`question-need-${ID}`)).toBeVisible();
  await expect(page.getByTestId(`timer-${ID}`)).toHaveCount(0);
  await expect(page.getByTestId(`continue-${ID}`)).toBeDisabled();
  expect(api.decisions).toEqual([]);
  await answerNo(page);
  // Unsubmitted answers need to be answered again after a reload.
  await page.reload();
  await expect(page.getByTestId(`question-need-${ID}`)).toHaveValue('');
  await expect(page.getByTestId(`question-budget-${ID}`)).toHaveValue('');
  await expect(page.getByTestId(`continue-${ID}`)).toBeDisabled();
});

test('postponement works during cooldown without answers and survives in history after reload', async ({ page, api }) => {
  api.seed(60);
  await openHome(page, api);
  await expect(page.getByTestId(`continue-${ID}`)).toBeDisabled();
  await page.getByTestId(`postpone-${ID}`).click();
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
  await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('تم تأجيل الشراء');
  expect(api.decisions).toEqual([{ action: 'postpone' }]);
  await page.reload();
  await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('تم تأجيل الشراء');
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
});

for (const failure of ['server', 'network'] as const) {
  test(`${failure} failure keeps answers and pending attempt; retry saves only after success`, async ({ page, api }) => {
    api.seed(0);
    api.failure = failure;
    await openHome(page, api);
    await answerNo(page);
    let release!: () => void;
    api.holdDecision = new Promise<void>((resolve) => { release = resolve; });
    const proceed = page.getByTestId(`continue-${ID}`);
    await proceed.click();
    await expect(proceed).toBeDisabled();
    await expect(page.getByTestId(`postpone-${ID}`)).toBeDisabled();
    await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('بانتظار القرار');
    release();
    const card = page.getByTestId(`cooldown-${ID}`);
    await expect(card.getByRole('alert')).toHaveText(failure === 'server'
      ? 'تعذر حفظ القرار للاختبار'
      : 'تعذر حفظ القرار. تحققي من الاتصال ثم حاولي مجددًا.');
    await expect(page.getByTestId(`question-need-${ID}`)).toHaveValue('no');
    await expect(page.getByTestId(`question-budget-${ID}`)).toHaveValue('no');
    await expect(proceed).toBeEnabled();
    expect(api.purchase!.status).toBe('cooling_down');
    await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('بانتظار القرار');
    api.failure = null;
    await proceed.click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('محاكاة مسجلة');
    expect(api.decisions).toEqual([
      { action: 'continue', isNecessary: false, fitsBudget: false },
      { action: 'continue', isNecessary: false, fitsBudget: false },
    ]);
    await page.reload();
    await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('محاكاة مسجلة');
  });
}

test('failed postponement is not removed or shown as saved, and can be retried', async ({ page, api }) => {
  api.seed(60);
  api.failure = 'server';
  await openHome(page, api);
  await page.getByTestId(`postpone-${ID}`).click();
  await expect(page.getByTestId(`cooldown-${ID}`).getByRole('alert')).toBeVisible();
  await expect(page.getByTestId(`timer-${ID}`)).toHaveText('01:00');
  await page.reload();
  await expect(page.getByTestId(`cooldown-${ID}`)).toBeVisible();
  await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('بانتظار القرار');
  api.failure = null;
  await page.getByTestId(`postpone-${ID}`).click();
  await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('تم تأجيل الشراء');
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
});

test('another window changing settings cannot shorten an existing deadline', async ({ page, context, api }) => {
  api.seed(60);
  const deadline = api.purchase!.cooldownEndsAt;
  await openHome(page, api);
  const second = await context.newPage();
  await openHome(second, api);
  // Another actor has saved settings. This task tests the reader's refresh,
  // not the settings form/persistence (covered separately).
  api.settings = { ...api.settings, enabled: false, cooldownMinutes: 1 };
  const reads = api.dashboardReads;
  await advance(page, api, 30_000);
  await expect.poll(() => api.dashboardReads).toBeGreaterThan(reads);
  await expect(page.getByTestId('status-protection')).toContainText('الدرع غير مفعّل');
  // Clock keeps running so React Query's asynchronous notifications can flush.
  // Opening the second page may consume a second before the 30s advance.
  await expect(page.getByTestId(`timer-${ID}`)).toHaveText(/^00:(?:2[8-9]|30)$/);
  expect(api.purchase!.cooldownEndsAt).toBe(deadline);
  await expect(page.getByTestId(`continue-${ID}`)).toBeDisabled();
  await second.reload();
  await expect(second.getByTestId(`timer-${ID}`)).toHaveText('00:30');
  expect(api.decisions).toEqual([]);
});

for (const action of ['continue', 'postpone'] as const) {
  test(`another window's ${action} decision updates the first window through polling`, async ({ page, context, api }) => {
    api.seed(0);
    await openHome(page, api);
    await answerNo(page);
    const second = await context.newPage();
    await openHome(second, api);
    if (action === 'continue') await answerNo(second);
    await second.getByTestId(`${action}-${ID}`).click();
    const label = action === 'continue' ? 'محاكاة مسجلة' : 'تم تأجيل الشراء';
    await expect(second.getByTestId(`row-simulation-${ID}`)).toContainText(label);
    await expect(page.getByTestId(`cooldown-${ID}`)).toBeVisible();
    await advance(page, api, 30_000);
    await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText(label);
    expect(api.decisions).toHaveLength(1);
    await page.reload();
    await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText(label);
    await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
  });
}

test('a stale-window conflict refreshes the saved decision instead of leaving an actionable attempt', async ({ page, context, api }) => {
  api.seed(0);
  await openHome(page, api);
  await answerNo(page);
  const second = await context.newPage();
  await openHome(second, api);
  await second.getByTestId(`postpone-${ID}`).click();
  await expect(second.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
  // First window has not polled yet and still offers continue.
  await page.getByTestId(`continue-${ID}`).click();
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
  await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText('تم تأجيل الشراء');
  expect(api.purchase!.status).toBe('postponed');
  expect(api.decisions).toHaveLength(2);
});
