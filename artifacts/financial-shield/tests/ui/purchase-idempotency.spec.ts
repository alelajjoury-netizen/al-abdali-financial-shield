import { test, expect, ID, openHome, advance, answerNo } from './purchase-fixture';
import type { Page } from '@playwright/test';

const STORAGE_KEY = 'financial-shield-pending-purchase';

// Installed before React mounts; affects only this test's tab and purchase key.
async function rejectPurchaseStorage(page: Page, operation: 'getItem' | 'setItem' | 'removeItem') {
  await page.addInitScript(({ key, operation }) => {
    let blocked = true;
    window.addEventListener('test:allow-purchase-storage', () => { blocked = false; });
    const original = Storage.prototype[operation];
    Object.defineProperty(Storage.prototype, operation, { configurable: true, writable: true, value: new Proxy(original, {
      apply(target, storage, args) {
        if (blocked && storage === window.sessionStorage && args[0] === key) {
          throw new DOMException('Purchase storage denied for test', 'SecurityError');
        }
        return Reflect.apply(target, storage, args);
      },
    }) });
  }, { key: STORAGE_KEY, operation });
}

async function allowPurchaseStorage(page: Page) {
  await page.evaluate(() => { window.dispatchEvent(new Event('test:allow-purchase-storage')); });
}

async function submitFormDirectly(page: Page) {
  await page.locator('form').filter({ has: page.getByTestId('button-submit-simulation') }).evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

test('a lost creation response survives reload and retry keeps the key, record and original deadline', async ({ page, api }) => {
  api.lostCreationResponse = true;
  await openHome(page, api);
  await page.getByTestId('input-merchant-name').fill('متجر اختبار الإعادة');
  await page.getByTestId('input-purchase-amount').fill('12.5');
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('message-form-error')).toContainText('لم نتلقَّ تأكيدًا');
  const original = { ...api.purchase! };
  const request = { ...api.creations[0] };
  await advance(page, api, 20_000);
  await page.reload();
  await expect(page.getByTestId('input-merchant-name')).toHaveValue(request.merchantName);
  await expect(page.getByTestId('input-merchant-name')).toBeDisabled();
  await expect(page.getByTestId('input-purchase-amount')).toBeDisabled();
  await expect(page.getByTestId(`timer-${ID}`)).toHaveText('00:40');
  api.lostCreationResponse = false;
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('message-form-success')).toBeVisible();
  expect(api.creations).toEqual([request, request]);
  expect(api.creationCount).toBe(1);
  expect(api.purchase!.cooldownEndsAt).toBe(original.cooldownEndsAt);
  await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(1);
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(1);
  await expect(page.getByTestId(`timer-${ID}`)).toHaveText('00:40');
  await expect(page.getByTestId('input-merchant-name')).toBeEnabled();
  await expect(page.getByTestId('input-merchant-name')).toHaveValue('');
  // A successful submission followed by the same intentional purchase gets a fresh key.
  await page.getByTestId('input-merchant-name').fill(request.merchantName);
  await page.getByTestId('input-purchase-amount').fill(String(request.amount));
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('message-form-success')).toBeVisible();
  expect(api.creations[2].idempotencyKey).not.toBe(request.idempotencyKey);
  expect(api.creationCount).toBe(2);
});

