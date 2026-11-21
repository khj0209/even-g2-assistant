import { ellipsize, wrapText } from './textlayout';

/**
 * Lays out the question and the answer as pages for the reply box. The question is echoed on
 * the first line so the wearer can see what the speech recognizer heard. When there is more
 * than one page, the last line of each page is a "1/3" footer.
 */
export function replyPages(question: string, answer: string, width: number, lines: number): string[] {
  const body: string[] = [];
  if (question.trim()) body.push(`> ${ellipsize(question, width - 26)}`);
  const wrapped = answer.trim() ? wrapText(answer, width) : [];
  if (body.length && wrapped.length) body.push('');
  body.push(...wrapped);
  if (!body.length) return [''];
  if (body.length <= lines) return [body.join('\n')];
  const per = lines - 1;
  const n = Math.ceil(body.length / per);
  const pages: string[] = [];
  for (let i = 0; i < n; i++) {
    const chunk = body.slice(i * per, (i + 1) * per);
    while (chunk.length < per) chunk.push('');
    pages.push([...chunk, `${' '.repeat(28)}${i + 1}/${n}`].join('\n'));
  }
  return pages;
}
