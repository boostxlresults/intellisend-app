import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

interface Plan {
  id: string;
  name: string;
  monthlyLimit: number;
  price: number;
}

interface BillingData {
  plan: {
    id: string;
    tenantId: string;
    planType: string;
    monthlyMessageLimit: number;
    monthlyCost: number;
    planDetails: Plan;
  };
  usage: {
    smsCount: number;
    mmsCount: number;
    segmentCount: number;
    limit: number;
    periodStart: string;
    periodEnd: string;
  };
  availablePlans: Plan[];
}

export default function Billing() {
  const { selectedTenant: currentTenant } = useTenant();
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  useEffect(() => {
    if (currentTenant) {
      loadBilling();
    }
  }, [currentTenant]);

  const loadBilling = async () => {
    if (!currentTenant) return;
    try {
      const data = await api.getBilling(currentTenant.id);
      setBillingData(data);
    } catch (error) {
      console.error('Error loading billing:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (planType: string) => {
    if (!currentTenant) return;
    setUpgrading(planType);
    try {
      await api.upgradePlan(currentTenant.id, planType);
      loadBilling();
    } catch (error) {
      console.error('Error upgrading plan:', error);
    } finally {
      setUpgrading(null);
    }
  };

  const formatPrice = (cents: number) => {
    return (cents / 100).toFixed(2);
  };

  if (!currentTenant) {
    return <div className="p-6">Please select a tenant</div>;
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!billingData) {
    return <div className="p-6">Error loading billing data</div>;
  }

  const usagePercent = (billingData.usage.smsCount + billingData.usage.mmsCount) / billingData.usage.limit * 100;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Billing & Usage</h1>
        <p className="text-gray-500">Manage your subscription and track usage</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Plan</h2>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold text-blue-600">
              {billingData.plan.planDetails.name}
            </span>
            {billingData.plan.monthlyCost > 0 && (
              <span className="text-gray-500">
                ${formatPrice(billingData.plan.monthlyCost)}/month
              </span>
            )}
          </div>
          <p className="text-gray-600">
            {billingData.plan.monthlyMessageLimit.toLocaleString()} messages/month
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">This Month's Usage</h2>
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span>{(billingData.usage.smsCount + billingData.usage.mmsCount).toLocaleString()} messages sent</span>
              <span>{billingData.usage.limit.toLocaleString()} limit</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">SMS:</span>{' '}
              <span className="font-medium">{billingData.usage.smsCount.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">MMS:</span>{' '}
              <span className="font-medium">{billingData.usage.mmsCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Plans</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {billingData.availablePlans.map((plan) => (
            <div
              key={plan.id}
              className={`border rounded-lg p-4 ${
                billingData.plan.planType === plan.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <h3 className="font-semibold text-gray-900">{plan.name}</h3>
              <div className="text-2xl font-bold my-2">
                {plan.price === 0 ? 'Free' : `$${formatPrice(plan.price)}`}
                {plan.price > 0 && <span className="text-sm font-normal text-gray-500">/mo</span>}
              </div>
              <p className="text-sm text-gray-600 mb-4">
                {plan.monthlyLimit.toLocaleString()} messages
              </p>
              {billingData.plan.planType === plan.id ? (
                <button disabled className="w-full bg-gray-100 text-gray-500 px-4 py-2 rounded-lg">
                  Current Plan
                </button>
              ) : (
                <button
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={upgrading === plan.id}
                  className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {upgrading === plan.id ? 'Upgrading...' : plan.price > billingData.plan.monthlyCost ? 'Upgrade' : 'Switch'}
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-500 mt-4">
          Note: For paid plans, Stripe integration is required to complete payment processing.
        </p>
      </div>
    </div>
  );
}
