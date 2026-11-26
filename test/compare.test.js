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
test('CLI distinguishes first-hop, final and historical failures across preview origins', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'route-final-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const routes = [
    {
      path: '/legacy',
      status: 308,
      location: '/step',
      finalLocation: '/guide?rev=1',
    },
    { path: '/untouched', status: 308, location: '/step' },
    { path: '/direct', finalLocation: '/direct#intro' },
    {
      path: '/first',
      status: 308,
      location: '/guide',
      finalLocation: '/guide',
    },
    { path: '/missing', finalLocation: '/guide' },
    { path: '/external', finalLocation: '/guide' },
  ];
  const published = {
    '/legacy': [308, '/step'],
    '/untouched': [308, '/step'],
    '/step': [301, '/guide?rev=1'],
    '/guide?rev=1': [200],
    '/direct': [200],
    '/first': [308, '/step'],
    '/external': [302, 'https://unapproved.invalid/path'],
  };
  const preview = { ...published, '/step': [301, '/'], '/': [200] };
  const baselineUrl = await target(t, published);
  const previewUrl = await target(t, preview);
  // Generate a preview-absolute Location; the contract stays on the public origin.
  preview['/legacy'] = [308, previewUrl + '/step'];
  published['/legacy'] = [308, baselineUrl + '/step'];
  await writeFile(
    path.join(root, 'route-audit.json'),
    JSON.stringify({ site: 'https://docs.test', routes }),
  );
  assert.equal(
    (await command(root, '--discover', '--json', 'inventory.json')).code,
    0,
  );
  const r = await command(
    root,
    '--config',
    'inventory.json',
    '--baseline',
    baselineUrl,
    '--preview',
    previewUrl,
    '--json',
    'report.json',
    '--markdown',
    'report.md',
  );
  assert.equal(r.code, 2); // the unapproved external hop remains inconclusive
  const report = JSON.parse(
    await readFile(path.join(root, 'report.json'), 'utf8'),
  );
  const byPath = new Map(report.results.map((row) => [row.path, row]));
  assert.equal(byPath.get('/legacy').classification, 'regression');
  assert.equal(
    byPath.get('/legacy').expectedFinalLocation,
    'https://docs.test/guide?rev=1',
  );
  assert.equal(byPath.get('/legacy').preview.reason, 'wrong-final-destination');
  assert.equal(
    byPath.get('/legacy').preview.trace.at(-1).url,
    'https://docs.test/',
  );
  assert.equal(byPath.get('/untouched').classification, 'passing');
  assert.equal(byPath.get('/direct').classification, 'passing');
  assert.equal(byPath.get('/first').preview.reason, 'wrong-destination');
  assert.equal(byPath.get('/missing').preview.reason, 'missing');
  assert.equal(
    byPath.get('/external').preview.reason,
    'external-target-not-checked',
  );
  const md = await readFile(path.join(root, 'report.md'), 'utf8');
  assert.match(md, /Expected final: <code>\/guide<\/code>/);
  assert.doesNotMatch(md, /rev=1/);
});
test('HTTP follows an explicitly expected external final origin and preserves the boundary at further hops', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'route-external-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cdn = await target(t, {
    '/guide': [200],
    '/moved': [301, 'https://unapproved.invalid/'],
  });
  const preview = await target(t, {
    '/ok': [302, cdn + '/guide'],
    '/extra': [302, cdn + '/moved'],
  });
  await writeFile(
    path.join(root, 'route-audit.json'),
    JSON.stringify({
      site: 'https://docs.test',
      routes: ['/ok', '/extra'].map((path) => ({
        path,
        finalLocation: cdn + '/guide',
      })),
    }),
  );
  const r = await command(root, '--preview', preview, '--json', 'report.json');
  assert.equal(r.code, 2);
  const { results } = JSON.parse(
    await readFile(path.join(root, 'report.json'), 'utf8'),
  );
  assert.equal(results[0].outcome, 'pass');
  assert.equal(results[1].reason, 'external-target-not-checked');
  assert.equal(results[1].trace.length, 2);
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
