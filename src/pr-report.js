// Render untrusted paths and source filenames as text inside the PR comment.
const entities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function html(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[&<>"']/g, (character) => entities[character]);
}
function code(value) {
  const text = String(value);
  return (
    '<code>' +
    html(text.length > 180 ? text.slice(0, 179) + '…' : text) +
    '</code>'
  );
}
function displayUrl(url, site) {
  return (url.origin === site ? '' : url.origin) + url.pathname;
}
function chain(check, site) {
  if (!check.trace.length) return code(check.reason);
  const hops = check.trace.map((hop) =>
    code(hop.status + ' ' + displayUrl(new URL(hop.url), site)),
  );
  const last = check.trace.at(-1);
  if (last.location) {
    try {
      hops.push(code(displayUrl(new URL(last.location, last.url), site)));
    } catch {
      hops.push(code('invalid Location'));
    }
  }
  return hops.join(' → ');
}
function source(ref) {
  const label = code(ref.file + ':' + ref.line);
  if (!ref.url || ref.url.length > 2048 || !/^https:\/\//i.test(ref.url))
    return label;
  return '<a href="' + html(ref.url) + '">' + label + '</a>';
}
export function comparisonMarkdown(report) {
  const { summary: s } = report;
  const lines = [
    '## Route Audit',
    '',
    [
      s.regression +
        (s.regression === 1 ? ' new regression' : ' new regressions'),
      s.existing +
        (s.existing === 1 ? ' existing failure' : ' existing failures'),
      s.fixed + ' fixed',
      s.passing + ' passing',
      s.inconclusive + ' inconclusive',
    ].join(' · '),
  ];
  const findings = report.results
    .filter((row) => row.classification === 'regression')
    .sort((a, b) => b.references.length - a.references.length);
  let shown = 0,
    bytes = 0;
  for (const row of findings.slice(0, 8)) {
    const count = row.references.length;
    const ref = row.references.find((r) => r.url) ?? row.references[0];
    const refs = count + ' source reference' + (count === 1 ? '' : 's');
    const block = [
      '',
      '- ' +
        code(row.path.split('?')[0]) +
        ' — ' +
        refs +
        (ref ? ' · ' + source(ref) : ''),
      '  - Published: ' + chain(row.baseline, report.site),
      '  - Preview: ' +
        chain(row.preview, report.site) +
        ' (' +
        html(row.preview.reason) +
        ')',
      ...(row.expectedFinalLocation
        ? [
            '  - Expected final: ' +
              code(displayUrl(new URL(row.expectedFinalLocation), report.site)),
          ]
        : []),
    ].join('\n');
    bytes += Buffer.byteLength(block);
    if (bytes > 32_000) break;
    lines.push(block);
    shown++;
  }
  if (findings.length > shown)
    lines.push(
      '',
      findings.length -
        shown +
        ' additional regressions omitted from this summary.',
    );
  for (const [kind, title] of [
    ['existing', 'Existing failures'],
    ['inconclusive', 'Inconclusive checks'],
  ]) {
    if (!s[kind]) continue;
    lines.push(
      '',
      '<details><summary>' + title + ' (' + s[kind] + ')</summary>',
      '',
    );
    for (const row of report.results
      .filter((r) => r.classification === kind)
      .slice(0, 4)) {
      lines.push(
        '- ' +
          code(row.path.split('?')[0]) +
          ' — ' +
          html(row.baseline.reason) +
          ' → ' +
          html(row.preview.reason),
      );
    }
    if (s[kind] > 4) lines.push('- ' + (s[kind] - 4) + ' more.');
    lines.push('', '</details>');
  }
  return lines.join('\n') + '\n';
}
