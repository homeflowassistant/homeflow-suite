export interface PaymentMethodProfile {
  cardBrand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  billingEmail: string;
  billingAddressLine1: string;
  billingAddressLine2: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  billingCountry: string;
  taxId: string;
  taxLabel: string;
  taxStatus: string;
}

const getStorageKey = (locationId: string) => `account-payment-profile:${locationId}`;

export function loadPaymentProfile(locationId: string): PaymentMethodProfile | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(getStorageKey(locationId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as PaymentMethodProfile;
  } catch {
    return null;
  }
}

export function savePaymentProfile(locationId: string, profile: PaymentMethodProfile): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getStorageKey(locationId), JSON.stringify(profile));
}

export function clearPaymentProfile(locationId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(getStorageKey(locationId));
}

export function inferCardBrand(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.startsWith('4')) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (digits.startsWith('34') || digits.startsWith('37')) return 'amex';
  if (digits.startsWith('6')) return 'discover';
  return 'card';
}
