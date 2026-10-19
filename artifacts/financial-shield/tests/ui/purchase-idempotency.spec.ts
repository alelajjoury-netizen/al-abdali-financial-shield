import { test, expect, ID, openHome, advance } from './purchase-fixture';

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
