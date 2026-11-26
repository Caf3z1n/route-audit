#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { audit, exitCode, format } from '../src/audit.js';
import { loadConfig } from '../src/input.js';
import {
  compare,
  comparisonExitCode,
  formatComparison,
} from '../src/compare.js';
import { comparisonMarkdown } from '../src/pr-report.js';

const help = [
  'route-audit [--config routes.json] (--dist dist [--base /docs] | --preview https://preview.example) [--json report.json] [--report-only]',
  'route-audit --discover [--config routes.json] [--json inventory.json]',
  'route-audit --baseline https://docs.example --preview https://preview.example [--config routes.json] [--markdown report.md] [--json comparison.json] [--report-only]',
  'route-audit --demo',
].join('\n');
const json = (data) => JSON.stringify(data, null, 2) + '\n';

try {
  const { values: v } = parseArgs({
    options: {
      config: { type: 'string', default: 'route-audit.json' },
      dist: { type: 'string' },
      preview: { type: 'string' },
      base: { type: 'string' },
      json: { type: 'string' },
      'report-only': { type: 'boolean' },
      demo: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      discover: { type: 'boolean' },
      baseline: { type: 'string' },
      markdown: { type: 'string' },
    },
  });
  if (v.help) console.log(help);
  else if (v.demo) {
    if (process.argv.length !== 3) throw new Error('Run --demo on its own.');
    const { runDemo } = await import('./demo.js');
    process.exitCode = await runDemo();
  } else if (v.discover) {
    if (
      v.dist !== undefined ||
      v.preview !== undefined ||
      v.baseline !== undefined ||
      v.base !== undefined ||
      v.markdown !== undefined ||
      v['report-only']
    )
      throw new Error('--discover accepts only --config and --json.');
    const inventory = await loadConfig(v.config);
    if (v.json) await writeFile(v.json, json(inventory));
    else process.stdout.write(json(inventory));
  } else if (v.baseline !== undefined) {
    if (!v.preview || v.dist !== undefined || v.base !== undefined)
      throw new Error(
        'Comparison requires --baseline and --preview HTTP origins.',
      );
    const report = await compare(v);
    if (v.json) await writeFile(v.json, json(report));
    if (v.markdown) await writeFile(v.markdown, comparisonMarkdown(report));
    console.log(formatComparison(report));
    process.exitCode = comparisonExitCode(report, v['report-only']);
  } else {
    if (v.markdown !== undefined)
      throw new Error('--markdown requires --baseline and --preview.');
    const report = await audit(v);
    if (v.json) await writeFile(v.json, json(report));
    console.log(format(report));
    process.exitCode = exitCode(report, v['report-only']);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
