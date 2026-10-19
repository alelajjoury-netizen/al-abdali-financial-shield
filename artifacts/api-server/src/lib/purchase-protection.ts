/** Daily interval uses device timezone, but never a client-supplied timestamp. */
export function isBlockedAt(
  settings: { enabled: boolean; blockStartHour: number; blockEndHour: number },
  timeZone: string,
  now: Date,
): boolean {
  // Validate the timezone even when protection is disabled.
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", hourCycle: "h23",
  }).format(now));
  if (!settings.enabled) return false;
  const { blockStartHour: start, blockEndHour: end } = settings;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
