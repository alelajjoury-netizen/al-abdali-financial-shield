// Keep Arabic month/day names and text, but always use Western digits.
export const DISPLAY_LOCALE = 'ar-KW-u-nu-latn';

export const formatAmount = (amount: number) =>
  new Intl.NumberFormat(DISPLAY_LOCALE, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amount);
