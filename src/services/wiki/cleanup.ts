/**
 * Strip the connection-line prose that was previously baked into wiki page
 * content by the old "connections in synthesis prose" approach. Connections now
 * render as a deterministic structured block (WikiConnections) and never appear
 * in page.content, so any sentence that was injected — including the scaffold
 * leak ("The knowledge graph shows that …") — must be removed from already-
 * stored pages.
 *
 * Line-based, same shape as deep-model's stripScaffolding: removes any line
 * matching the connection or leak patterns, then collapses runs of blank lines
 * so the page doesn't end up with gaps. Pure — caller passes content.
 */
const CONNECTION_LINE = [
  // Scaffold leak: the model parroted the literal instruction into the page.
  /^the knowledge graph shows/i,
  // The connection sentence baked into prose by the old synthesis prompt, e.g.
  // "Anxiety often comes up with Work, Sleep." or "I am not good enough often
  // comes up with Work, Comparison." The label after "with" is always a
  // capitalized graph-node title; natural English uses lowercase there ("you
  // often come up with reasons"), so matching the uppercase disambiguates.
  /often comes up with [A-Z]/,
]

export function stripConnectionProse(content: string): string {
  return content
    .split('\n')
    .filter((line) => !CONNECTION_LINE.some((re) => re.test(line.trim())))
    .join('\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim()
}
