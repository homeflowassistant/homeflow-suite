import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, CreditCard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getBackendUrl } from '@/lib/backend';
import { Card, SkeletonCard, ErrorState } from '@/components/account/AccountSharedUI';
import { formatCurrency, intervalToLabel, capitalizeCardBrand } from '@/lib/accountManagement.utils';
import {
  inferCardBrand,
  loadPaymentProfile,
  savePaymentProfile,
  type PaymentMethodProfile,
} from '@/lib/paymentProfile';

interface Plan {
  id: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  interval: string;
  trialDays: number;
  isActive: boolean;
  stripePriceId: string;
}

interface SaaSPlanData {
  planId: string;
  amount: number;
  interval: string;
  customerId: string;
  subscriptionId: string;
  status: string;
  planName: string;
  paymentMethod?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    name: string;
  };
}

interface UpdatePaymentTabProps {
  locationId: string;
}

interface PaymentFormState {
  cardholderName: string;
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvc: string;
  country: string;
  billingEmail: string;
  billingAddressLine1: string;
  billingAddressLine2: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
}

const EMPTY_FORM: PaymentFormState = {
  cardholderName: '',
  cardNumber: '',
  expMonth: '',
  expYear: '',
  cvc: '',
  country: 'US',
  billingEmail: '',
  billingAddressLine1: '',
  billingAddressLine2: '',
  billingCity: '',
  billingState: '',
  billingPostalCode: '',
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function PaymentDrawer({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (profile: PaymentMethodProfile) => void;
}) {
  const [form, setForm] = useState<PaymentFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
  }, [open]);

  const handleSubmit = async () => {
    const digits = form.cardNumber.replace(/\D/g, '');

    if (digits.length < 12) {
      toast.error('Enter a valid card number');
      return;
    }

    if (!form.cardholderName.trim()) {
      toast.error('Cardholder name is required');
      return;
    }

    if (!form.expMonth || !form.expYear) {
      toast.error('Expiration date is required');
      return;
    }

    try {
      setSaving(true);
      const profile: PaymentMethodProfile = {
        cardBrand: inferCardBrand(digits),
        last4: digits.slice(-4),
        expMonth: Number(form.expMonth),
        expYear: Number(form.expYear),
        cardholderName: form.cardholderName.trim(),
        billingEmail: form.billingEmail.trim(),
        billingAddressLine1: form.billingAddressLine1.trim(),
        billingAddressLine2: form.billingAddressLine2.trim(),
        billingCity: form.billingCity.trim(),
        billingState: form.billingState.trim(),
        billingPostalCode: form.billingPostalCode.trim(),
        billingCountry: form.country.trim() || 'US',
        taxId: '',
        taxLabel: 'Tax ID',
        taxStatus: 'Not provided',
      };

      onSave(profile);
      toast.success('Payment method updated');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Add New Payment Method</h3>
            <p className="text-sm text-gray-500 mt-1">Provide the details below</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-700 text-sm font-medium">
            Secure, fast checkout with Link
          </div>

          <Field
            label="Cardholder Name"
            value={form.cardholderName}
            onChange={(value) => setForm((prev) => ({ ...prev, cardholderName: value }))}
            placeholder="Name on card"
          />
          <Field
            label="Card Number"
            value={form.cardNumber}
            onChange={(value) => setForm((prev) => ({ ...prev, cardNumber: value }))}
            placeholder="1234 1234 1234 1234"
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Expiration Date"
              value={form.expMonth}
              onChange={(value) => setForm((prev) => ({ ...prev, expMonth: value }))}
              placeholder="MM"
            />
            <Field
              label="Security Code"
              value={form.cvc}
              onChange={(value) => setForm((prev) => ({ ...prev, cvc: value }))}
              placeholder="CVC"
            />
          </div>

          <Field
            label="Country"
            value={form.country}
            onChange={(value) => setForm((prev) => ({ ...prev, country: value }))}
            placeholder="US"
          />
          <Field
            label="Billing Email"
            value={form.billingEmail}
            onChange={(value) => setForm((prev) => ({ ...prev, billingEmail: value }))}
            placeholder="billing@company.com"
            type="email"
          />
          <Field
            label="Address"
            value={form.billingAddressLine1}
            onChange={(value) => setForm((prev) => ({ ...prev, billingAddressLine1: value }))}
            placeholder="Street address"
          />
          <Field
            label="Address Line 2"
            value={form.billingAddressLine2}
            onChange={(value) => setForm((prev) => ({ ...prev, billingAddressLine2: value }))}
            placeholder="Suite, unit, etc."
          />
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="City"
              value={form.billingCity}
              onChange={(value) => setForm((prev) => ({ ...prev, billingCity: value }))}
              placeholder="City"
            />
            <Field
              label="State"
              value={form.billingState}
              onChange={(value) => setForm((prev) => ({ ...prev, billingState: value }))}
              placeholder="State"
            />
            <Field
              label="Postal Code"
              value={form.billingPostalCode}
              onChange={(value) => setForm((prev) => ({ ...prev, billingPostalCode: value }))}
              placeholder="ZIP"
            />
          </div>
        </div>

        <div className="border-t border-gray-200 px-6 py-4 flex gap-3 justify-end">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export function UpdatePaymentTab({ locationId }: UpdatePaymentTabProps) {
  const [currentPlan, setCurrentPlan] = useState<SaaSPlanData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [billingCycle, setBillingCycle] = useState<'month' | 'year'>('month');
  const [isPaused, setIsPaused] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [updatingPlan, setUpdatingPlan] = useState(false);
  const [pausingAccount, setPausingAccount] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [storedProfile, setStoredProfile] = useState<PaymentMethodProfile | null>(null);

  const fetchCurrentPlan = async () => {
    try {
      setLoadingPlan(true);
      const response = await fetch(getBackendUrl(`/api/saas/plan?locationId=${encodeURIComponent(locationId)}`));

      if (!response.ok) {
        throw new Error('Failed to fetch current plan');
      }

      const data = await response.json();
      setCurrentPlan(data);
      setSelectedPlanId(data.planId);
      setBillingCycle(data.interval === 'month' ? 'month' : 'year');
      setIsPaused(data.status === 'paused');
    } catch (err) {
      console.error('Error fetching current plan:', err);
      toast.error('Failed to load current plan');
    } finally {
      setLoadingPlan(false);
    }
  };

  const fetchPlans = async () => {
    try {
      setLoadingPlans(true);
      const response = await fetch(getBackendUrl('/api/saas/plans'));

      if (!response.ok) {
        throw new Error('Failed to fetch plans');
      }

      const data = await response.json();
      setPlans(data.plans || []);
    } catch (err) {
      console.error('Error fetching plans:', err);
      toast.error('Failed to load available plans');
    } finally {
      setLoadingPlans(false);
    }
  };

  useEffect(() => {
    fetchCurrentPlan();
    fetchPlans();
    setStoredProfile(loadPaymentProfile(locationId));
  }, [locationId]);

  const connectedPaymentMethod = useMemo(
    () => currentPlan?.paymentMethod || storedProfile,
    [currentPlan, storedProfile]
  );
  const hasPaymentMethod = Boolean(connectedPaymentMethod?.last4);

  const handleSaveProfile = (profile: PaymentMethodProfile) => {
    savePaymentProfile(locationId, profile);
    setStoredProfile(profile);
  };

  const handleUpdatePlan = async () => {
    try {
      setUpdatingPlan(true);

      const response = await fetch(getBackendUrl('/api/saas/update-subscription'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          planId: selectedPlanId,
          customerId: currentPlan?.customerId,
          subscriptionId: currentPlan?.subscriptionId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update subscription');
      }

      const data = await response.json();
      toast.success(`Subscription updated to ${data.planName || selectedPlanId}`);
      await fetchCurrentPlan();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setUpdatingPlan(false);
    }
  };

  const handlePauseAccount = async () => {
    try {
      setPausingAccount(true);

      const response = await fetch(getBackendUrl('/api/saas/pause'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          pause: !isPaused,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${!isPaused ? 'pause' : 'resume'} account`);
      }

      toast.success(`Account ${!isPaused ? 'paused' : 'resumed'} successfully`);
      setIsPaused(!isPaused);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setPausingAccount(false);
    }
  };

  if (loadingPlan || loadingPlans) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!currentPlan) {
    return <ErrorState title="Error" message="Failed to load plan information." onRetry={fetchCurrentPlan} />;
  }

  const paymentMethod = connectedPaymentMethod as NonNullable<typeof connectedPaymentMethod> | undefined;
  const brand = paymentMethod ? ('brand' in paymentMethod ? paymentMethod.brand : paymentMethod.cardBrand) : '';
  const last4 = paymentMethod ? paymentMethod.last4 : '';
  const expMonth = paymentMethod ? paymentMethod.expMonth : 0;
  const expYear = paymentMethod ? paymentMethod.expYear : 0;
  const holderName = paymentMethod ? ('name' in paymentMethod ? paymentMethod.name : paymentMethod.cardholderName) : '';

  return (
    <div className="space-y-6">
      <Card title="Current Payment Method" description="Manage the card connected to this location">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Connected Card</p>
                <h3 className="text-lg font-semibold text-gray-900 mt-1">
                  {hasPaymentMethod ? capitalizeCardBrand(brand) : 'No card connected'}
                </h3>
              </div>
              <div className="rounded-full bg-blue-50 p-2 text-blue-600">
                <CreditCard className="h-5 w-5" />
              </div>
            </div>

            {hasPaymentMethod ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Card Number</p>
                  <p className="text-sm font-semibold text-gray-900">•••• {last4}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Expiry Date</p>
                  <p className="text-sm font-semibold text-gray-900">{String(expMonth).padStart(2, '0')}/{expYear}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Cardholder Name</p>
                  <p className="text-sm font-semibold text-gray-900">{holderName || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Status</p>
                  <p className="text-sm font-semibold text-emerald-700">Active</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
                <p className="text-sm text-gray-600">No payment method is connected to this sub-account yet.</p>
                <div className="mt-4">
                  <Button onClick={() => setDrawerOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Add New Card
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Billing Information</p>
                <h3 className="text-lg font-semibold text-gray-900 mt-1">Billing profile</h3>
              </div>
              <div className="rounded-full bg-emerald-50 p-2 text-emerald-600">
                <RefreshCw className="h-5 w-5" />
              </div>
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Plan</p>
                <p className="font-semibold text-gray-900">{currentPlan.planName}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Billing Cycle</p>
                <p className="font-semibold text-gray-900">{intervalToLabel(currentPlan.interval)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Next Billing Date</p>
                <p className="font-semibold text-gray-900">{currentPlan.status === 'paused' ? 'Paused' : 'Active billing'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Amount</p>
                <p className="font-semibold text-gray-900">{formatCurrency(currentPlan.amount, currentPlan.currency)}/{currentPlan.interval === 'month' ? 'mo' : 'yr'}</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Update Subscription" description="Choose a plan and keep billing connected">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-3">Select New Plan</label>
            <div className="space-y-2">
              {plans.map((plan) => (
                <label
                  key={plan.id}
                  className="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors"
                  style={{
                    borderColor: selectedPlanId === plan.id ? '#0d6efd' : '#e5e7eb',
                    backgroundColor: selectedPlanId === plan.id ? '#f0f7ff' : '#ffffff',
                  }}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={plan.id}
                    checked={selectedPlanId === plan.id}
                    onChange={() => setSelectedPlanId(plan.id)}
                    className="w-4 h-4"
                  />
                  <div className="ml-3 flex-1">
                    <p className="font-medium text-gray-900">{plan.name}</p>
                    <p className="text-sm text-gray-600">{plan.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{formatCurrency(plan.amount, plan.currency)}</p>
                    <p className="text-xs text-gray-500">/{plan.interval}</p>
                  </div>
                  {plan.id === currentPlan.planId && (
                    <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded font-medium">
                      Current
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDrawerOpen(true)} variant="outline" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add New Card
            </Button>
            <Button
              onClick={handleUpdatePlan}
              disabled={updatingPlan || !selectedPlanId}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updatingPlan ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Update Subscription
            </Button>
            <Button
              onClick={handlePauseAccount}
              disabled={pausingAccount}
              variant={isPaused ? 'outline' : 'default'}
              className={isPaused ? '' : 'bg-yellow-600 hover:bg-yellow-700'}
            >
              {pausingAccount ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isPaused ? 'Resume Account' : 'Pause Account'}
            </Button>
          </div>
        </div>
      </Card>

      <PaymentDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSave={handleSaveProfile} />
    </div>
  );
}
