import Link from 'next/link';
import { useParams } from 'next/navigation';
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
  Download,
} from '../components/ui/icons';
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
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, InfoTip, StatCard } from '../components/ui';
import { formatNumber, formatRate, formatDate } from '../lib/utils';
import { downloadCsv } from '../lib/exportCsv';
import { TIP } from '../lib/metrics';

const FUNNEL = [
  { key: 'sentCount', label: 'Sent', color: 'var(--link)' },
  { key: 'deliveredCount', label: 'Delivered', color: 'var(--color-success)' },
  { key: 'openedCount', label: 'Opened', color: 'var(--accent)' },
  { key: 'clickedCount', label: 'Clicked', color: 'var(--color-warning)' },
];

const LOSSES = [
  { key: 'bouncedCount', label: 'Bounced', icon: AlertTriangle, color: 'text-amber-600', tip: 'bounced' },
  { key: 'unsubscribedCount', label: 'Unsubscribed', icon: UserX, color: 'text-gray-600', tip: 'unsubscribed' },
  { key: 'complainedCount', label: 'Spam complaints', icon: ShieldAlert, color: 'text-red-600', tip: 'complained' },
];

export default function CampaignAnalytics() {
  const { id } = useParams<{ id: string }>();
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

  const onExportReport = () => {
    const n = (v) => Number(v ?? 0);
    const base = Math.max(n(stats?.sentCount ?? campaign?.sentCount), 1);
    const r = (v) => ((n(v) / base) * 100).toFixed(2);
    downloadCsv(`novr-${(campaign?.name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign'}-report`, [{
      Campaign: campaign?.name ?? '',
      Subject: campaign?.subject ?? '',
      Status: campaign?.status ?? '',
      'Sent at': campaign?.sentAt ? formatDate(campaign.sentAt) : '',
      Recipients: n(stats?.totalRecipients ?? campaign?.totalRecipients),
      Sent: n(stats?.sentCount ?? campaign?.sentCount),
      Delivered: n(stats?.deliveredCount),
      'Delivery rate %': r(stats?.deliveredCount),
      Opens: n(stats?.openedCount),
      'Open rate %': r(stats?.openedCount),
      Clicks: n(stats?.clickedCount),
      'Click rate %': r(stats?.clickedCount),
      Unsubscribed: n(stats?.unsubscribedCount),
      'Unsub rate %': r(stats?.unsubscribedCount),
      Bounced: n(stats?.bouncedCount),
      'Spam complaints': n(stats?.complainedCount),
    }]);
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
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6">
        <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to campaigns
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{campaign?.name ?? 'Campaign'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{campaign?.subject}</p>
          </div>
          <div className="flex items-center gap-3">
            {campaign && <Badge status={campaign.status}>{campaign.status}</Badge>}
            <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button variant="secondary" size="sm" onClick={onExportReport} disabled={loading}>
              <Download className="h-4 w-4" />
              Export CSV
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
        <Card className="mb-6 border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
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
                  <Link href={`/campaigns/${resendResult.campaign.id}/analytics`}>
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
            <StatCard label="Recipients" value={formatNumber(stats?.totalRecipients ?? campaign?.totalRecipients ?? 0)} icon={<Mail className="h-4 w-4" />} accent="blue" tip={TIP.recipients} />
            <StatCard label="Delivered" value={formatNumber(stats?.deliveredCount ?? 0)} hint={formatRate(stats?.deliveredCount ?? 0, sent)} icon={<BarChart3 className="h-4 w-4" />} accent="purple" tip={TIP.delivered} />
            <StatCard label="Opens" value={formatNumber(stats?.openedCount ?? 0)} hint={formatRate(stats?.openedCount ?? 0, sent)} icon={<Mail className="h-4 w-4" />} accent="red" tip={TIP.opens} />
            <StatCard label="Clicks" value={formatNumber(stats?.clickedCount ?? 0)} hint={formatRate(stats?.clickedCount ?? 0, sent)} icon={<MousePointerClick className="h-4 w-4" />} accent="blue" tip={TIP.clicks} />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Delivery funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={funnelData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--subtle)" />
                    <YAxis tick={{ fontSize: 12 }} stroke="var(--subtle)" />
                    <Tooltip
                      cursor={{ fill: 'var(--paper)' }}
                      contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', fontSize: 12 }}
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
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--subtle)" />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      stroke="var(--subtle)"
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', fontSize: 12 }}
                      formatter={(value) => `${value}%`}
                    />
                    <Line
                      type="monotone"
                      dataKey="pct"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      dot={{ r: 4, fill: 'var(--accent)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>List health</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Why recipients left this campaign</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {LOSSES.map(({ key, label, icon: Icon, color, tip }) => {
                  const count = Number(stats?.[key] ?? 0);
                  return (
                    <div key={key} className="rounded-md border p-4">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${color}`} />
                        <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                          {label}
                          <InfoTip content={TIP[tip]} />
                        </p>
                      </div>
                      <p className="mt-2 text-2xl font-bold tabular-nums">{formatNumber(count)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRate(count, sent)} of sent · counted once per recipient
                      </p>
                    </div>
                  );
                })}
                {(() => {
                  const errors = Number(stats?.bouncedCount ?? 0) + Number(stats?.complainedCount ?? 0);
                  return (
                    <div className="rounded-md border p-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-rose-600" />
                        <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                          Error rate
                          <InfoTip content={TIP.errorRate} />
                        </p>
                      </div>
                      <p className="mt-2 text-2xl font-bold tabular-nums">{formatRate(errors, sent)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatNumber(errors)} bounces + complaints of {formatNumber(sent)} sent
                      </p>
                    </div>
                  );
                })()}
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
                  <Link href={`/campaigns/${campaign.id}/edit`}>
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