for (const action of ['continue', 'postpone'] as const) {
  test(`retrying a lost creation response after another window's ${action} restores only the final decision`, async ({ page, context, api }) => {
    api.lostCreationResponse = true;
    await openHome(page, api);
    await page.getByTestId('input-merchant-name').fill('متجر استعادة القرار');
    await page.getByTestId('input-purchase-amount').fill('12.5');
    await page.getByTestId('button-submit-simulation').click();
    await expect(page.getByTestId('message-form-error')).toContainText('لم نتلقَّ تأكيدًا');
    const request = { ...api.creations[0] };
    const originalDeadline = api.purchase!.cooldownEndsAt;
    // The original tab retains its uncertain request even though history knows
    // about the saved purchase. Reload must not send another creation by itself.
    await page.reload();
    await expect(page.getByTestId('input-merchant-name')).toHaveValue(request.merchantName);
    await expect(page.getByTestId('input-merchant-name')).toBeDisabled();
    expect(api.creations).toEqual([request]);
    await expect(page.getByTestId(`cooldown-${ID}`)).toBeVisible();

    const second = await context.newPage();
    await openHome(second, api);
    if (action === 'continue') {
      await advance(second, api, 60_000);
      await answerNo(second);
    } else {
      // Postponement ends the attempt while its original deadline is future.
      await expect(second.getByTestId(`timer-${ID}`)).toBeVisible();
      await expect(second.getByTestId(`continue-${ID}`)).toBeDisabled();
    }
    await second.getByTestId(`${action}-${ID}`).click();
    const label = action === 'continue' ? 'محاكاة مسجلة' : 'تم تأجيل الشراء';
    await expect(second.getByTestId(`row-simulation-${ID}`)).toContainText(label);
    await expect(second.getByTestId(`cooldown-${ID}`)).toHaveCount(0);
    const finalPurchase = { ...api.purchase! };
    const expectedDecisions = action === 'continue'
      ? [{ action, isNecessary: false, fitsBudget: false }]
      : [{ action }];
    expect(api.decisions).toEqual(expectedDecisions);

    let releaseDashboard!: () => void;
    api.holdDashboard = new Promise<void>((resolve) => { releaseDashboard = resolve; });
    try {
      api.lostCreationResponse = false;
      const replayResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/purchases/simulate') && response.request().method() === 'POST');
      await page.getByTestId('button-submit-simulation').click();
      const response = await replayResponse;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual(api.snapshot());
      // With dashboard refetches held, these assertions exercise the mutation's
      // cache update rather than allowing a GET to hide a reopened pending card.
      await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(1);
      await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText(label);
      await expect(page.getByRole('region', { name: 'المحاولات قيد التهدئة' })).toHaveCount(0);
      for (const prefix of ['cooldown', 'timer', 'question-need', 'question-budget', 'continue', 'postpone']) {
        await expect(page.getByTestId(`${prefix}-${ID}`)).toHaveCount(0);
      }
    } finally {
      api.holdDashboard = null;
      releaseDashboard();
    }

    const message = action === 'continue'
      ? 'المحاكاة محفوظة. لم يتم إنشاء نسخة مكررة أو خصم أي مبلغ من رصيدك.'
      : 'استُعيدت المحاولة المؤجلة نفسها. لم يتم إنشاء محاولة أخرى أو خصم أموال.';
    await expect(page.getByTestId('message-form-success')).toHaveCount(1);
    await expect(page.getByTestId('message-form-success')).toHaveText(message);
    await expect(page.getByTestId('message-form-error')).toHaveCount(0);
    await expect(page.getByTestId('input-merchant-name')).toBeEnabled();
    await expect(page.getByTestId('input-merchant-name')).toHaveValue('');
    await expect(page.getByTestId('input-purchase-amount')).toHaveValue('');
    expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();

    // Pass the original deadline as well: a postponed attempt must not later
    // reopen awareness questions, and a completed one must stay completed.
    await advance(page, api, 61_000);
    await page.reload();
    await expect(page.getByTestId('text-welcome')).toContainText('حساب الاختبار');
    await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(1);
    await expect(page.getByTestId(`row-simulation-${ID}`)).toContainText(label);
    await expect(page.getByRole('region', { name: 'المحاولات قيد التهدئة' })).toHaveCount(0);
    for (const prefix of ['cooldown', 'timer', 'question-need', 'question-budget', 'continue', 'postpone']) {
      await expect(page.getByTestId(`${prefix}-${ID}`)).toHaveCount(0);
    }
    await expect(page.getByTestId('message-form-success')).toHaveCount(0);
    await expect(page.getByTestId('message-form-error')).toHaveCount(0);
    await expect(page.getByTestId('input-merchant-name')).toBeEnabled();
    await expect(page.getByTestId('input-merchant-name')).toHaveValue('');
    expect(api.creations).toEqual([request, request]);
    expect(api.creationCount).toBe(1);
    expect(api.purchasesByKey.size).toBe(1);
    expect(api.purchase).toEqual(finalPurchase);
    expect(api.purchase!.cooldownEndsAt).toBe(originalDeadline);
    expect(api.decisions).toEqual(expectedDecisions);
    expect(api.dashboard().pendingSimulations).toEqual([]);
  });
}

