import { useState } from 'react';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getBackendUrl } from '@/lib/backend';
import { Card, WarningBanner } from '@/components/account/AccountSharedUI';
import { formatDate } from '@/lib/accountManagement.utils';

interface CloseAccountTabProps {
  locationId: string;
}

interface ConfirmationModal {
  type: 'cancel' | 'pause' | 'delete' | null;
}

export function CloseAccountTab({ locationId }: CloseAccountTabProps) {
  const [confirmationModal, setConfirmationModal] = useState<ConfirmationModal>({ type: null });
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);

  const handleCancelSubscription = async () => {
    try {
      setLoading(true);

      const response = await fetch(getBackendUrl('/api/saas/disable'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      toast.success('Subscription cancelled. Access ends at the end of the current billing period.');
      setConfirmationModal({ type: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePauseAccount = async () => {
    try {
      setLoading(true);

      const response = await fetch(getBackendUrl('/api/saas/pause'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          pause: true,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to pause account');
      }

      toast.success('Account has been paused. Billing is suspended.');
      setConfirmationModal({ type: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') {
      toast.error('Please type DELETE to confirm');
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(getBackendUrl('/api/location/delete'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          confirmationText: 'DELETE',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete account');
      }

      setAccountDeleted(true);
      setConfirmationModal({ type: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (accountDeleted) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <XCircle className="h-16 w-16 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Account Deleted</h2>
          <p className="text-gray-600 mb-6">
            Your account and all associated data have been permanently deleted. This action cannot be undone.
          </p>
          <p className="text-sm text-gray-500">You will be redirected automatically.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WarningBanner message="⚠️ Be careful with these actions. Some of them cannot be undone." />

      {/* Cancel Subscription Section */}
      <Card title="Cancel Subscription" description="Stop your subscription at the end of the current billing period">
        <p className="text-sm text-gray-600 mb-4">
          Your subscription will be cancelled at the end of the current billing period. You will retain access until
          that date. All data will be preserved.
        </p>
        <Button
          onClick={() => setConfirmationModal({ type: 'cancel' })}
          className="bg-orange-600 hover:bg-orange-700"
          disabled={loading}
        >
          Cancel Subscription
        </Button>
      </Card>

      {/* Pause Account Section */}
      <Card title="Pause Account" description="Temporarily suspend this account">
        <p className="text-sm text-gray-600 mb-4">
          Temporarily suspend this account. Billing will be paused and the account will become inactive until you
          resume it.
        </p>
        <Button
          onClick={() => setConfirmationModal({ type: 'pause' })}
          className="bg-yellow-600 hover:bg-yellow-700"
          disabled={loading}
        >
          Pause Account
        </Button>
      </Card>

      {/* Delete Account Section */}
      <Card title="Delete Account (Permanent)" description="Permanently delete this account and all data">
        <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4 mb-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-red-900 mb-1">⛔ This action cannot be undone</h4>
              <p className="text-sm text-red-800">
                This will permanently delete this account and ALL associated data including contacts, campaigns,
                funnels, and conversations.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-900 mb-2">
            To confirm, type <span className="font-mono bg-gray-100 px-2 py-1 rounded">DELETE</span>
          </label>
          <input
            type="text"
            value={deleteConfirmation}
            onChange={(e) => setDeleteConfirmation(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full border border-red-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <Button
          onClick={() => setConfirmationModal({ type: 'delete' })}
          className="bg-red-600 hover:bg-red-700 w-full"
          disabled={deleteConfirmation !== 'DELETE' || loading}
        >
          Delete Account Permanently
        </Button>
      </Card>

      {/* Confirmation Modals */}
      {confirmationModal.type === 'cancel' && (
        <ConfirmationModal
          title="Cancel Subscription?"
          message="Your subscription will be cancelled at the end of the current billing period."
          onConfirm={handleCancelSubscription}
          onCancel={() => setConfirmationModal({ type: null })}
          loading={loading}
          destructive
        />
      )}

      {confirmationModal.type === 'pause' && (
        <ConfirmationModal
          title="Pause Account?"
          message="Your account will be temporarily paused. Billing will be suspended."
          onConfirm={handlePauseAccount}
          onCancel={() => setConfirmationModal({ type: null })}
          loading={loading}
          destructive={false}
        />
      )}

      {confirmationModal.type === 'delete' && (
        <ConfirmationModal
          title="Delete Account Permanently?"
          message="This will permanently delete this account and ALL associated data. This action cannot be undone."
          onConfirm={handleDeleteAccount}
          onCancel={() => setConfirmationModal({ type: null })}
          loading={loading}
          destructive
        />
      )}
    </div>
  );
}

function ConfirmationModal({
  title,
  message,
  onConfirm,
  onCancel,
  loading,
  destructive,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  destructive: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onCancel}></div>
      <div className={`relative bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6 ${destructive ? 'border-t-4 border-red-600' : ''}`}>
        <div className={`flex items-center justify-center w-12 h-12 rounded-full mx-auto mb-4 ${
          destructive ? 'bg-red-100' : 'bg-yellow-100'
        }`}>
          <AlertTriangle className={`h-6 w-6 ${destructive ? 'text-red-600' : 'text-yellow-600'}`} />
        </div>

        <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">{title}</h3>
        <p className="text-sm text-gray-600 text-center mb-6">{message}</p>

        <div className="flex gap-3">
          <Button onClick={onCancel} variant="outline" className="flex-1" disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className={`flex-1 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Confirming...
              </>
            ) : (
              'Confirm'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
