import { useParams, Link } from 'react-router-dom';
import {
  BarChart3,
  Mail,
  MousePointerClick,
  AlertTriangle,
  UserX,
  ShieldAlert,
  ArrowLeft,
  Send,
  Clock,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useState } from 'react';
import { useCampaign, useCampaignStats } from '../hooks/queries';
import { useResendUnsent } from '../hooks/mutations';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, StatCard } from '../components/ui';
import { formatNumber, formatRate, formatDate } from '../lib/utils';

const FUNNEL = [
  { key: 'sentCount', label: 'Sent', color: '#3b82f6' },
  { key: 'deliveredCount', label: 'Delivered', color: '#22c55e' },
  { key: 'openedCount', label: 'Opened', color: '#8b5cf6' },
  { key: 'clickedCount', label: 'Clicked', color: '#f59e0b' },
];

const LOSSES = [
  { key: 'bouncedCount', label: 'Bounced', icon: AlertTriangle, color: 'text-amber-600' },
  { key: 'unsubscribedCount', label: 'Unsubscribed', icon: UserX, color: 'text-gray-600' },
  { key: 'complainedCount', label: 'Spam complaints', icon: ShieldAlert, color: 'text-red-600' },
];

export default function CampaignAnalytics() {
  const { id } = useParams();
  const { data: campaign, isLoading: campaignLoading } = useCampaign(id);
  const { data: stats, isLoading: statsLoading, refetch, isFetching } = useCampaignStats(id);
  const resendUnsent = useResendUnsent();
  const [resendResult, setResendResult] = useState(null);
  const [resendError, setResendError] = useState(null);

  const onResendUnsent = async () => {
    setResendError(null);
    setResendResult(null);
    try {
      const result = await resendUnsent.mutateAsync(id);
      setResendResult(result);
    } catch (err) {
      setResendError(err.message);
    }
  };

  const loading = campaignLoading || statsLoading;
  const sent = Number(stats?.sentCount ?? campaign?.sentCount ?? 0);

  const funnelData = FUNNEL.map((f) => ({
    name: f.label,
    count: Number(stats?.[f.key] ?? campaign?.[f.key] ?? 0),
    color: f.color,
  }));

  const rates = [
    { name: 'Delivered', value: formatRate(stats?.deliveredCount ?? campaign?.deliveredCount ?? 0, sent) },
    { name: 'Open rate', value: formatRate(stats?.openedCount ?? campaign?.openedCount ?? 0, sent) },
    { name: 'Click rate', value: formatRate(stats?.clickedCount ?? campaign?.clickedCount ?? 0, sent) },
  ].map((r) => ({ ...r, pct: parseFloat(r.value) }));

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6">
        <Link to="/campaigns" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to campaigns
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{campaign?.name ?? 'Campaign'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{campaign?.subject}</p>
          </div>
          <div className="flex items-center gap-3">
            {campaign && <Badge status={campaign.status}>{campaign.status}</Badge>}
            <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
            {campaign?.status === 'SENT' && (
              <Button size="sm" onClick={onResendUnsent} disabled={resendUnsent.isPending}>
                <Send className="h-4 w-4" />
                {resendUnsent.isPending ? 'Finding unsent…' : 'Resend to unsent'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {resendError && (
        <p className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{resendError}</p>
      )}

      {resendResult && (
        <Card className="mb-6 border-purple-200 bg-purple-50/50 dark:border-purple-900 dark:bg-purple-950/20">
          <CardContent className="p-6">
            {resendResult.unsentCount === 0 ? (
              <p className="text-sm">
                Everyone was reached — {resendResult.sentCount} sent of {resendResult.audienceCount} in the audience. Nothing to resend.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="font-semibold">{resendResult.unsentCount}</span> of {resendResult.audienceCount} contacts
                  never got this campaign ({resendResult.sentCount} sent). A STATIC segment
                  {resendResult.segment?.name ? <> “{resendResult.segment.name}”</> : null} was created and a DRAFT
                  duplicate retargeted at it — <span className="font-medium">nothing has been sent yet</span>.
                </p>
                {resendResult.campaign?.id && (
                  <Link to={`/campaigns/${resendResult.campaign.id}/analytics`}>
                    <Button size="sm">Review the resend draft</Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading analytics…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Recipients" value={formatNumber(stats?.totalRecipients ?? campaign?.totalRecipients ?? 0)} icon={<Mail className="h-4 w-4" />} />
            <StatCard label="Delivered" value={formatNumber(stats?.deliveredCount ?? 0)} hint={formatRate(stats?.deliveredCount ?? 0, sent)} icon={<BarChart3 className="h-4 w-4" />} />
            <StatCard label="Opens" value={formatNumber(stats?.openedCount ?? 0)} hint={formatRate(stats?.openedCount ?? 0, sent)} icon={<Mail className="h-4 w-4" />} />
            <StatCard label="Clicks" value={formatNumber(stats?.clickedCount ?? 0)} hint={formatRate(stats?.clickedCount ?? 0, sent)} icon={<MousePointerClick className="h-4 w-4" />} />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Delivery funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={funnelData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                    <Tooltip
                      cursor={{ fill: '#f3f4f6' }}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {funnelData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Engagement rates</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={rates} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      stroke="#9ca3af"
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                      formatter={(value) => `${value}%`}
                    />
                    <Line
                      type="monotone"
                      dataKey="pct"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={{ r: 4, fill: '#8b5cf6' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>List health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {LOSSES.map(({ key, label, icon: Icon, color }) => {
                  const count = Number(stats?.[key] ?? 0);
                  return (
                    <div key={key} className="rounded-md border p-4">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${color}`} />
                        <p className="text-sm font-medium text-muted-foreground">{label}</p>
                      </div>
                      <p className="mt-2 text-2xl font-bold tabular-nums">{formatNumber(count)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRate(count, sent)} of sent · counted once per recipient
                      </p>
                    </div>
                  );
                })}
              </div>
              {Number(stats?.complainedCount ?? 0) > 0 && (
                <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                  Spam complaints above ~0.1% of sends put sender reputation at risk. Review this campaign's
                  audience and content.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Campaign details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <Detail label="From" value={campaign?.from} />
                <Detail label="From name" value={campaign?.fromName} />
                <Detail label="Reply-to" value={campaign?.replyTo} />
                <Detail label="Type" value={campaign?.type} />
                <Detail label="Audience" value={campaign?.audienceType} />
                <Detail label="Scheduled for" value={formatDate(campaign?.scheduledFor)} />
                <Detail label="Sent at" value={formatDate(campaign?.sentAt)} />
                <Detail label="Created" value={formatDate(campaign?.createdAt)} />
              </dl>

              {campaign?.status === 'DRAFT' && (
                <div className="mt-6 flex gap-3">
                  <Link to={`/campaigns/${campaign.id}/edit`}>
                    <Button variant="secondary">
                      <Send className="h-4 w-4" />
                      Finish & send
                    </Button>
                  </Link>
                </div>
              )}
              {campaign?.status === 'SCHEDULED' && (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Scheduled for {formatDate(campaign.scheduledFor)}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value || '—'}</dd>
    </div>
  );
}
