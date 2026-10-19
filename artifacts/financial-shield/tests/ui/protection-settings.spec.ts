import {
  test, expect, INITIAL, EDITED, EXTERNAL,
  panel, saveButton, expectValues, editValues, openSettings,
} from './protection-settings-fixture';

for (const failure of ['server', 'network'] as const) {
  test(`${failure} load failure shows no editable defaults and retry loads saved settings`, async ({ page, api }) => {
    api.readFailure = failure;
    let release!: () => void;
    api.holdRead = new Promise<void>((resolve) => { release = resolve; });
    await page.goto('/');
    await expect(panel(page).getByRole('status')).toContainText('جارٍ تحميل');
    await expect(panel(page).locator('form')).toHaveCount(0);
    release();
    // Exercise the real query retry policy rather than replacing the query client.
    await expect(panel(page).getByRole('alert')).toContainText('تعذّر تحميل إعدادات الحماية', { timeout: 15_000 });
    await expect(panel(page).getByRole('switch')).toHaveCount(0);
    await expect(saveButton(page)).toHaveCount(0);
    await expect(panel(page).getByTestId('message-settings-success')).toHaveCount(0);
    expect(api.writes).toEqual([]);
    const reads = api.reads;
    api.readFailure = null;
    await panel(page).getByRole('button', { name: 'إعادة تحميل الإعدادات' }).click();
    await expectValues(page, INITIAL);
    await expect(saveButton(page)).toBeDisabled();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    expect(api.reads).toBeGreaterThan(reads);
    expect(api.writes).toEqual([]);
  });

  test(`${failure} save failure retains the draft, never claims success, and retries the same values`, async ({ page, api }) => {
    api.writeFailure = failure;
    await openSettings(page);
    await editValues(page);
    await saveButton(page).click();
    await expect(panel(page).getByTestId('message-settings-error')).toContainText('تعذّر تأكيد حفظ الإعدادات');
    await expect(panel(page).getByTestId('message-settings-success')).toHaveCount(0);
    await expect(panel(page)).toContainText('لم تُحفظ التعديلات بعد');
    await expectValues(page, EDITED);
    await expect(saveButton(page)).toBeEnabled();
    expect(api.settings).toEqual(INITIAL);
    expect(api.writes).toEqual([EDITED]);
    // Dashboard cache must not falsely adopt the unsaved shield state.
    await expect(page.getByTestId('status-protection')).toContainText('الدرع مفعّل');

    api.writeFailure = null;
    await saveButton(page).click();
    await expect(panel(page).getByTestId('message-settings-success')).toBeVisible();
    await expect(panel(page).getByTestId('message-settings-error')).toHaveCount(0);
    await expect(panel(page)).not.toContainText('لم تُحفظ التعديلات بعد');
    await expectValues(page, EDITED);
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByTestId('status-protection')).toContainText('الدرع غير مفعّل');
    expect(api.writes).toEqual([EDITED, EDITED]);
    expect(api.settings).toEqual(EDITED);
    await page.reload();
    await expectValues(page, EDITED);
    await expect(saveButton(page)).toBeDisabled();
    await expect(panel(page).getByTestId('message-settings-success')).toHaveCount(0);
  });
}

test('in-flight saving disables all controls and does not announce success before confirmation', async ({ page, api }) => {
  await openSettings(page);
  await editValues(page);
  let release!: () => void;
  api.holdWrite = new Promise<void>((resolve) => { release = resolve; });
  try {
    await saveButton(page).click();
    await expect.poll(() => api.writes.length).toBe(1);
    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveText('جارٍ الحفظ...');
    for (const control of [
      panel(page).getByRole('switch'),
      panel(page).getByTestId('select-block-start'),
      panel(page).getByTestId('select-block-end'),
      panel(page).getByTestId('input-cooldown-minutes'),
      panel(page).getByRole('button', { name: 'إلغاء التعديلات' }),
    ]) {
      await expect(control).toBeDisabled();
    }
    // Real pointer clicks on a disabled button must not send duplicate writes.
    await saveButton(page).click({ force: true });
    await expect(panel(page).getByTestId('message-settings-success')).toHaveCount(0);
    await expect(panel(page)).toContainText('لم تُحفظ التعديلات بعد');
    expect(api.writes).toEqual([EDITED]);
    expect(api.settings).toEqual(INITIAL);
  } finally {
    release();
  }
  await expect(panel(page).getByTestId('message-settings-success')).toBeVisible();
  await expectValues(page, EDITED);
  await expect(panel(page).getByRole('switch')).toBeEnabled();
  await expect(saveButton(page)).toBeDisabled();
  expect(api.writes).toEqual([EDITED]);
});

test('periodic refresh updates a clean form but preserves every field of a local draft', async ({ page, api }) => {
  await page.clock.install();
  await openSettings(page);
  api.settings = { ...EXTERNAL };
  let reads = api.reads;
  await page.clock.fastForward(30_100);
  await expect.poll(() => api.reads).toBeGreaterThan(reads);
  await expectValues(page, EXTERNAL);
  await expect(saveButton(page)).toBeDisabled();
  await editValues(page);
  api.settings = { ...INITIAL };
  reads = api.reads;
  await page.clock.fastForward(30_100);
  await expect.poll(() => api.reads).toBeGreaterThan(reads);
  await expectValues(page, EDITED);
  await expect(panel(page)).toContainText('لم تُحفظ التعديلات بعد');
  await expect(saveButton(page)).toBeEnabled();
  await expect(panel(page).getByTestId('message-settings-success')).toHaveCount(0);
  expect(api.writes).toEqual([]);
  // Cancelling proves the refreshed server values reached the real query cache.
  await panel(page).getByRole('button', { name: 'إلغاء التعديلات' }).click();
  await expectValues(page, INITIAL);
  await expect(saveButton(page)).toBeDisabled();
});

test('another window saving settings cannot overwrite the first window draft on polling', async ({ page, context, api }) => {
  // Clock is shared across pages: install it only once.
  await page.clock.install();
  await openSettings(page);
  await editValues(page);
  const second = await context.newPage();
  await openSettings(second);
  await editValues(second, EXTERNAL);
  await saveButton(second).click();
  await expect(panel(second).getByTestId('message-settings-success')).toBeVisible();
  expect(api.settings).toEqual(EXTERNAL);
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith('/api/protection-settings') && response.request().method() === 'GET');
  await page.clock.fastForward(30_100);
  await refreshed;
  await expectValues(page, EDITED);
  await expect(panel(page)).toContainText('لم تُحفظ التعديلات بعد');
  await expect(panel(page).getByTestId('message-settings-success')).toHaveCount(0);
  await saveButton(page).click();
  await expect(panel(page).getByTestId('message-settings-success')).toBeVisible();
  expect(api.writes).toEqual([EXTERNAL, EDITED]);
  expect(api.settings).toEqual(EDITED);
});
