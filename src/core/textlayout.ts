// Text layout for the glasses' fixed-size font. The G2 font can't be measured from the web
// page, so widths are estimated per character class. The estimates are slightly generous so
// a line never wraps a second time on the glasses.

const WIDE = /[ᄀ-ᇿ⺀-鿿가-힣豈-﫿＀-￯]/;

/** Estimated pixel width of one character in the glasses' text font. */
export function charWidth(ch: string): number {
  if (ch === ' ') return 7;
  if (WIDE.test(ch)) return 24;
  if (/[iljI.,:;'!|`]/.test(ch)) return 7;
  if (/[mwMW@%]/.test(ch)) return 18;
  return 13;
}

export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

/** Word-wraps text to lines no wider than `maxWidth`, breaking long words where needed. */
export function wrapText(text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    let width = 0;
    // Keep spaces attached to the following word so a line never starts with one.
    for (const token of para.match(/\s*\S+/g) ?? []) {
      const tw = textWidth(token);
      if (width + tw <= maxWidth) {
        line += token;
        width += tw;
        continue;
      }
      const word = token.trimStart();
      if (line) out.push(line);
      line = '';
      width = 0;
      // A word wider than a line (or CJK text without spaces) is split character by character.
      for (const ch of word) {
        const cw = charWidth(ch);
        if (width + cw > maxWidth && line) {
          out.push(line);
          line = '';
          width = 0;
        }
        line += ch;
        width += cw;
      }
    }
    out.push(line);
  }
  // Drop trailing blank lines.
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** Splits text into pages of at most `linesPerPage` wrapped lines. Always returns at least one page. */
export function paginate(text: string, maxWidth: number, linesPerPage: number): string[] {
  const lines = wrapText(text, maxWidth);
  if (!lines.length) return [''];
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage).join('\n'));
  return pages;
}

/** Shortens to fit `maxWidth`, ending with an ellipsis when cut. */
export function ellipsize(s: string, maxWidth: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  if (textWidth(flat) <= maxWidth) return flat;
  let out = '';
  let w = textWidth('…');
  for (const ch of flat) {
    const cw = charWidth(ch);
    if (w + cw > maxWidth) break;
    out += ch;
    w += cw;
  }
  return out.trimEnd() + '…';
}
