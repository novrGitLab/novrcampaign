import { FilterTabs } from './DataTable';

export const editions = [
  { key: 'NG', label: 'Nigeria' },
  { key: 'AF', label: 'Africa' },
  { key: 'GLOBAL', label: 'World' },
] as const;

export function EditionChoice({ value, onChange }: { value: string; onChange: (edition: string) => void }) {
  return (
    <div className="space-y-2">
      <span className="label">Public edition</span>
      <FilterTabs options={editions} value={value} onChange={onChange} label="Public edition" />
    </div>
  );
}