test('double submission is blocked; an explicit new attempt after failure uses a fresh key', async ({ page, api }) => {
  api.lostCreationResponse = true;
  let release!: () => void;
  api.holdCreation = new Promise<void>((resolve) => { release = resolve; });
  await openHome(page, api);
  await page.getByTestId('input-merchant-name').fill('متجر جديد');
  await page.getByTestId('input-purchase-amount').fill('1');
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('button-submit-simulation')).toBeDisabled();
  await page.locator('form').filter({ has: page.getByTestId('button-submit-simulation') }).evaluate((form: HTMLFormElement) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  release();
  await expect(page.getByTestId('message-form-error')).toBeVisible();
  expect(api.creations).toHaveLength(1);
  const firstKey = api.creations[0].idempotencyKey;
  await page.getByTestId('button-new-simulation').click();
  await expect(page.getByTestId('input-merchant-name')).toBeEnabled();
  await page.getByTestId('input-merchant-name').fill('متجر جديد');
  await page.getByTestId('input-purchase-amount').fill('1');
  api.lostCreationResponse = false;
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('message-form-success')).toBeVisible();
  expect(api.creations).toHaveLength(2);
  expect(api.creations[1].idempotencyKey).not.toBe(firstKey);
});

test('denied storage writes prevent POST until the retry key can be saved', async ({ page, api }) => {
  await rejectPurchaseStorage(page, 'setItem');
  await openHome(page, api);
  await page.getByTestId('input-merchant-name').fill('متجر رفض التخزين');
  await page.getByTestId('input-purchase-amount').fill('12.5');
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('message-form-error')).toContainText('تعذر حفظ مفتاح إعادة المحاولة');
  await expect(page.getByTestId('message-form-error')).toContainText('لم نرسل الطلب');
  // Also exercise the handler, not just the button's disabled state.
  await submitFormDirectly(page);
  await advance(page, api, 31_000);
  expect(api.creations).toEqual([]);
  expect(api.creationCount).toBe(0);
  expect(api.purchase).toBeNull();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
  await expect(page.getByTestId('input-merchant-name')).toBeEnabled();
  await expect(page.getByTestId('input-merchant-name')).toHaveValue('متجر رفض التخزين');
  await expect(page.getByTestId('input-purchase-amount')).toHaveValue('12.5');
  await expect(page.getByTestId('message-form-success')).toHaveCount(0);
  await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(0);

  await allowPurchaseStorage(page);
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('message-form-success')).toBeVisible();
  expect(api.creations).toHaveLength(1);
  expect(api.creationCount).toBe(1);
});

const validStoredRequest = {
  idempotencyKey: '12345678-1234-4234-8234-123456789abc',
  merchantName: 'متجر الطلب السابق', amount: 12.5, currency: 'KWD', timeZone: 'Asia/Kuwait',
};

for (const scenario of [
  { name: 'denied storage reads', raw: null },
  { name: 'malformed JSON', raw: '{"idempotencyKey":' },
  { name: 'invalid retry identity', raw: JSON.stringify({ ...validStoredRequest, idempotencyKey: 'broken-key' }) },
  { name: 'invalid purchase amount', raw: JSON.stringify({ ...validStoredRequest, amount: -1 }) },
  { name: 'incomplete stored request', raw: JSON.stringify({ idempotencyKey: validStoredRequest.idempotencyKey }) },
]) {
  test(`${scenario.name} warns on restore and never implicitly creates a purchase`, async ({ page, api }) => {
    if (scenario.raw === null) {
      await rejectPurchaseStorage(page, 'getItem');
    } else {
      await page.addInitScript(({ key, raw }) => sessionStorage.setItem(key, raw), {
        key: STORAGE_KEY, raw: scenario.raw,
      });
    }
    // History can contain an already saved attempt even when recovery fails.
    api.seed();
    await openHome(page, api);
    const warning = page.getByTestId('message-form-error');
    await expect(warning).toContainText('تعذر استعادة الطلب السابق');
    await expect(warning).toContainText('قد تكون المحاولة السابقة محفوظة');
    await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(1);
    await expect(page.getByTestId('input-merchant-name')).toBeDisabled();
    await expect(page.getByTestId('input-purchase-amount')).toBeDisabled();
    await expect(page.getByTestId('button-submit-simulation')).toBeDisabled();
    await expect(page.getByTestId('input-merchant-name')).toHaveValue('');
    await expect(page.getByTestId('input-purchase-amount')).toHaveValue('');
    await submitFormDirectly(page);
    await advance(page, api, 31_000);
    await page.reload();
    await expect(warning).toContainText('تعذر استعادة الطلب السابق');
    await expect(page.getByTestId('button-submit-simulation')).toBeDisabled();
    expect(api.creations).toEqual([]);
    expect(api.creationCount).toBe(0);
    await expect(page.getByTestId('message-form-success')).toHaveCount(0);
    if (scenario.raw !== null) {
      expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBe(scenario.raw);
    }
  });
}

