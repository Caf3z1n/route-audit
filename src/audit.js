import path from 'node:path';
import { loadConfig, origin } from './input.js';
import { httpTarget, staticTarget } from './targets.js';
import { compareDestinations, expectedAtOrigin } from './destinations.js';

const redirects = new Set(['meta', 301, 302, 303, 307, 308]);
const maxRedirects = 10;

function unavailable(status) {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

async function check(rule, { site, preview, read }) {
  const trace = [];
  const visited = new Set();
  const contractUrl = new URL(rule.path, site);
  const requestedUrl = new URL(rule.path, preview ?? site);
  let current = requestedUrl;

  function result(outcome, reason, extra) {
    return {
      path: rule.path,
      expected: rule.status ?? 'reachable',
      ...(rule.location && { expectedLocation: rule.location }),
      ...(rule.finalLocation && { expectedFinalLocation: rule.finalLocation }),
      ...(rule.references?.length && { references: rule.references }),
      outcome,
      reason,
      trace,
      ...extra,
    };
  }

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      current.hash = '';
      if (visited.has(current.href)) return result('fail', 'redirect-loop');
      visited.add(current.href);

      const { status, location } = await read(current);
      trace.push({ url: current.href, status, ...(location && { location }) });
      if (preview && unavailable(status))
        return result('unknown', 'http-unavailable');

      if (hop === 0 && rule.status !== undefined) {
        if (!preview) return result('unknown', 'requires-http-status');
        if (status !== rule.status) return result('fail', 'wrong-status');
        if (status === 410) return result('pass', 'gone-as-expected');
      }
      if (status === 200) {
        if (rule.finalLocation) {
          const final = compareDestinations({
            requestedUrl,
            baselineUrl: contractUrl,
            expected: rule.finalLocation,
            observed: current,
          });
          if (final.outcome !== 'pass')
            return result(final.outcome, final.reason, {
              expectedAtTarget: final.expected,
            });
        }
        return result('pass', hop ? 'redirect-resolves' : 'present');
      }
      if (!redirects.has(status))
        return result('fail', status === 404 ? 'missing' : 'unreachable');
      if (!location) return result('fail', 'missing-location');

      const destination = new URL(location, current);
      if (
        hop === 0 &&
        rule.location &&
        destination.href !==
          expectedAtOrigin(
            new URL(rule.location, contractUrl),
            site,
            requestedUrl.origin,
          )
      ) {
        return result('fail', 'wrong-destination');
      }
      if (
        !['https:', 'http:'].includes(destination.protocol) ||
        destination.username ||
        destination.password
      ) {
        return result('fail', 'invalid-destination');
      }
      if (
        destination.origin !== requestedUrl.origin &&
        destination.origin !== site &&
        (!preview ||
          ![rule.location, rule.finalLocation].some(
            (allowed) =>
              allowed &&
              destination.origin === new URL(allowed, contractUrl).origin,
          ))
      ) {
        return result('unknown', 'external-target-not-checked');
      }
      current = destination;
    }
    return result('fail', 'too-many-redirects');
  } catch (error) {
    return result('unknown', 'read-error', {
      detail: error.cause?.code ?? error.message,
    });
  }
}

export async function audit(options) {
  const { dist, preview, base = '/' } = options;
  if (Boolean(dist) === Boolean(preview))
    throw new Error('Choose exactly one audit target (--dist or --preview).');
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base))
    throw new Error('Invalid static base path.');

  return auditContract(await loadConfig(options.config), options);
}

export async function auditContract(
  { site, routes },
  { dist, preview, base = '/' },
) {
  if (preview) preview = origin(preview);
  const read = preview ? httpTarget : await staticTarget(dist, base);
  const context = { site, preview, read };
  const results = [];
  // Keep request order deterministic and avoid bursts against public previews.
  for (const rule of routes) results.push(await check(rule, context));
  const summary = { total: results.length, pass: 0, fail: 0, unknown: 0 };
  for (const row of results) summary[row.outcome]++;
  return {
    timestamp: new Date().toISOString(),
    mode: preview ? 'http' : 'static',
    target: preview ?? path.basename(path.resolve(dist)),
    site,
    summary,
    results,
  };
}

export function exitCode(report, reportOnly = false) {
  if (report.summary.unknown) return 2;
  return report.summary.fail && !reportOnly ? 1 : 0;
}

export function format({ mode, summary, results }) {
  const lines = [
    `${mode}: ${summary.pass}/${summary.total} OK, ${summary.fail} failed, ${summary.unknown} inconclusive.`,
  ];
  for (const row of results) {
    if (row.outcome === 'pass') continue;
    const expected = [row.expected, row.expectedLocation]
      .filter(Boolean)
      .join(' ');
    const observed = row.trace
      .map((hop) => [hop.status, hop.location].filter(Boolean).join(' '))
      .join(' -> ');
    lines.push(
      [
        row.outcome,
        row.path,
        'expected=' + expected,
        'observed=' + (observed || 'unavailable'),
        row.reason,
        row.reason === 'wrong-final-destination' &&
          'expectedFinal=' +
            row.expectedAtTarget +
            '  actualFinal=' +
            row.trace.at(-1).url,
        row.detail,
      ]
        .filter(Boolean)
        .join('  '),
    );
  }
  return lines.join('\n');
}
