import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, LayoutTemplate, Trash2, Copy, Eye } from 'lucide-react';
import { useTemplates, useTemplate } from '../hooks/queries';
import { useCreateTemplate, useDeleteTemplate, useDuplicateTemplate } from '../hooks/mutations';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import RichEmailEditor from '../components/RichEmailEditor';
import { STARTER_TEMPLATES } from '../templates';

const TYPES = ['MARKETING', 'TRANSACTIONAL', 'HEADLESS'];

export default function Templates() {
  const { data: templates = [], isLoading } = useTemplates();
  const createTemplate = useCreateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const duplicateTemplate = useDuplicateTemplate();
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', subject: '', body: '', type: 'MARKETING' });

  const onCreate = async () => {
    setError(null);
    try {
      await createTemplate.mutateAsync(form);
      setOpen(false);
      setForm({ name: '', subject: '', body: '', type: 'MARKETING' });
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (t) => {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      await deleteTemplate.mutateAsync(t.id);
    } catch (err) {
      alert(err.message);
    }
  };

  const onDuplicate = async (t) => {
    try {
      await duplicateTemplate.mutateAsync(t.id);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reusable subject + HTML presets stored in Plunk. Start a campaign from one.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All templates {templates.length > 0 && `(${templates.length})`}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading templates…</p>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={<LayoutTemplate className="h-8 w-8" />}
              title="No templates yet"
              description="Save your best-performing HTML as a template and reuse it."
              action={
                <Button onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New template
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead className="border-b">
                  <tr>
                    <th>Template</th>
                    <th>Type</th>
                    <th className="w-32" />
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td>
                        <button onClick={() => setPreviewId(t.id)} className="text-left" title="Preview template">
                          <p className="font-medium hover:underline">{t.name}</p>
                          <p className="max-w-xs truncate text-xs text-muted-foreground">{t.subject}</p>
                        </button>
                      </td>
                      <td>
                        <Badge status={t.type}>{t.type}</Badge>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setPreviewId(t.id)} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Preview" aria-label={`Preview ${t.name}`}>
                            <Eye className="h-4 w-4" />
                          </button>
                          <Link
                            to={`/campaigns/new?templateId=${t.id}`}
                            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Use in new campaign"
                          >
                            <Plus className="h-4 w-4" />
                          </Link>
                          <button onClick={() => onDuplicate(t)} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Duplicate" aria-label={`Duplicate ${t.name}`}>
                            <Copy className="h-4 w-4" />
                          </button>
                          <button onClick={() => onDelete(t)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${t.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New template" description="Stored in Plunk. HEADLESS templates must include {{unsubscribeUrl}} in the body." className="max-w-5xl">
        <div className="space-y-4">
          {error && <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
          <div className="space-y-2">
            <Label>Start from a CyberNovr newsletter starter</Label>
            <div className="flex flex-wrap gap-2">
              {STARTER_TEMPLATES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.description}
                  onClick={() => setForm({ name: s.name, subject: s.subject, body: s.body, type: s.type })}
                  className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Weekly digest" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-subject">Subject</Label>
            <Input id="tpl-subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="What shipped this week" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-type">Type</Label>
            <select id="tpl-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="input">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Body — write rich, switch to HTML for code</Label>
            <RichEmailEditor value={form.body} onChange={(html) => setForm((f) => ({ ...f, body: html }))} />
          </div>
          <Button className="w-full" onClick={onCreate} disabled={!form.name.trim() || !form.subject.trim() || !form.body.trim() || createTemplate.isPending}>
            {createTemplate.isPending ? 'Creating…' : 'Create template'}
          </Button>
        </div>
      </Modal>

      <TemplatePreviewModal
        templateId={previewId}
        onClose={() => setPreviewId(null)}
        onDuplicate={onDuplicate}
        onDelete={(t) => { onDelete(t); setPreviewId(null); }}
      />
    </div>
  );
}

function TemplatePreviewModal({ templateId, onClose, onDuplicate, onDelete }) {
  const { data: template, isLoading } = useTemplate(templateId);

  return (
    <Modal open={Boolean(templateId)} onClose={onClose} title={template?.name ?? 'Template preview'} description={template ? `${template.subject ?? ''} · ${template.type ?? ''}` : undefined} className="max-w-3xl">
      {isLoading || !template ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading preview…</p>
      ) : (
        <div className="space-y-4">
          <iframe
            title={`Preview of ${template.name}`}
            srcDoc={template.body ?? ''}
            sandbox=""
            className="h-[480px] w-full rounded-md border bg-white"
          />
          <div className="flex flex-wrap gap-2">
            <Link to={`/campaigns/new?templateId=${template.id}`} className="btn-primary btn-sm">
              <Plus className="h-4 w-4" />
              Use in new campaign
            </Link>
            <Button variant="secondary" size="sm" onClick={() => onDuplicate(template)}>
              <Copy className="h-4 w-4" />
              Duplicate
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onDelete(template)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
