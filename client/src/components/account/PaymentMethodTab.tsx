import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CreditCard, PlusCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getBackendUrl } from '@/lib/backend';
import {
  Card,
  Badge,
  SkeletonCard,
  SkeletonTable,
  ErrorState,
  PageLoadingSpinner,
  WarningBanner,
} from '@/components/account/AccountSharedUI';
import {
  formatCurrency,
  formatDate,
  capitalizeCardBrand,
  maskCardNumber,
  intervalToLabel,
} from '@/lib/accountManagement.utils';
import { loadPaymentProfile, type PaymentMethodProfile } from '@/lib/paymentProfile';

interface SaaSPlanData {
  id: string;
  name: string;
  planId: string;
  planName: string;
  status: string;
  trialEndDate: string | null;
  subscriptionId: string;
  customerId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  amount: number;
  currency: string;
  interval: string;
  paymentMethod?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    name: string;
  };
  taxInformation?: {
    taxLabel?: string;
    taxId?: string;
    taxStatus?: string;
  };
  billingInformation?: {
    name?: string;
    email?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

interface Transaction {
  _id: string;
  altId: string;
  altType: string;
  contactId: string;
  currency: string;
  amount: number;
  status: string;
  entitySourceName: string;
  subscriptionId: string;
  invoiceId: string;
  createdAt: string;
}

interface PaymentMethodTabProps {
  locationId: string;
  onAddPaymentMethod?: () => void;
}

function PaymentInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function EmptyPaymentState({ onAddPaymentMethod }: { onAddPaymentMethod?: () => void }) {
  return (
    <div className="min-h-[72vh] flex items-center justify-center px-4 py-8">
      <div className="max-w-2xl w-full text-center">
        <div className="mx-auto mb-6 flex h-36 w-36 items-center justify-center rounded-full bg-gray-50 border border-gray-200">
          <div className="relative">
            <CreditCard className="h-14 w-14 text-gray-300" />
            <PlusCircle className="absolute -right-2 -bottom-2 h-6 w-6 text-blue-600 bg-white rounded-full" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Method Not Added</h2>
        <p className="text-sm text-gray-600 max-w-xl mx-auto">
          A payment method is required to manage subscriptions, tax settings, billing information, and transaction history for this account.
        </p>

        <div className="mt-8 flex justify-center">
          <Button onClick={onAddPaymentMethod} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 h-12">
            <CreditCard className="mr-2 h-4 w-4" />
            Add Payment Method
          </Button>
        </div>

        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5 text-left">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="font-semibold text-amber-800">Do not add your own card to sub-accounts!</p>
                <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-700">
                  Only Visible to You
                </span>
              </div>
              <p className="text-sm leading-6 text-amber-800/90">
                Add the sub-account's card details only. The card will be used to bill that client and the funds will be deposited in your connected account.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PaymentMethodTab({ locationId, onAddPaymentMethod }: PaymentMethodTabProps) {
  const [planData, setPlanData] = useState<SaaSPlanData | null>(null);
  const [storedProfile, setStoredProfile] = useState<PaymentMethodProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [historyView, setHistoryView] = useState<'invoices' | 'charges'>('invoices');
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [errorPlan, setErrorPlan] = useState<string | null>(null);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [errorTransactions, setErrorTransactions] = useState<string | null>(null);

  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    setStoredProfile(loadPaymentProfile(locationId));
  }, [locationId]);

  const fetchPlanData = async () => {
    try {
      setLoadingPlan(true);
      setErrorPlan(null);
      const response = await fetch(getBackendUrl(`/api/saas/plan?locationId=${encodeURIComponent(locationId)}`));

      if (!response.ok) {
        if (response.status === 404) {
          setPlanData(null);
          setErrorPlan('');
          return;
        }
        throw new Error('Failed to fetch plan data');
      }

      const data = await response.json();
      setPlanData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setErrorPlan(message);
      console.error('Plan fetch error:', message);
    } finally {
      setLoadingPlan(false);
    }
  };

  const fetchTransactions = async (page: number) => {
    try {
      setLoadingTransactions(true);
      setErrorTransactions(null);

      const offset = (page - 1) * ITEMS_PER_PAGE;
      const response = await fetch(
        getBackendUrl(`/api/account/transactions?locationId=${encodeURIComponent(locationId)}&limit=${ITEMS_PER_PAGE}&offset=${offset}`)
      );

      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }

      const result = await response.json();
      const transactionList = result.data ?? result.transactions ?? [];
      setTransactions(transactionList);
      setTotalTransactions(result.totalCount || result.total || transactionList.length || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch transactions';
      setErrorTransactions(message);
      console.error('Transactions fetch error:', message);
    } finally {
      setLoadingTransactions(false);
    }
  };

  useEffect(() => {
    fetchPlanData();
    fetchTransactions(1);
  }, [locationId]);

  const connectedPaymentMethod = planData?.paymentMethod ?? storedProfile;
  const hasPaymentMethod = Boolean(connectedPaymentMethod?.last4);
  const totalPages = Math.max(1, Math.ceil(totalTransactions / ITEMS_PER_PAGE));
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const invoiceTransactions = useMemo(() => transactions.filter((tx) => !!tx.invoiceId), [transactions]);
  const chargeTransactions = useMemo(
    () => transactions.filter((tx) => !tx.invoiceId || tx.altType?.toLowerCase?.().includes('charge')),
    [transactions]
  );
  const visibleTransactions = historyView === 'invoices' ? invoiceTransactions : chargeTransactions;

  const handlePreviousPage = () => {
    if (canGoPrevious) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      fetchTransactions(newPage);
    }
  };

  const handleNextPage = () => {
    if (canGoNext) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      fetchTransactions(newPage);
    }
  };

  if (loadingPlan) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonTable rows={5} />
      </div>
    );
  }

  if (errorPlan) {
    return <ErrorState title="Error Loading Plan" message={errorPlan} onRetry={fetchPlanData} />;
  }

  if (!hasPaymentMethod) {
    return <EmptyPaymentState onAddPaymentMethod={onAddPaymentMethod} />;
  }

  const paymentMethod = connectedPaymentMethod as NonNullable<typeof connectedPaymentMethod>;
  const cardBrand = 'brand' in paymentMethod ? paymentMethod.brand : paymentMethod.cardBrand;
  const cardLast4 = 'last4' in paymentMethod ? paymentMethod.last4 : paymentMethod.last4;
  const cardExpMonth = 'expMonth' in paymentMethod ? paymentMethod.expMonth : paymentMethod.expMonth;
  const cardExpYear = 'expYear' in paymentMethod ? paymentMethod.expYear : paymentMethod.expYear;
  const cardholderName = 'name' in paymentMethod ? paymentMethod.name : paymentMethod.cardholderName;
  const billingName = planData?.billingInformation?.name || cardholderName || 'N/A';
  const billingEmail = planData?.billingInformation?.email || (storedProfile?.billingEmail ?? 'N/A');
  const billingAddress = [
    planData?.billingInformation?.addressLine1 || storedProfile?.billingAddressLine1,
    planData?.billingInformation?.addressLine2 || storedProfile?.billingAddressLine2,
    [planData?.billingInformation?.city || storedProfile?.billingCity, planData?.billingInformation?.state || storedProfile?.billingState].filter(Boolean).join(', '),
    [planData?.billingInformation?.postalCode || storedProfile?.billingPostalCode, planData?.billingInformation?.country || storedProfile?.billingCountry].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' • ');
  const taxLabel = planData?.taxInformation?.taxLabel || storedProfile?.taxLabel || 'Tax ID';
  const taxId = planData?.taxInformation?.taxId || storedProfile?.taxId || 'Not available';
  const taxStatus = planData?.taxInformation?.taxStatus || storedProfile?.taxStatus || 'Not provided';

  return (
    <div className="space-y-6">
      <Card title="Payment Method">
        {planData?.cancelAtPeriodEnd && (
          <WarningBanner message="This subscription will be cancelled at the end of the current billing period." />
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Current Card</p>
                <h3 className="text-lg font-semibold text-gray-900 mt-1">{capitalizeCardBrand(cardBrand)}</h3>
              </div>
              <div className="rounded-full bg-blue-50 p-2 text-blue-600">
                <CreditCard className="h-5 w-5" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <PaymentInfoRow label="Card Number" value={maskCardNumber(cardLast4)} />
              <PaymentInfoRow
                label="Expiry Date"
                value={`${String(cardExpMonth).padStart(2, '0')}/${cardExpYear}`}
              />
              <PaymentInfoRow label="Cardholder Name" value={cardholderName || 'N/A'} />
              <PaymentInfoRow label="Plan Status" value={planData?.status || 'Unknown'} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Tax Information</p>
                <h3 className="text-lg font-semibold text-gray-900 mt-1">Billing identity</h3>
              </div>
              <div className="rounded-full bg-amber-50 p-2 text-amber-600">
                <ShieldAlert className="h-5 w-5" />
              </div>
            </div>
            <div className="space-y-4">
              <PaymentInfoRow label={taxLabel} value={taxId} />
              <PaymentInfoRow label="Status" value={taxStatus} />
              <PaymentInfoRow label="Billing Email" value={billingEmail} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Billing Information</p>
                <h3 className="text-lg font-semibold text-gray-900 mt-1">Business profile</h3>
              </div>
              <div className="rounded-full bg-emerald-50 p-2 text-emerald-600">
                <RefreshCw className="h-5 w-5" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <PaymentInfoRow label="Name" value={billingName} />
              <PaymentInfoRow label="Email" value={billingEmail} />
              <PaymentInfoRow label="Address" value={billingAddress || 'Not available'} />
              <PaymentInfoRow label="Country" value={planData?.billingInformation?.country || storedProfile?.billingCountry || 'N/A'} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Payments History" description="Keep track of your payments">
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4 mb-4">
          <div className="inline-flex rounded-lg border border-gray-300 bg-white overflow-hidden">
            <button
              onClick={() => setHistoryView('invoices')}
              className={`px-4 py-2 text-sm font-medium ${historyView === 'invoices' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Invoices
            </button>
            <button
              onClick={() => setHistoryView('charges')}
              className={`px-4 py-2 text-sm font-medium border-l border-gray-300 ${historyView === 'charges' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Charges
            </button>
          </div>
          <Button onClick={() => fetchTransactions(currentPage)} variant="outline" className="h-10 w-10 p-0">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {loadingTransactions && <PageLoadingSpinner />}

        {errorTransactions && (
          <ErrorState
            title="Error Loading Transactions"
            message={errorTransactions}
            onRetry={() => fetchTransactions(currentPage)}
          />
        )}

        {!loadingTransactions && !errorTransactions && visibleTransactions.length === 0 && (
          <p className="text-center text-gray-500 py-8">No {historyView} found.</p>
        )}

        {!loadingTransactions && visibleTransactions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Id</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Card Details</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visibleTransactions.map((tx) => (
                  <tr key={tx._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">{tx.altId || tx._id}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatDate(tx.createdAt)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{tx.entitySourceName || 'Payment'}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{connectedPaymentMethod ? `${capitalizeCardBrand(cardBrand)} ${cardLast4}` : '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{formatCurrency(tx.amount, tx.currency)}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={tx.status === 'succeeded' ? 'success' : tx.status === 'failed' ? 'error' : 'warning'}>
                        {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button onClick={handlePreviousPage} disabled={!canGoPrevious} variant="outline" className="flex items-center gap-2">
            <ChevronLeft size={16} />
            Previous
          </Button>
          <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
          <Button onClick={handleNextPage} disabled={!canGoNext} variant="outline" className="flex items-center gap-2">
            Next
            <ChevronRight size={16} />
          </Button>
        </div>
      </Card>
    </div>
  );
}
