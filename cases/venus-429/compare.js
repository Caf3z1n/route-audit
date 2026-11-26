import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { venusRevisions, startPreview, closePreview } from './preview.js';

const run = promisify(execFile);
const [beforeDir, afterDir, sdk, output] = process.argv.slice(2);
if (!beforeDir || !afterDir || !sdk || !output)
  throw new Error(
    'Usage: node compare.js BEFORE_DIR AFTER_DIR VIPS_CHECKOUT OUTPUT_DIR',
  );
const revision = '19a7e734d4cd793c39ed3f447e90dcd57648139a';
assert.equal(
  (await run('git', ['-C', sdk, 'rev-parse', 'HEAD'])).stdout.trim(),
  revision,
);
assert.equal(
  (
    await run('git', ['-C', sdk, 'status', '--porcelain', '--', 'vips'])
  ).stdout.trim(),
  '',
);
const cli = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
const folder = path.resolve(output);
await mkdir(folder, { recursive: true });
const scratch = await mkdtemp(path.join(tmpdir(), 'venus-discovery-'));
const config = path.join(scratch, 'route-audit.json');
const servers = [];
try {
  await writeFile(
    config,
    JSON.stringify({
      site: 'https://docs-v4.venus.io',
      sources: [path.resolve(sdk, 'vips')],
    }),
  );
  const inventory = path.join(folder, 'inventory.json');
  await run(process.execPath, [
    cli,
    '--discover',
    '--config',
    config,
    '--json',
    inventory,
  ]);
  const { routes } = JSON.parse(await readFile(inventory, 'utf8'));
  assert.equal(routes.length, 31);
  assert.equal(routes.flatMap((r) => r.references).length, 360);
  for (const revision of venusRevisions(beforeDir, afterDir))
    servers.push(await startPreview(revision));
  const [before, after] = servers.map(
    (s) => 'http://127.0.0.1:' + s.address().port,
  );
  // Put the fixed site on the baseline side for the rollback control. The
  // actual upstream PR fixes six old routes; it never introduced these 404s.
  for (const [name, baseline, preview, kind, code] of [
    ['fix', before, after, 'fixed', 0],
    ['rollback', after, before, 'regression', 1],
    ['existing', before, before, 'existing', 0],
  ]) {
    const json = path.join(folder, name + '.json'),
      md = path.join(folder, name + '.md');
    let actual = 0;
    try {
      await run(process.execPath, [
        cli,
        '--config',
        inventory,
        '--baseline',
        baseline,
        '--preview',
        preview,
        '--json',
        json,
        '--markdown',
        md,
      ]);
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      actual = error.code;
    }
    assert.equal(actual, code);
    const report = JSON.parse(await readFile(json, 'utf8'));
    assert.equal(report.summary[kind], 6);
    assert.equal(report.summary.passing, 25);
    assert.equal(report.summary.inconclusive, 0);
    const hits = report.results
      .filter((r) => r.classification === kind)
      .flatMap((r) => r.references);
    assert.equal(hits.length, 92);
    assert.equal(new Set(hits.map((r) => r.file)).size, 90);
    assert.ok(
      hits.every((r) => r.url?.includes('/blob/' + revision + '/vips/')),
    );
    console.log(name, report.summary, 'exit', actual);
  }
} finally {
  await Promise.all(servers.map(closePreview));
  await rm(config, { force: true });
  await rmdir(scratch);
}
