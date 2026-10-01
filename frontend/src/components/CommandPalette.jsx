import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Mail, LayoutTemplate, UsersRound, Users, Plus } from 'lucide-react';
import { useCampaigns, useContacts, useSegments, useTemplates } from '../hooks/queries';

/**
 * ⌘K global search across campaigns, templates, segments and contacts.
 */
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { data: campaigns = [] } = useCampaigns();
  const { data: templates = [] } = useTemplates();
  const { data: segments = [] } = useSegments();
  const { data: contactsData } = useContacts({ limit: 25, search: query || undefined });

  useEffect(() => {
    if (open) setQuery('');
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const match = (s) => !q || s.toLowerCase().includes(q);

  const groups = useMemo(() => {
    const contacts = contactsData?.data ?? [];
    const out = [
      {
        label: 'Campaigns',
        icon: Mail,
        items: campaigns
          .filter((c) => match(c.name ?? '') || match(c.subject ?? ''))
          .slice(0, 5)
          .map((c) => ({ id: `c-${c.id}`, label: c.name, hint: c.status, to: `/campaigns/${c.id}/analytics` })),
      },
      {
        label: 'Templates',
        icon: LayoutTemplate,
        items: templates
          .filter((t) => match(t.name ?? '') || match(t.subject ?? ''))
          .slice(0, 4)
          .map((t) => ({ id: `t-${t.id}`, label: t.name, hint: t.type, to: `/campaigns/new?templateId=${t.id}` })),
      },
      {
        label: 'Segments',
        icon: UsersRound,
        items: segments
          .filter((s) => match(s.name ?? ''))
          .slice(0, 4)
          .map((s) => ({ id: `s-${s.id}`, label: s.name, hint: s.type, to: `/segments/${s.id}` })),
      },
      {
        label: 'Contacts',
        icon: Users,
        items: contacts
          .filter((c) => match(c.email ?? ''))
          .slice(0, 4)
          .map((c) => ({ id: `u-${c.id}`, label: c.email, hint: c.subscribed ? 'Subscribed' : 'Unsubscribed', to: '/contacts' })),
      },
      {
        label: 'Actions',
        icon: Plus,
        items: [
          { id: 'a-new', label: 'New campaign', hint: '', to: '/campaigns/new' },
          { id: 'a-tpl', label: 'New template', hint: '', to: '/templates' },
          { id: 'a-seg', label: 'New segment', hint: '', to: '/segments' },
        ].filter((a) => match(a.label)),
      },
    ];
    return out.filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, templates, segments, contactsData, q]);

  if (!open) return null;

  const go = (to) => {
    onClose();
    navigate(to);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-brand-ink/55 backdrop-blur-[2px]" />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl animate-fade-rise"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaigns, templates, segments, contacts…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div className="max-h-[40vh] overflow-y-auto p-2">
          {groups.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No matches.</p>}
          {groups.map((g) => (
            <div key={g.label} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => go(item.to)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="truncate font-medium">{item.label}</span>
                  {item.hint && <span className="ml-3 shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
