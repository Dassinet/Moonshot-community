// Tiny auto-escaping HTML template tag. Every interpolated value is escaped
// unless it is itself the output of `html` — so user content can never inject
// markup. There is deliberately no "raw" escape hatch.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const escapeHtml = (v) => String(v).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

// Render user-written multi-line text as escaped paragraphs.
export function paragraphs(textValue) {
  return String(textValue ?? '')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => html`<p>${p.split('\n').map((line, i) => (i ? [html`<br>`, line] : line))}</p>`);
}

export function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
