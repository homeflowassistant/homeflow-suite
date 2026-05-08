import { useMemo, useState } from 'react';
import { AlertCircle, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { TopNavBar } from '@/components/account/TopNavBar';
import { PaymentMethodTab } from '@/components/account/PaymentMethodTab';
import { UpdatePaymentTab } from '@/components/account/UpdatePaymentTab';
import { ManageUsersTab } from '@/components/account/ManageUsersTab';
import { AddUserTab } from '@/components/account/AddUserTab';
import { CloseAccountTab } from '@/components/account/CloseAccountTab';
import { LoadingSpinner } from '@/components/account/AccountSharedUI';

export default function AccountManagement() {
  const [activeTab, setActiveTab] = useState('payment-method');

  const locationId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('locationId') || '';
  }, []);

  // Also verify connection via tRPC (same pattern as other pages)
  const connectionQuery = trpc.ghl.connectionStatus.useQuery(
    { locationId: locationId || '' },
    { enabled: !!locationId, refetchInterval: 60000 }
  );

  const isLoading = connectionQuery.isLoading;
  const isError = connectionQuery.isError;
  const isConnected = connectionQuery.data?.connected ?? false;
  const errorMessage = connectionQuery.error instanceof Error ? connectionQuery.error.message : undefined;

  if (!locationId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Failed to Load Account</h1>
          <p className="text-sm text-gray-600 mb-6">No locationId was provided in the URL.</p>
        </div>
      </div>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────────
  if (isLoading) {
    return <LoadingSpinner />;
  }

  // ─── Connection Error ──────────────────────────────────────────────
  if (isError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Failed to Load Account</h1>
          <p className="text-sm text-gray-600 mb-6">
            {errorMessage || 'Unable to verify the account connection. Please try again.'}
          </p>
          <Button onClick={() => connectionQuery.refetch()} className="bg-blue-600 hover:bg-blue-700">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // ─── Not Connected ────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-amber-600 mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">App Not Connected</h1>
          <p className="text-sm text-gray-600 mb-6">
            This location has not installed this app yet. Please install the app from the GHL Marketplace.
          </p>
          <Button onClick={() => connectionQuery.refetch()} variant="outline">
            Check Again
          </Button>
        </div>
      </div>
    );
  }

  // ─── Connected — Main Interface ───────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNavBar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'payment-method' && (
          <PaymentMethodTab locationId={locationId} onAddPaymentMethod={() => setActiveTab('update-payment')} />
        )}
        {activeTab === 'update-payment' && <UpdatePaymentTab locationId={locationId} />}
        {activeTab === 'manage-users' && (
          <ManageUsersTab locationId={locationId} onAddUserClick={() => setActiveTab('add-user')} />
        )}
        {activeTab === 'add-user' && (
          <AddUserTab locationId={locationId} onSuccess={() => setActiveTab('manage-users')} />
        )}
        {activeTab === 'close-account' && <CloseAccountTab locationId={locationId} />}
      </main>
    </div>
  );
}
