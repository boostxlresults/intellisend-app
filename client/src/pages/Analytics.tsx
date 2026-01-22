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
type TabType = 'overview' | 'compliance';

interface ComplianceData {
  summary: {
    totalOptOuts: number;
    totalComplaints: number;
    totalCarrierBlocked: number;
    totalQuietHoursBlocked: number;
    totalSuppressed: number;
    totalRateLimited: number;
    optOutRate: number;
    complaintRate: number;
    blockedRate: number;
  };
  alerts: Array<{ type: string; message: string; severity: 'warning' | 'critical' }>;
  trend: Array<{ date: string; optOuts: number; complaints: number; blocked: number }>;
  recentOptOuts: Array<{ id: string; phone: string; reason: string; createdAt: string }>;
}

export default function Analytics() {
  const { selectedTenant } = useTenant();
  const [range, setRange] = useState<DateRange>('30d');
  const [tab, setTab] = useState<TabType>('overview');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineDataPoint[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignAnalytics[]>([]);
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const [summaryData, timelineData, campaignData, complianceData] = await Promise.all([
        api.getAnalyticsSummary(selectedTenant.id, range),
        api.getAnalyticsTimeline(selectedTenant.id, range),
        api.getAnalyticsCampaigns(selectedTenant.id, range),
        api.getComplianceAnalytics(selectedTenant.id, range),
      ]);
      setSummary(summaryData);
      setTimeline(timelineData);
      setCampaigns(campaignData);
      setCompliance(complianceData);
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

      <div style={{ display: 'flex', gap: '0', marginBottom: '20px', borderBottom: '2px solid #e2e8f0' }}>
        <button
          onClick={() => setTab('overview')}
          style={{
            padding: '12px 24px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontWeight: tab === 'overview' ? 600 : 400,
            color: tab === 'overview' ? '#3182ce' : '#718096',
            borderBottom: tab === 'overview' ? '2px solid #3182ce' : '2px solid transparent',
            marginBottom: '-2px',
          }}
        >
          Overview
        </button>
        <button
          onClick={() => setTab('compliance')}
          style={{
            padding: '12px 24px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontWeight: tab === 'compliance' ? 600 : 400,
            color: tab === 'compliance' ? '#3182ce' : '#718096',
            borderBottom: tab === 'compliance' ? '2px solid #3182ce' : '2px solid transparent',
            marginBottom: '-2px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          Compliance
          {compliance?.alerts && compliance.alerts.length > 0 && (
            <span style={{
              background: compliance.alerts.some(a => a.severity === 'critical') ? '#e53e3e' : '#ed8936',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '10px',
              fontSize: '12px',
            }}>
              {compliance.alerts.length}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="card"><p>Loading analytics...</p></div>
      ) : tab === 'overview' ? (
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
                    <Tooltip labelFormatter={(label: string) => new Date(label).toLocaleDateString()} />
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
                    <Tooltip labelFormatter={(label: string) => new Date(label).toLocaleDateString()} />
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
      ) : (
        <>
          {compliance?.alerts && compliance.alerts.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              {compliance.alerts.map((alert, index) => (
                <div
                  key={index}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    marginBottom: '12px',
                    background: alert.severity === 'critical' ? '#fff5f5' : '#fffaf0',
                    borderLeft: `4px solid ${alert.severity === 'critical' ? '#e53e3e' : '#ed8936'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '18px' }}>{alert.severity === 'critical' ? '🚨' : '⚠️'}</span>
                    <strong style={{ color: alert.severity === 'critical' ? '#c53030' : '#c05621' }}>
                      {alert.type.replace(/_/g, ' ')}
                    </strong>
                  </div>
                  <p style={{ margin: 0, color: alert.severity === 'critical' ? '#742a2a' : '#744210' }}>
                    {alert.message}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', marginBottom: '30px' }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#ed8936' }}>{compliance?.summary.totalOptOuts || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Opt-Outs</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#e53e3e' }}>{compliance?.summary.totalComplaints || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Complaints</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#805ad5' }}>{compliance?.summary.totalCarrierBlocked || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Carrier Blocked</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#3182ce' }}>{compliance?.summary.totalQuietHoursBlocked || 0}</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Quiet Hours Blocked</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: '#718096' }}>{compliance?.summary.optOutRate || 0}%</h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Opt-Out Rate</p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '32px', margin: '0', color: compliance?.summary.complaintRate && compliance.summary.complaintRate > 0.1 ? '#e53e3e' : '#38a169' }}>
                {compliance?.summary.complaintRate || 0}%
              </h3>
              <p style={{ color: '#718096', margin: '5px 0 0' }}>Complaint Rate</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Opt-Out & Complaint Trends</h3>
              {compliance?.trend && compliance.trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={compliance.trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDate} />
                    <YAxis />
                    <Tooltip labelFormatter={(label: string) => new Date(label).toLocaleDateString()} />
                    <Legend />
                    <Line type="monotone" dataKey="optOuts" stroke="#ed8936" name="Opt-Outs" strokeWidth={2} />
                    <Line type="monotone" dataKey="complaints" stroke="#e53e3e" name="Complaints" strokeWidth={2} />
                    <Line type="monotone" dataKey="blocked" stroke="#805ad5" name="Carrier Blocked" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#718096', textAlign: 'center', padding: '50px 0' }}>No data available</p>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Recent Opt-Outs</h3>
              {compliance?.recentOptOuts && compliance.recentOptOuts.length > 0 ? (
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Phone</th>
                        <th>Reason</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compliance.recentOptOuts.map((optOut) => (
                        <tr key={optOut.id}>
                          <td>{optOut.phone}</td>
                          <td>{optOut.reason}</td>
                          <td>{new Date(optOut.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: '#718096', textAlign: 'center', padding: '50px 0' }}>No recent opt-outs</p>
              )}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>TCPA Compliance Guidelines</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <h4 style={{ marginBottom: '12px', color: '#2d3748' }}>Acceptable Thresholds</h4>
                <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
                  <li><strong>Opt-Out Rate:</strong> Below 2% is healthy</li>
                  <li><strong>Complaint Rate:</strong> Below 0.1% is required</li>
                  <li><strong>Quiet Hours:</strong> No messages 9pm-8am local time</li>
                  <li><strong>Consent:</strong> Prior express written consent required</li>
                </ul>
              </div>
              <div>
                <h4 style={{ marginBottom: '12px', color: '#2d3748' }}>Best Practices</h4>
                <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
                  <li>Always include STOP instructions in messages</li>
                  <li>Honor opt-outs immediately (automatically handled)</li>
                  <li>Keep records of consent with timestamps</li>
                  <li>Monitor complaint rates daily</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
