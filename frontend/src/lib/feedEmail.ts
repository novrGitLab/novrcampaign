// Escape text for safe embedding in HTML (email body).
export function escapeHtml(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Email-safe (table-based, inline styles) HTML block for one feed entry: the
// summary plus a "Source: {sourceName} — link" line. Snapshot — later edits to
// the entry do not change text already inserted.
export function renderFeedBlock(entry: {summary: string; sourceName: string; url: string}) {
  const summary = escapeHtml(entry.summary);
  const sourceName = escapeHtml(entry.sourceName);
  const href = escapeHtml(entry.url);
  const linkText = escapeHtml(entry.url);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="border-collapse:collapse;margin:0 0 16px 0;">` +
    `<tr>` +
    `<td style="padding:12px 14px;border-left:3px solid #632D8A;background:#F6F1FB;` +
    `font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#0C0C13;">` +
    `<p style="margin:0 0 8px 0;">${summary}</p>` +
    `<p style="margin:0;font-size:12px;line-height:18px;color:#4E4E61;">` +
    `Source: ${sourceName} — <a href="${href}" style="color:#4353A3;text-decoration:underline;">${linkText}</a>` +
    `</p>` +
    `</td>` +
    `</tr>` +
    `</table>`
  );
}
