import { useEffect, useState } from 'react';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
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
  statusToBadgeColor,
  intervalToLabel,
} from '@/lib/accountManagement.utils';

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
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    name: string;
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
}

export function PaymentMethodTab({ locationId }: PaymentMethodTabProps) {
  const [planData, setPlanData] = useState<SaaSPlanData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [errorPlan, setErrorPlan] = useState<string | null>(null);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [errorTransactions, setErrorTransactions] = useState<string | null>(null);

  const ITEMS_PER_PAGE = 20;

  const fetchPlanData = async () => {
    try {
      setLoadingPlan(true);
      setErrorPlan(null);
      const response = await fetch(getBackendUrl(`/api/saas/plan?locationId=${encodeURIComponent(locationId)}`));

      if (!response.ok) {
        if (response.status === 404) {
          setErrorPlan('No payment plan found for this location. Please connect a payment method.');
          setPlanData(null);
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

  const totalPages = Math.ceil(totalTransactions / ITEMS_PER_PAGE);
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

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

  if (!planData) {
    return <ErrorState title="No Plan Data" message="Unable to load plan information." onRetry={fetchPlanData} />;
  }

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <Card title="Current Plan">
        {planData.cancelAtPeriodEnd && (
          <WarningBanner message="This subscription will be cancelled at the end of the current billing period." />
        )}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Plan Name</p>
            <p className="text-sm font-semibold text-gray-900">{planData.planName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Status</p>
            <Badge variant={planData.status === 'active' ? 'success' : 'error'}>
              {planData.status.charAt(0).toUpperCase() + planData.status.slice(1)}
            </Badge>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Billing Cycle</p>
            <p className="text-sm font-semibold text-gray-900">{intervalToLabel(planData.interval)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Amount per Cycle</p>
            <p className="text-sm font-semibold text-gray-900">
              {formatCurrency(planData.amount, planData.currency)}/{planData.interval === 'month' ? 'mo' : 'yr'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Next Billing Date</p>
            <p className="text-sm font-semibold text-gray-900">{formatDate(planData.currentPeriodEnd)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Trial End Date</p>
            <p className="text-sm font-semibold text-gray-900">
              {planData.trialEndDate ? formatDate(planData.trialEndDate) : 'N/A'}
            </p>
          </div>
        </div>
      </Card>

      {/* Payment Method Card */}
      <Card title="Payment Method on File">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Card Brand</p>
            <p className="text-sm font-semibold text-gray-900">{capitalizeCardBrand(planData.paymentMethod.brand)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Card Number</p>
            <p className="text-sm font-semibold text-gray-900 font-mono">
              {maskCardNumber(planData.paymentMethod.last4)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Expiry Date</p>
            <p className="text-sm font-semibold text-gray-900">
              {String(planData.paymentMethod.expMonth).padStart(2, '0')}/{planData.paymentMethod.expYear}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Cardholder Name</p>
            <p className="text-sm font-semibold text-gray-900">{planData.paymentMethod.name}</p>
          </div>
        </div>
      </Card>

      {/* Transaction History Card */}
      <Card title="Transaction History">
        {loadingTransactions && <PageLoadingSpinner />}

        {errorTransactions && (
          <ErrorState
            title="Error Loading Transactions"
            message={errorTransactions}
            onRetry={() => fetchTransactions(currentPage)}
          />
        )}

        {!loadingTransactions && !errorTransactions && transactions.length === 0 && (
          <p className="text-center text-gray-500 py-8">No transactions found.</p>
        )}

        {!loadingTransactions && transactions.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transactions.map((tx) => (
                    <tr key={tx._id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">{formatDate(tx.createdAt)}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{tx.entitySourceName}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                        {formatCurrency(tx.amount, tx.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={tx.status === 'succeeded' ? 'success' : tx.status === 'failed' ? 'error' : 'warning'}>
                          {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {tx.invoiceId ? (
                          <a href={`#`} className="text-blue-600 hover:text-blue-700 flex items-center gap-1">
                            <Download size={16} />
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-6 flex items-center justify-between">
              <Button
                onClick={handlePreviousPage}
                disabled={!canGoPrevious}
                variant="outline"
                className="flex items-center gap-2"
              >
                <ChevronLeft size={16} />
                Previous
              </Button>

              <span className="text-sm text-gray-600">
                Page {currentPage} of {totalPages || 1}
              </span>

              <Button
                onClick={handleNextPage}
                disabled={!canGoNext}
                variant="outline"
                className="flex items-center gap-2"
              >
                Next
                <ChevronRight size={16} />
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
