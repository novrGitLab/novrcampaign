export function Wordmark({ compact = false }: { compact?: boolean }) {
  return <span className="wordmark">{compact ? 'N' : <>Novr<i>Pulse</i></>}</span>;
}
