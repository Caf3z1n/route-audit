import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { comparisonMarkdown } from '../src/index.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

async function target(t, responses) {
  const server = createServer((req, res) => {
    const [status, location] = responses[req.url] ?? [404];
    res.writeHead(status, location ? { location } : {}).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return 'http://127.0.0.1:' + server.address().port;
}
async function command(cwd, ...args) {
  try {
    return {
      ...(await exec(process.execPath, [cli, ...args], { cwd })),
      code: 0,
    };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return error;
  }
}
test('CLI compares a single attributed inventory, writes the PR report and applies the CI exit policy', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'route-comparison-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sdk'));
  const routes = ['/new', '/old', '/fixed', '/stable', '/uncertain'];
  const sdk = path.join(root, 'sdk', 'example.md');
  await writeFile(
    sdk,
    routes
      .map((p) => 'https://docs.test' + p)
      .concat('https://docs.test/new')
      .join('\n'),
  );
  const config = path.join(root, 'route-audit.json');
  await writeFile(
    config,
    JSON.stringify({
      site: 'https://docs.test',
      sources: [
        { directory: 'sdk', linkBase: 'https://github.com/acme/sdk/blob/abc' },
      ],
    }),
  );
  const before = await target(t, {
    '/new': [308, '/working'],
    '/working': [200],
    '/stable': [200],
    '/uncertain': [503],
  });
  const after = await target(t, {
    '/new': [308, '/broken'],
    '/fixed': [200],
    '/stable': [200],
  });
  const inventory = path.join(root, 'inventory.json');
  assert.equal(
    (await command(root, '--discover', '--json', inventory)).code,
    0,
  );
  const args = [
    '--baseline',
    before,
    '--preview',
    after,
    '--config',
    inventory,
    '--json',
    'results.json',
    '--markdown',
    'summary.md',
  ];
  async function run(extra = []) {
    const result = await command(root, ...args, ...extra);
    return [
      result.code,
      JSON.parse(await readFile(path.join(root, 'results.json'), 'utf8')),
      await readFile(path.join(root, 'summary.md'), 'utf8'),
    ];
  }
  const [exit, report, md] = await run();
  assert.equal(exit, 2);
  assert.deepEqual(report.summary, {
    total: 5,
    regression: 1,
    existing: 1,
    fixed: 1,
    passing: 1,
    inconclusive: 1,
  });
  const row = report.results.find((r) => r.classification === 'regression');
  assert.equal(row.references.length, 2);
  assert.deepEqual(
    row.baseline.trace.map((h) => h.status),
    [308, 200],
  );
  assert.deepEqual(
    row.preview.trace.map((h) => h.status),
    [308, 404],
  );
  assert.match(md, /2 source references/);
  assert.match(md, /example\.md#L1/);
  assert.match(md, /404 \/broken/);
  assert.match(md, /Existing failures/);
  const subset = JSON.parse(await readFile(inventory, 'utf8'));
  subset.routes = subset.routes.filter((r) => r.path !== '/uncertain');
  await writeFile(inventory, JSON.stringify(subset));
  assert.equal((await run())[0], 1);
  assert.equal((await run(['--report-only']))[0], 0);
  subset.routes = subset.routes.filter((r) => r.path !== '/new');
  await writeFile(inventory, JSON.stringify(subset));
  assert.equal((await run())[0], 0);
  assert.equal(
    (await command(root, '--baseline', before, '--dist', 'dist')).code,
    2,
  );
  assert.equal((await command(root, '--discover', '--preview', after)).code, 2);
});
test('PR Markdown bounds large reports and safely displays untrusted text and redirect targets', () => {
  const path = '/bad?<secret>';
  const one = {
    path,
    classification: 'regression',
    references: [
      {
        file: 'a<&>.md',
        line: 2,
        url: 'https://github.com/a/b/blob/a/doc.md#L2',
      },
    ],
    baseline: { trace: [{ url: 'https://docs.test/bad?secret', status: 200 }] },
    preview: {
      reason: 'wrong-destination',
      trace: [
        {
          url: 'https://docs.test/bad',
          status: 301,
          location: 'https://elsewhere.test/wrong?secret',
        },
      ],
    },
  };
  const results = Array.from({ length: 70 }, () => one);
  const markdown = comparisonMarkdown({
    site: 'https://docs.test',
    summary: {
      regression: 70,
      existing: 0,
      fixed: 0,
      passing: 0,
      inconclusive: 0,
    },
    results,
  });
  assert.match(markdown, /62 additional/);
  assert.match(markdown, /a&lt;&amp;&gt;\.md/);
  assert.match(markdown, /elsewhere\.test\/wrong/);
  assert.doesNotMatch(markdown, /secret/);
});
