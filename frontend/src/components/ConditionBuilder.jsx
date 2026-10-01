import { Plus, Trash2 } from 'lucide-react';
import { Label } from './ui';

// ── Plunk filter reference (docs.useplunk.com/guides/segment-filters) ────────
// { logic: AND|OR, groups: [{ filters: [{ field, operator, value?, unit? }] }] }
// Filters inside a group combine with AND; top-level logic joins the groups.

const OPERATOR_GROUPS = [
  {
    label: 'Text / yes-no / number',
    ops: [
      { value: 'equals', label: 'equals', needsValue: true },
      { value: 'notEquals', label: 'not equals', needsValue: true },
      { value: 'contains', label: 'contains', needsValue: true },
      { value: 'notContains', label: 'not contains', needsValue: true },
      { value: 'greaterThan', label: 'greater than', needsValue: true },
      { value: 'lessThan', label: 'less than', needsValue: true },
      { value: 'greaterThanOrEqual', label: 'greater than or equal', needsValue: true },
      { value: 'lessThanOrEqual', label: 'less than or equal', needsValue: true },
    ],
  },
  {
    label: 'Dates (unit required)',
    ops: [
      { value: 'within', label: 'within last N', needsValue: true, needsUnit: true },
      { value: 'olderThan', label: 'older than N', needsValue: true, needsUnit: true },
    ],
  },
  {
    label: 'Events & email activity',
    ops: [
      { value: 'triggered', label: 'has triggered (ever)' },
      { value: 'notTriggered', label: 'has never triggered' },
      { value: 'triggeredWithin', label: 'triggered within last N', needsValue: true, needsUnit: true },
      { value: 'triggeredOlderThan', label: 'triggered, but not within last N', needsValue: true, needsUnit: true },
      { value: 'notTriggeredWithin', label: 'not triggered within last N', needsValue: true, needsUnit: true },
    ],
  },
  {
    label: 'Field existence',
    ops: [{ value: 'exists', label: 'exists' }, { value: 'notExists', label: 'not exists' }],
  },
  {
    label: 'Segment membership',
    ops: [
      { value: 'memberOfSegment', label: 'is member of' },
      { value: 'notMemberOfSegment', label: 'is not member of' },
    ],
  },
];

const OPERATOR_META = Object.fromEntries(OPERATOR_GROUPS.flatMap((g) => g.ops).map((o) => [o.value, o]));

export const FIELD_SUGGESTIONS = [
  'email',
  'subscribed',
  'createdAt',
  'updatedAt',
  'data.plan',
  'data.firstName',
  'data.lastName',
  'event.signed_up',
  'event.purchase',
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.complained',
];

const UNITS = ['days', 'hours', 'minutes'];

let seq = 0;
const nid = (prefix) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

export function emptyFilter() {
  return { id: nid('f'), field: 'subscribed', operator: 'equals', value: 'true', unit: 'days' };
}

export function emptyGroup() {
  return { id: nid('g'), filters: [emptyFilter()] };
}

export function emptyCondition() {
  return { logic: 'AND', groups: [emptyGroup()] };
}

/** "true" → true, "42" → 42, otherwise the raw string. */
function parseValue(raw) {
  const t = String(raw ?? '').trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return t;
}

/** Builder state → Plunk condition payload (throws on validation errors). */
export function serializeCondition(condition) {
  const groups = (condition.groups ?? [])
    .map((g) => ({
      filters: (g.filters ?? []).map((f) => {
        if (!f.field?.trim()) throw new Error('Every filter needs a field.');
        const meta = OPERATOR_META[f.operator] ?? { needsValue: true };
        const filter = { field: f.field.trim(), operator: f.operator };
        if (meta.needsValue) {
          if (String(f.value ?? '').trim() === '') throw new Error(`Filter on “${f.field}” needs a value.`);
          filter.value = parseValue(f.value);
        }
        if (meta.needsUnit) filter.unit = f.unit || 'days';
        return filter;
      }),
    }))
    .filter((g) => g.filters.length > 0);

  if (groups.length === 0) throw new Error('Add at least one filter to the condition.');
  return { logic: condition.logic === 'OR' ? 'OR' : 'AND', groups };
}

