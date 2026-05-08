import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { getBackendUrl } from '@/lib/backend';
import { useGhlApi } from '@/hooks/useGhlApi';
import { Card, SkeletonCard, ErrorState } from '@/components/account/AccountSharedUI';
import { formatCurrency, intervalToLabel } from '@/lib/accountManagement.utils';

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
}

interface UpdatePaymentTabProps {
  locationId: string;
}

export function UpdatePaymentTab({ locationId }: UpdatePaymentTabProps) {
  const [currentPlan, setCurrentPlan] = useState<SaaSPlanData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [billingCycle, setBillingCycle] = useState<'month' | 'year'>('month');
  const [isPaused, setIsPaused] = useState(false);

  const [stripeCustomerId, setStripeCustomerId] = useState('');
  const [stripeSubscriptionId, setStripeSubscriptionId] = useState('');

  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [updatingStripe, setUpdatingStripe] = useState(false);
  const [updatingPlan, setUpdatingPlan] = useState(false);
  const [pausingAccount, setPausingAccount] = useState(false);

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
      setStripeCustomerId(data.customerId);
      setStripeSubscriptionId(data.subscriptionId);
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
  }, [locationId]);

  const handleUpdateStripe = async () => {
    try {
      setUpdatingStripe(true);

      const response = await fetch(getBackendUrl('/api/saas/update-subscription'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          customerId: stripeCustomerId,
          subscriptionId: stripeSubscriptionId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update Stripe details');
      }

      toast.success('Stripe details updated successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setUpdatingStripe(false);
    }
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
          customerId: stripeCustomerId,
          subscriptionId: stripeSubscriptionId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update subscription');
      }

      const data = await response.json();
      toast.success(`Subscription updated to ${data.planName || selectedPlanId}`);

      // Refresh plan data
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

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const isCurrentPlan = selectedPlanId === currentPlan.planId;

  return (
    <div className="space-y-6">
      {/* Update Stripe Details Section */}
      <Card title="Update Stripe Details" description="Update your Stripe customer and subscription IDs">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Stripe Customer ID</label>
            <input
              type="text"
              value={stripeCustomerId}
              onChange={(e) => setStripeCustomerId(e.target.value)}
              placeholder="cus_xxxxxxxxxx"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Stripe Subscription ID</label>
            <input
              type="text"
              value={stripeSubscriptionId}
              onChange={(e) => setStripeSubscriptionId(e.target.value)}
              placeholder="sub_xxxxxxxxxx"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button
            onClick={handleUpdateStripe}
            disabled={updatingStripe}
            className="bg-blue-600 hover:bg-blue-700 w-full"
          >
            {updatingStripe ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save Stripe Details'
            )}
          </Button>
        </div>
      </Card>

      {/* Change Plan Section */}
      <Card title="Change Plan" description="Select a new plan and billing cycle">
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
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(plan.amount, plan.currency)}
                    </p>
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

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-3">Billing Cycle</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="cycle"
                  value="month"
                  checked={billingCycle === 'month'}
                  onChange={() => setBillingCycle('month')}
                  className="w-4 h-4"
                />
                <span className="ml-2 text-sm text-gray-900">Monthly</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="cycle"
                  value="year"
                  checked={billingCycle === 'year'}
                  onChange={() => setBillingCycle('year')}
                  className="w-4 h-4"
                />
                <span className="ml-2 text-sm text-gray-900">Annual (Save 20%)</span>
              </label>
            </div>
          </div>

          <Button
            onClick={handleUpdatePlan}
            disabled={updatingPlan || isCurrentPlan}
            className="bg-blue-600 hover:bg-blue-700 w-full"
          >
            {updatingPlan ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Updating...
              </>
            ) : (
              'Update Subscription'
            )}
          </Button>
          {isCurrentPlan && (
            <p className="text-sm text-gray-500 text-center">This is your current plan</p>
          )}
        </div>
      </Card>

      {/* Pause Account Section */}
      <Card title="Account Pause" description="Temporarily suspend this account's SaaS subscription">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">
              {isPaused
                ? 'Account is currently paused. Billing is suspended.'
                : 'Pause your account to suspend billing temporarily.'}
            </p>
          </div>
          <Button
            onClick={handlePauseAccount}
            disabled={pausingAccount}
            variant={isPaused ? 'outline' : 'default'}
            className={isPaused ? '' : 'bg-yellow-600 hover:bg-yellow-700'}
          >
            {pausingAccount ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {isPaused ? 'Resuming...' : 'Pausing...'}
              </>
            ) : (
              isPaused ? 'Resume Account' : 'Pause Account'
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
