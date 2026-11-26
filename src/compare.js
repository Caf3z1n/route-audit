import { auditContract } from './audit.js';
import { loadConfig, origin } from './input.js';

function change(before, after) {
  if (before === 'unknown' || after === 'unknown') return 'inconclusive';
  if (before === 'pass') return after === 'fail' ? 'regression' : 'passing';
  return after === 'fail' ? 'existing' : 'fixed';
}

function observation({ outcome, reason, trace, detail }) {
  return { outcome, reason, trace, ...(detail && { detail }) };
}

export async function compare({ config, baseline, preview }) {
  const published = origin(baseline),
    candidate = origin(preview);
  const contract = await loadConfig(config);
  // Both targets must be measured against the same inventory, including the
  // exact revision and line information recorded during discovery.
  const beforeJob = auditContract(contract, { preview: published });
  // Keep each host sequential, even when both origins are the same.
  if (published === candidate) await beforeJob;
  const [before, after] = await Promise.all([
    beforeJob,
    auditContract(contract, { preview: candidate }),
  ]);
  const summary = {
    total: contract.routes.length,
    regression: 0,
    existing: 0,
    fixed: 0,
    passing: 0,
    inconclusive: 0,
  };
  const results = contract.routes.map((rule, index) => {
    const baselineResult = observation(before.results[index]);
    const previewResult = observation(after.results[index]);
    const classification = change(
      baselineResult.outcome,
      previewResult.outcome,
    );
    summary[classification]++;
    return {
      path: rule.path,
      expected: rule.status ?? 'reachable',
      ...(rule.location && { expectedLocation: rule.location }),
      references: rule.references ?? [],
      classification,
      baseline: baselineResult,
      preview: previewResult,
    };
  });
  return {
    mode: 'compare',
    timestamp: after.timestamp,
    site: contract.site,
    baseline: published,
    preview: candidate,
    summary,
    results,
  };
}

export function comparisonExitCode({ summary }, reportOnly = false) {
  if (summary.inconclusive) return 2;
  return summary.regression && !reportOnly ? 1 : 0;
}

export function formatComparison({ summary, results }) {
  const lines = [
    `compare: ${summary.regression} new, ${summary.existing} existing, ${summary.fixed} fixed, ${summary.passing} passing, ${summary.inconclusive} inconclusive.`,
  ];
  for (const row of results) {
    if (!['regression', 'inconclusive'].includes(row.classification)) continue;
    const statuses = (result) =>
      result.trace.map((hop) => hop.status).join('->') || result.reason;
    lines.push(
      [
        row.classification,
        row.path,
        statuses(row.baseline) + ' vs ' + statuses(row.preview),
        row.preview.reason,
        `${row.references.length} reference(s)`,
      ].join('  '),
    );
  }
  return lines.join('\n');
}