/** Starter presets so common audiences are one click. */
export const CONDITION_PRESETS = [
  {
    name: 'Subscribed contacts',
    build: () => ({ logic: 'AND', groups: [{ id: nid('g'), filters: [{ ...emptyFilter(), field: 'subscribed', operator: 'equals', value: 'true' }] }] }),
  },
  {
    name: 'Engaged in last 14 days',
    build: () => ({
      logic: 'AND',
      groups: [
        { id: nid('g'), filters: [{ ...emptyFilter(), field: 'subscribed', operator: 'equals', value: 'true' }] },
        { id: nid('g'), filters: [{ ...emptyFilter(), field: 'email.opened', operator: 'triggeredWithin', value: '14', unit: 'days' }] },
      ],
    }),
  },
  {
    name: 'New trial users (7d, no purchase)',
    build: () => ({
      logic: 'AND',
      groups: [
        {
          id: nid('g'),
          filters: [
            { ...emptyFilter(), field: 'subscribed', operator: 'equals', value: 'true' },
            { ...emptyFilter(), field: 'createdAt', operator: 'within', value: '7', unit: 'days' },
            { ...emptyFilter(), field: 'event.purchase', operator: 'notTriggered' },
          ],
        },
      ],
    }),
  },
];

function FilterRow({ filter, onChange, onRemove, canRemove, disabled }) {
  const meta = OPERATOR_META[filter.operator] ?? { needsValue: true };
  const set = (key) => (e) => onChange({ ...filter, [key]: e.target.value });

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <input
        value={filter.field}
        onChange={set('field')}
        disabled={disabled}
        list="condition-field-suggestions"
        placeholder="data.plan"
        className="input h-9 font-mono text-xs"
      />
      <select value={filter.operator} onChange={set('operator')} disabled={disabled} className="input h-9 text-xs">
        {OPERATOR_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.ops.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="flex gap-2">
        {meta.needsValue && (
          <input
            value={filter.value ?? ''}
            onChange={set('value')}
            disabled={disabled}
            placeholder={filter.field === 'subscribed' ? 'true' : 'value'}
            className="input h-9 w-24 text-xs"
          />
        )}
        {meta.needsUnit && (
          <select value={filter.unit || 'days'} onChange={set('unit')} disabled={disabled} className="input h-9 w-24 text-xs">
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled || !canRemove}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
          title="Remove filter"
          aria-label="Remove filter"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Visual builder for a Plunk filter condition.
 * `value` = { logic, groups: [{ id, filters: [{ id, field, operator, value, unit }] }]}
 */
export default function ConditionBuilder({ value, onChange, disabled }) {
  const updateGroup = (groupId, filters) =>
    onChange({ ...value, groups: value.groups.map((g) => (g.id === groupId ? { ...g, filters } : g)) });

  let preview = '';
  try {
    preview = JSON.stringify(serializeCondition(value), null, 2);
  } catch {
    preview = '— complete the filters to preview —';
  }

  return (
    <div className="space-y-3">
      <datalist id="condition-field-suggestions">
        {FIELD_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <div className="flex items-center gap-2">
        <Label>Match</Label>
        <select
          value={value.logic}
          onChange={(e) => onChange({ ...value, logic: e.target.value })}
          disabled={disabled}
          className="input h-9 w-40 text-xs"
        >
          <option value="AND">ALL groups (AND)</option>
          <option value="OR">ANY group (OR)</option>
        </select>
        <span className="text-xs text-muted-foreground">filters inside a group combine with AND</span>
      </div>

      {value.groups.map((group, gi) => (
        <div key={group.id} className="space-y-2 rounded-md border bg-secondary/30 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">
              Group {gi + 1}
              {value.groups.length > 1 && <span> — {value.logic === 'OR' ? 'or' : 'and'}</span>}
            </p>
            <button
              type="button"
              onClick={() => onChange({ ...value, groups: value.groups.filter((g) => g.id !== group.id) })}
              disabled={disabled || value.groups.length <= 1}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove group
            </button>
          </div>
          {group.filters.map((f) => (
            <FilterRow
              key={f.id}
              filter={f}
              disabled={disabled}
              canRemove={group.filters.length > 1}
              onChange={(next) => updateGroup(group.id, group.filters.map((x) => (x.id === f.id ? next : x)))}
              onRemove={() => updateGroup(group.id, group.filters.filter((x) => x.id !== f.id))}
            />
          ))}
          <button
            type="button"
            onClick={() => updateGroup(group.id, [...group.filters, emptyFilter()])}
            disabled={disabled}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Add filter (AND)
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange({ ...value, groups: [...value.groups, emptyGroup()] })}
        disabled={disabled}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Add group ({value.logic})
      </button>

      <details className="rounded-md border bg-secondary/30 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Preview filter JSON</summary>
        <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11px]">{preview}</pre>
      </details>
    </div>
  );
}
