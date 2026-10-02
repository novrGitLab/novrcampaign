import { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Image } from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Undo2, Redo2,
  List, ListOrdered, Quote, Link as LinkIcon, Unlink, AlignLeft, AlignCenter,
  AlignRight, Minus, Eraser, Code, Eye, PenLine, User, BellOff, TriangleAlert, Trash2,
} from 'lucide-react';
import { cn } from '../lib/utils';

const BLOCK_TAGS = new Set([
  'html', 'head', 'body', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'section', 'header', 'footer', 'main', 'article', 'aside',
  'nav', 'figure', 'figcaption', 'form', 'fieldset', 'hr', 'title', 'meta',
  // NOTE: br/img/span/a stay inline so mid-sentence breaks never gain stray spaces
]);

/**
 * Pretty-print HTML: line breaks + indent at block-tag boundaries only.
 * Inline elements and text nodes are never split, so the DOM round-trips
 * byte-identically (safe to run on Tiptap's minified output).
 */
export function formatHtml(html) {
  if (!html) return '';
  const parts = String(html).split(/(<!--[\s\S]*?-->|<[^>]+>)/g).filter((p) => p !== '');
  const lines = [];
  let depth = 0;
  const indent = (d) => '  '.repeat(Math.max(0, d));
  const glue = (s) => {
    if (lines.length === 0) lines.push(s);
    else lines[lines.length - 1] += s;
  };

  const tagNameOf = (t) => {
    const mm = /^<\/?([a-zA-Z0-9]+)/.exec(t);
    return mm ? mm[1].toLowerCase() : '';
  };
  const isBlockToken = (t) =>
    t.startsWith('<!--') || (t.startsWith('<') && BLOCK_TAGS.has(tagNameOf(t)));

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.startsWith('<')) {
      if (/^\s*$/.test(part)) continue;
      // Preserve significant spaces: trim only against block boundaries
      let prev = null;
      for (let j = i - 1; j >= 0; j--) {
        if (parts[j] !== '') { prev = parts[j]; break; }
      }
      let next = null;
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[j] !== '') { next = parts[j]; break; }
      }
      let text = part.replace(/\s+/g, ' ');
      if (prev === null || (prev.startsWith('<') && isBlockToken(prev))) text = text.trimStart();
      if (next === null || (next.startsWith('<') && isBlockToken(next))) text = text.trimEnd();
      if (text) glue(text);
      continue;
    }
    if (part.startsWith('<!--')) {
      lines.push(indent(depth) + part.trim());
      continue;
    }
    const m = /^<\/?([a-zA-Z0-9]+)/.exec(part);
    const block = m ? BLOCK_TAGS.has(m[1].toLowerCase()) : false;
    const closing = /^<\//.test(part);
    const selfClosing = /\/>$/.test(part) || /^<(meta|link|img|br|hr|input)\b/i.test(part);
    if (closing) {
      if (block) {
        depth = Math.max(0, depth - 1);
        lines.push(indent(depth) + part);
      } else {
        glue(part);
      }
    } else {
      if (block) {
        lines.push(indent(depth) + part);
        if (!selfClosing) depth += 1;
      } else {
        glue(part);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Email HTML relies on presentational attributes (inline style, width, align,
 * cellpadding…) that Tiptap drops by default. Preserve them so newsletter
 * templates render — and save back — faithfully.
 */
const EmailAttributes = Extension.create({
  name: 'emailAttributes',
  addGlobalAttributes() {
    const names = ['style', 'width', 'align', 'valign', 'cellpadding', 'cellspacing', 'border', 'bgcolor'];
    const attributes = Object.fromEntries(
      names.map((name) => [
        name,
        {
          default: null,
          parseHTML: (element) => element.getAttribute(name),
          renderHTML: (attributes) => (attributes[name] ? { [name]: attributes[name] } : {}),
        },
      ]),
    );
    return [
      {
        types: [
          'table', 'tableRow', 'tableHeader', 'tableCell',
          'paragraph', 'heading', 'blockquote', 'image',
          'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'textStyle',
        ],
        attributes,
      },
    ];
  },
});

const hasTableLayout = (html) => /<table[\s>]/i.test(html ?? '');

// Full-document email HTML (head/style/classes/comments) cannot survive a
// Tiptap parse — Write mode is only lossless for simple rich text.
const hasComplexEmailHtml = (html) =>
  /<table[\s>]|<style[\s>]|<head[\s>]|<!--|\sclass=/i.test(html ?? '');

// Tiptap always keeps one empty paragraph — report it as empty instead
const normalizeEmpty = (html) => (html === '<p></p>' ? '' : html);

function ToolButton({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-purple-100 text-purple-800',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Rich email body editor: richtext (Tiptap) + raw HTML code + live preview.
 * `value` is the HTML string stored in Plunk; `onChange` receives updated HTML.
 */
export default function RichEmailEditor({ value, onChange, disabled }) {
  // Table layouts open in Preview — Write mode is for simple rich text
  const [view, setView] = useState(() => (hasTableLayout(value) ? 'preview' : 'rich'));

  const emitHtml = (html) => onChange?.(normalizeEmpty(html));

  const goView = (next) => {
    if (next === 'code' && (value ?? '') !== '') {
      const formatted = formatHtml(value);
      if (formatted !== value) onChange?.(formatted);
    }
    if (next === 'rich' && editor) {
      // Parse lazily and SILENTLY — never write the normalized output back
      editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
    }
    setView(next);
  };

  const onClear = () => {
    emitHtml('');
    if (editor) editor.commands.clearContent();
    // Land in HTML view so the replacement can be pasted losslessly
    setView('code');
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Image.configure({ inline: true }),
      // Table support keeps newsletter template layouts editable (text-in-cell editing)
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      EmailAttributes,
    ],
    content: value || '<p></p>',
    editable: !disabled,
    editorProps: {
      // Email canvas stays light in both modes — it previews the sent email
      attributes: { class: 'tiptap min-h-[280px] w-full bg-white px-4 py-3 text-sm text-slate-900 focus:outline-none' },
    },
    onUpdate: ({ editor: e }) => emitHtml(e.getHTML()),
  });

  // Sync EXTERNAL loads (template pick, campaign hydration) into an open Write
  // view — but never while the user is typing, and never write the normalized
  // parse back. Code/Preview edits flow one way until Write is re-entered.
  useEffect(() => {
    if (!editor || view !== 'rich' || editor.isFocused) return;
    const current = editor.getHTML();
    if ((value ?? '') !== current) {
      if (hasTableLayout(value) && !hasTableLayout(current)) setView('preview');
      else editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
    }
  }, [editor, value, view]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href ?? '';
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };

  const insertToken = (token) => {
    if (!editor) return;
    editor.chain().focus().insertContent(token).run();
  };

  const tabs = [
    { id: 'rich', label: 'Write', icon: PenLine },
    { id: 'code', label: 'HTML', icon: Code },
    { id: 'preview', label: 'Preview', icon: Eye },
  ];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex shrink-0 gap-1 rounded-md border bg-secondary/60 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => goView(id)}
              className={cn(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
                view === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={disabled || !value}
            title="Clear the canvas completely, then paste fresh HTML"
            className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        </div>
        {view === 'rich' && (
          <div className="hidden gap-1 sm:flex">
            <button type="button" disabled={disabled} onClick={() => insertToken('{{firstName}}')} title="Insert first-name personalisation" className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <User className="h-3 w-3" /> {'{{firstName}}'}
            </button>
            <button type="button" disabled={disabled} onClick={() => insertToken('<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>')} title="Insert unsubscribe link (required for HEADLESS)" className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <BellOff className="h-3 w-3" /> Unsubscribe link
            </button>
          </div>
        )}
      </div>

      {view === 'rich' && hasComplexEmailHtml(value) && (
        <p className="mb-2 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Full email HTML (tables, styles, classes) — rich editing keeps text but can drop head styles and
          layout details. Prefer the HTML tab for structural edits, Preview to verify.
        </p>
      )}

      {view === 'rich' && (
        <div className="overflow-hidden rounded-md border bg-white">
          <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
            <ToolButton disabled={disabled} onClick={() => editor?.chain().focus().undo().run()} title="Undo"><Undo2 className="h-4 w-4" /></ToolButton>
            <ToolButton disabled={disabled} onClick={() => editor?.chain().focus().redo().run()} title="Redo"><Redo2 className="h-4 w-4" /></ToolButton>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <ToolButton active={editor?.isActive('bold')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-4 w-4" /></ToolButton>
            <ToolButton active={editor?.isActive('italic')} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-4 w-4" /></ToolButton>
            <ToolButton active={editor?.isActive('underline')} disabled={disabled} onClick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline"><UnderlineIcon className="h-4 w-4" /></ToolButton>
            <ToolButton active={editor?.isActive('strike')} disabled={disabled} onClick={() => editor?.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough className="h-4 w-4" /></ToolButton>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <ToolButton active={editor?.isActive('heading', { level: 1 })} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><span className="text-xs font-bold">H1</span></ToolButton>
            <ToolButton active={editor?.isActive('heading', { level: 2 })} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><span className="text-xs font-bold">H2</span></ToolButton>
            <ToolButton active={editor?.isActive('bulletList')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="h-4 w-4" /></ToolButton>
            <ToolButton active={editor?.isActive('orderedList')} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="h-4 w-4" /></ToolButton>
            <ToolButton active={editor?.isActive('blockquote')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="h-4 w-4" /></ToolButton>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <ToolButton active={editor?.isActive({ textAlign: 'left' })} disabled={disabled} onClick={() => editor?.chain().focus().setTextAlign('left').run()} title="Align left"><AlignLeft className="h-4 w-4" /></ToolButton>
            <ToolButton active={editor?.isActive({ textAlign: 'center' })} disabled={disabled} onClick={() => editor?.chain().focus().setTextAlign('center').run()} title="Align center"><AlignCenter className="h-4 w-4" /></ToolButton>
            <ToolButton active={editor?.isActive({ textAlign: 'right' })} disabled={disabled} onClick={() => editor?.chain().focus().setTextAlign('right').run()} title="Align right"><AlignRight className="h-4 w-4" /></ToolButton>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <ToolButton active={editor?.isActive('link')} disabled={disabled} onClick={setLink} title="Add/edit link"><LinkIcon className="h-4 w-4" /></ToolButton>
            <ToolButton disabled={disabled} onClick={() => editor?.chain().focus().unsetLink().run()} title="Remove link"><Unlink className="h-4 w-4" /></ToolButton>
            <ToolButton disabled={disabled} onClick={() => editor?.chain().focus().setHorizontalRule().run()} title="Divider"><Minus className="h-4 w-4" /></ToolButton>
            <ToolButton disabled={disabled} onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()} title="Clear formatting"><Eraser className="h-4 w-4" /></ToolButton>
          </div>
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <p className="min-h-[280px] bg-white px-4 py-3 text-sm text-slate-400">Loading editor…</p>
          )}
        </div>
      )}

      {view === 'code' && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Raw HTML source, auto-formatted — edits apply to the email.</p>
          <textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onPaste={(e) => {
              // Format pasted markup on the way in so it stays readable
              const text = e.clipboardData.getData('text');
              if (!text || !/<[a-zA-Z][^>]*>/.test(text)) return;
              e.preventDefault();
              const el = e.currentTarget;
              const next =
                el.value.slice(0, el.selectionStart) + formatHtml(text) + el.value.slice(el.selectionEnd);
              onChange?.(next);
            }}
            disabled={disabled}
            spellCheck={false}
            wrap="off"
            className="input min-h-[320px] resize-y overflow-x-auto font-mono text-xs whitespace-pre"
            placeholder="<p>Your email HTML…</p>"
          />
        </div>
      )}

      {view === 'preview' && (
        <iframe title="Email preview" srcDoc={value} sandbox="" className="h-[320px] w-full rounded-md border bg-white" />
      )}
    </div>
  );
}