test('failed cleanup after success retains the original request across retries and reload without duplicates', async ({ page, api }) => {
  await rejectPurchaseStorage(page, 'removeItem');
  await openHome(page, api);
  await page.getByTestId('input-merchant-name').fill('متجر رفض المسح');
  await page.getByTestId('input-purchase-amount').fill('12.5');
  await page.getByTestId('button-submit-simulation').click();
  const warning = page.getByTestId('message-form-error');
  await expect(warning).toContainText('المحاولة محفوظة، لكن تعذر مسح طلب الإعادة');
  const request = { ...api.creations[0] };
  const originalDeadline = api.purchase!.cooldownEndsAt;
  const stored = () => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY);
  expect(JSON.parse((await stored())!)).toEqual(request);
  await expect(page.getByTestId('message-form-success')).toHaveCount(0);
  await expect(page.getByTestId('input-merchant-name')).toBeDisabled();
  await expect(page.getByTestId('input-purchase-amount')).toBeDisabled();
  await expect(page.getByTestId('button-submit-simulation')).toHaveText('إعادة إرسال المحاولة نفسها');

  // An explicit reset must not discard the in-memory identity if removal fails.
  await page.getByTestId('button-new-simulation').click();
  await expect(warning).toContainText('تعذر مسح الطلب السابق');
  expect(api.creations).toEqual([request]);
  expect(JSON.parse((await stored())!)).toEqual(request);
  await page.getByTestId('button-submit-simulation').click();
  await expect(warning).toContainText('المحاولة محفوظة، لكن تعذر مسح طلب الإعادة');
  expect(api.creations).toEqual([request, request]);
  expect(api.creationCount).toBe(1);
  expect(api.purchase!.cooldownEndsAt).toBe(originalDeadline);

  await advance(page, api, 20_000);
  await page.reload();
  await expect(page.getByTestId('input-merchant-name')).toHaveValue(request.merchantName);
  await expect(page.getByTestId('input-purchase-amount')).toHaveValue(String(request.amount));
  await expect(page.getByTestId('input-merchant-name')).toBeDisabled();
  expect(api.creations).toEqual([request, request]); // Restore alone sends no POST.
  expect(JSON.parse((await stored())!)).toEqual(request);
  await allowPurchaseStorage(page);
  await page.getByTestId('button-submit-simulation').click();
  await expect(page.getByTestId('message-form-success')).toBeVisible();
  await expect(warning).toHaveCount(0);
  expect(api.creations).toEqual([request, request, request]);
  expect(api.creationCount).toBe(1);
  expect(api.purchasesByKey.size).toBe(1);
  expect(api.purchase!.cooldownEndsAt).toBe(originalDeadline);
  await expect(page.getByTestId(`row-simulation-${ID}`)).toHaveCount(1);
  await expect(page.getByTestId(`cooldown-${ID}`)).toHaveCount(1);
  expect(await stored()).toBeNull();
  await expect(page.getByTestId('input-merchant-name')).toBeEnabled();
  await expect(page.getByTestId('input-merchant-name')).toHaveValue('');
  await expect(page.getByTestId('input-purchase-amount')).toHaveValue('');
});
