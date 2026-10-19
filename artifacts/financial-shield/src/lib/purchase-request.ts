import { z } from 'zod';
import type { PurchaseSimulationInput } from '@workspace/api-client-react';

// Per-tab storage avoids conflating separate deliberate attempts in two windows.
const STORAGE_KEY = 'financial-shield-pending-purchase';
const storedRequest = z.object({
  idempotencyKey: z.string().uuid(),
  merchantName: z.string().trim().min(1).max(80),
  amount: z.number().positive().max(10000),
  currency: z.literal('KWD'),
  timeZone: z.string().min(1).max(100),
}).strict();

export function restorePurchaseRequest(): { request: PurchaseSimulationInput | null; error: string } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return { request: raw ? storedRequest.parse(JSON.parse(raw)) : null, error: '' };
  } catch {
    return {
      request: null,
      error: 'تعذر استعادة الطلب السابق. لا تبدئي محاولة أخرى إلا بعد التحقق من السجل؛ قد تكون المحاولة السابقة محفوظة.',
    };
  }
}

export function savePurchaseRequest(request: PurchaseSimulationInput) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
}

export function clearPurchaseRequest() {
  sessionStorage.removeItem(STORAGE_KEY);
}
