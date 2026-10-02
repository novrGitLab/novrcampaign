import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Save, Send, Clock, FlaskConical } from 'lucide-react';
import RichEmailEditor from '../components/RichEmailEditor';
import { useCampaign, useSegments, useTemplate, useTemplates } from '../hooks/queries';
import {
  useCancelCampaign,
  useCreateCampaign,
  useScheduleCampaign,
  useSendCampaign,
  useTestCampaign,
  useUpdateCampaign,
} from '../hooks/mutations';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Badge } from '../components/ui';
import { Modal } from '../components/ui/Modal';

const TYPES = [
  { value: 'MARKETING', label: 'Marketing', hint: 'Auto unsub footer, skips unsubscribed contacts' },
  { value: 'TRANSACTIONAL', label: 'Transactional', hint: 'Delivers to everyone regardless of subscription' },
  { value: 'HEADLESS', label: 'Headless', hint: 'You control the entire HTML — add {{unsubscribeUrl}} yourself' },
];

const AUDIENCES = [
  { value: 'ALL', label: 'All subscribed contacts' },
  { value: 'SEGMENT', label: 'A specific segment' },
];

const TEMPLATE = `<p>Hi there,</p>
<p>Here's what's new this week…</p>
<p><a href="https://cybernovr.com">Visit our site</a></p>
<p>Thanks,<br />The NovrCampaign team</p>`;

