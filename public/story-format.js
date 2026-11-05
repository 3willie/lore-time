// Turns a story's text into HTML. Kept apart from app.js so the server tests can check it.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** **bold**, *italic* and _italic_ inside one line (also used for titles). */
export const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')

/** A title as plain text, for the browser tab. */
export const plain = (s) => s.replace(/\*\*(.+?)\*\*|\*(.+?)\*|(?<!\w)_(.+?)_(?!\w)/g, (_, a, b, c) => a ?? b ?? c)

/** Just enough Markdown for stories: paragraphs, line breaks, ## headings, --- scene breaks, **bold**, *italic*. */
export function renderStory(text) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(block)) return '<p class="break" aria-hidden="true">✦ ✦ ✦</p>'
      const heading = /^#{1,6}\s+(.+)$/.exec(block)
      if (heading && !block.includes('\n')) return `<h3>${inline(heading[1])}</h3>`
      return `<p>${block.split('\n').map(inline).join('<br>')}</p>`
    })
    .join('\n')
}
