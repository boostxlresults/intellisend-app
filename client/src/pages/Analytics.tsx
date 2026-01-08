import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, AnalyticsSummary, TimelineDataPoint, CampaignAnalytics } from '../api/client';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

type DateRange = 'today' | '7d' | '30d' | 'all';

export default function Analytics() {
  const { selectedTenant } = useTenant();
  const [range, setRange] = useState<DateRange>('30d');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineDataPoint[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignAnalytics[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const [summaryData, timelineData, campaignData] = await Promise.all([
        api.getAnalyticsSummary(selectedTenant.id, range),
        api.getAnalyticsTimeline(selectedTenant.id, range),
        api.getAnalyticsCampaigns(selectedTenant.id, range),
      ]);
      setSummary(summaryData);
      setTimeline(timelineData);
      setCampaigns(campaignData);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [selectedTenant, range]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const rangeLabels: Record<DateRange, string> = {
    today: 'Today',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    all: 'All Time',
  };

  if (!selectedTenant) {
    return <div className="card"><p>Please select a tenant</p></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Analytics</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['today', '7d', '30d', 'all'] as DateRange[]).map((r) => (
            <button
              key={r}
              className={`btn ${range === r ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setRange(r)}
              style={{ padding: '8px 16px' }}
            >
              {rangeLabels[r]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card"><p>Loading analytics...</p></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#4299e1' }}>{summary?.totalSent || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Messages Sent</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#48bb78' }}>{summary?.deliveryRate || 0}%</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Delivery Rate</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#ed8936' }}>{summary?.totalOptOuts || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Opt-Outs</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#9f7aea' }}>{summary?.replyRate || 0}%</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Reply Rate</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#e53e3e' }}>{summary?.totalSuppressed || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Blocked Sends</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#38b2ac' }}>{summary?.totalInbound || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Replies Received</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Message Volume</h3>
              {timeline.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={timeline}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDate} />
                    <YAxis />
                    <Tooltip labelFormatter={(label) => new Date(label).toLocaleDateString()} />
                    <Legend />
                    <Line type="monotone" dataKey="sent" stroke="#4299e1" name="Sent" strokeWidth={2} />
                    <Line type="monotone" dataKey="inbound" stroke="#48bb78" name="Replies" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#718096', textAlign: 'center', padding: '50px 0' }}>No data available for this period</p>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Delivery Status</h3>
              {timeline.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={timeline}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDate} />
                    <YAxis />
                    <Tooltip labelFormatter={(label) => new Date(label).toLocaleDateString()} />
                    <Legend />
                    <Bar dataKey="sent" fill="#4299e1" name="Sent" />
                    <Bar dataKey="failed" fill="#e53e3e" name="Failed" />
                    <Bar dataKey="suppressed" fill="#ed8936" name="Blocked" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#718096', textAlign: 'center', padding: '50px 0' }}>No data available for this period</p>
              )}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Campaign Performance</h3>
            {campaigns.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Audience</th>
                    <th>Sent</th>
                    <th>Delivered</th>
                    <th>Failed</th>
                    <th>Delivery Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>{campaign.name}</td>
                      <td>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: campaign.status === 'COMPLETED' ? '#c6f6d5' : 
                                          campaign.status === 'RUNNING' ? '#bee3f8' : '#e2e8f0',
                          color: campaign.status === 'COMPLETED' ? '#276749' :
                                 campaign.status === 'RUNNING' ? '#2b6cb0' : '#4a5568',
                        }}>
                          {campaign.status}
                        </span>
                      </td>
                      <td>{campaign.audienceSize}</td>
                      <td>{campaign.messagesSent}</td>
                      <td>{campaign.messagesDelivered}</td>
                      <td>{campaign.messagesFailed}</td>
                      <td>{campaign.deliveryRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: '#718096', textAlign: 'center', padding: '20px 0' }}>No campaigns found for this period</p>
            )}
          </div>

          <div className="card" style={{ marginTop: '20px' }}>
            <h3 style={{ marginTop: 0 }}>Quick Stats</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              <div>
                <p style={{ color: '#718096', margin: 0, fontSize: '14px' }}>Total Outbound</p>
                <p style={{ fontSize: '24px', margin: '5px 0', fontWeight: 'bold' }}>{summary?.totalOutbound || 0}</p>
              </div>
              <div>
                <p style={{ color: '#718096', margin: 0, fontSize: '14px' }}>Total Failed</p>
                <p style={{ fontSize: '24px', margin: '5px 0', fontWeight: 'bold', color: '#e53e3e' }}>{summary?.totalFailed || 0}</p>
              </div>
              <div>
                <p style={{ color: '#718096', margin: 0, fontSize: '14px' }}>Opt-Out Rate</p>
                <p style={{ fontSize: '24px', margin: '5px 0', fontWeight: 'bold' }}>{summary?.optOutRate || 0}%</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