export default function CampaignBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEditing = Boolean(id);

  const { data: existing } = useCampaign(id);
  const { data: segments = [] } = useSegments();
  const { data: templates = [] } = useTemplates();
  const preselectedTemplateId = searchParams.get('templateId');
  const { data: preselectedTemplate } = useTemplate(isEditing ? null : preselectedTemplateId);

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const sendCampaign = useSendCampaign();
  const scheduleCampaign = useScheduleCampaign();
  const testCampaign = useTestCampaign();
  const cancelCampaign = useCancelCampaign();

  const [form, setForm] = useState({
    name: '',
    subject: '',
    body: TEMPLATE,
    type: 'MARKETING',
    audienceType: 'ALL',
    segmentId: '',
    templateId: '',
  });
  const [savedId, setSavedId] = useState(id ?? null);
  const [error, setError] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  // savedId is the truth after creating a draft (URL id is empty for new campaigns)
  const effectiveId = savedId ?? id ?? null;

  // Hydrate when editing
  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name ?? '',
        subject: existing.subject ?? '',
        body: existing.body ?? TEMPLATE,
        type: existing.type ?? 'MARKETING',
        audienceType: existing.audienceType ?? 'ALL',
        segmentId: existing.segmentId ?? '',
        templateId: '',
      });
      setSavedId(existing.id);
    }
  }, [existing]);

  // Hydrate from a template when creating via ?templateId=
  useEffect(() => {
    if (!isEditing && preselectedTemplate) {
      setForm((f) => ({
        ...f,
        name: f.name || `${preselectedTemplate.name} — campaign`,
        subject: preselectedTemplate.subject ?? f.subject,
        body: preselectedTemplate.body ?? f.body,
        type: preselectedTemplate.type ?? f.type,
        templateId: preselectedTemplate.id,
      }));
    }
  }, [isEditing, preselectedTemplate]);

  // Picking a template from the dropdown fills subject/body/type
  const onPickTemplate = (templateId) => {
    const tpl = templates.find((t) => t.id === templateId);
    setForm((f) => ({
      ...f,
      templateId: templateId ?? '',
      ...(tpl ? { subject: tpl.subject ?? f.subject, body: tpl.body ?? f.body, type: tpl.type ?? f.type } : {}),
    }));
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const editable = !existing || ['DRAFT', 'FAILED'].includes(existing.status);

  const onSave = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      setError('Name, subject, and body are required.');
      return;
    }

    try {
      const payload = { ...form };
      if (payload.audienceType !== 'SEGMENT') delete payload.segmentId;
      if (!payload.segmentId) delete payload.segmentId;
      delete payload.templateId;
      if (isEditing && savedId) {
        const updated = await updateCampaign.mutateAsync({ id: savedId, body: payload });
        setSavedId(updated.id);
      } else {
        const created = await createCampaign.mutateAsync(payload);
        setSavedId(created.id);
        navigate(`/campaigns/${created.id}/edit`, { replace: true });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const onSend = async () => {
    if (!savedId) return;
    if (!confirm('Send this campaign to all matching contacts now?')) return;
    try {
      await sendCampaign.mutateAsync({ id: savedId });
      navigate(`/campaigns/${savedId}/analytics`);
    } catch (err) {
      setError(err.message);
    }
  };

  const onSchedule = async () => {
    setError(null);
    try {
      await scheduleCampaign.mutateAsync({ id: effectiveId, scheduledFor });
      setScheduleOpen(false);
      navigate(`/campaigns/${effectiveId}/analytics`);
    } catch (err) {
      setError(err.message);
    }
  };

  const [testSent, setTestSent] = useState(false);

  const onTest = async () => {
    setError(null);
    setTestSent(false);
    try {
      await testCampaign.mutateAsync({ id: effectiveId, email: testEmail });
      setTestSent(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const onCancel = async () => {
    if (!savedId) return;
    try {
      await cancelCampaign.mutateAsync(savedId);
      navigate(`/campaigns/${savedId}/analytics`);
    } catch (err) {
      setError(err.message);
    }
  };

  const saving = createCampaign.isPending || updateCampaign.isPending;
  const locked = existing && !editable;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {isEditing ? 'Edit campaign' : 'New campaign'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drafts are stored in Plunk; the sender address must be on a verified domain.
        </p>
      </div>

      {locked && (
        <div className="mb-6 flex items-center justify-between rounded-md border bg-secondary/60 p-4">
          <div className="flex items-center gap-3">
            <Badge status={existing.status}>{existing.status}</Badge>
            <p className="text-sm text-muted-foreground">
              This campaign is locked — sent or scheduled campaigns can't be edited.
            </p>
          </div>
          {['SCHEDULED', 'SENDING'].includes(existing.status) && (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel campaign
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      <form onSubmit={onSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Campaign name</Label>
                <Input id="name" value={form.name} onChange={set('name')} disabled={locked} placeholder="October product launch" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject">Subject line</Label>
                <Input id="subject" value={form.subject} onChange={set('subject')} disabled={locked} placeholder="We just shipped something big" required />
              </div>
            </div>

            <div className="rounded-md bg-secondary/60 p-3 text-sm text-muted-foreground">
              Sending from <code className="font-mono">info@cybernovr.com</code> (fixed in-house identity).
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type">Email type</Label>
                <select id="type" value={form.type} onChange={set('type')} disabled={locked} className="input">
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {TYPES.find((t) => t.value === form.type)?.hint}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="audienceType">Audience</Label>
                <select id="audienceType" value={form.audienceType} onChange={set('audienceType')} disabled={locked} className="input">
                  {AUDIENCES.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {form.audienceType === 'SEGMENT' && (
                  segments.length > 0 ? (
                    <select value={form.segmentId} onChange={set('segmentId')} disabled={locked} className="input mt-2">
                      <option value="">Select a segment…</option>
                      {segments.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.memberCount !== undefined && s.memberCount !== null ? ` (${s.memberCount})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-amber-600">
                      No segments yet — create one under Segments first, then pick it here.
                    </p>
                  )
                )}
              </div>
            </div>

            {!locked && templates.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="templateId">Start from a template</Label>
                <select id="templateId" value={form.templateId} onChange={(e) => onPickTemplate(e.target.value)} className="input">
                  <option value="">Blank — write from scratch</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.subject}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email content</CardTitle>
          </CardHeader>
          <CardContent>
            <RichEmailEditor
              value={form.body}
              onChange={(html) => setForm((f) => ({ ...f, body: html }))}
              disabled={locked}
            />
            {form.type !== 'TRANSACTIONAL' && !form.body.toLowerCase().includes('{{unsubscribe') && (
              <p className="mt-3 text-xs text-amber-600">
                {form.type === 'HEADLESS'
                  ? 'Headless sends must include {{unsubscribeUrl}} — add an unsubscribe link.'
                  : 'Plunk injects the unsubscribe footer automatically for marketing campaigns.'}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving || locked}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save draft'}
          </Button>

          {savedId && !locked && (
            <>
              <Button type="button" variant="secondary" onClick={onSend} disabled={sendCampaign.isPending}>
                <Send className="h-4 w-4" />
                {sendCampaign.isPending ? 'Sending…' : 'Send now'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setScheduleOpen(true)}>
                <Clock className="h-4 w-4" />
                Schedule
              </Button>
              <Button type="button" variant="ghost" onClick={() => setTestOpen(true)}>
                <FlaskConical className="h-4 w-4" />
                Test send
              </Button>
            </>
          )}
        </div>
      </form>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule campaign"
        description="Pick a future send time (ISO 8601). Plunk queues the send at that time."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scheduledFor">Send at</Label>
            <Input
              id="scheduledFor"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => {
                // datetime-local is local time; convert to ISO for the API
                const iso = e.target.value ? new Date(e.target.value).toISOString() : '';
                setScheduledFor(iso);
              }}
            />
          </div>
          <Button className="w-full" onClick={onSchedule} disabled={!scheduledFor || scheduleCampaign.isPending}>
            {scheduleCampaign.isPending ? 'Scheduling…' : 'Schedule campaign'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={testOpen}
        onClose={() => { setTestOpen(false); setTestSent(false); }}
        title="Send a test"
        description="A single test email to preview rendering and personalisation."
      >
        <div className="space-y-4">
          {testSent ? (
            <>
              <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Test email sent to {testEmail}. Check the inbox (and spam) in a minute.
              </p>
              <Button className="w-full" onClick={() => { setTestOpen(false); setTestSent(false); }}>
                Done
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="testEmail">Recipient</Label>
                <Input
                  id="testEmail"
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@cybernovr.com"
                />
              </div>
              <Button className="w-full" onClick={onTest} disabled={!testEmail || testCampaign.isPending}>
                {testCampaign.isPending ? 'Sending test…' : 'Send test email'}
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
