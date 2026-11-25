import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { audit, exitCode } from '../src/audit.js';
import integrate from '../src/astro.js';
import { pathToFileURL } from 'node:url';

async function workspace(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'route-audit-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  async function put(name, data) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      typeof data === 'string' ? data : JSON.stringify(data),
    );
    return file;
  }
  return { dir, put };
}
test('static build: index, preserved, missing, redirects, loop, base and HTTP-only rule', async (t) => {
  const { dir, put } = await workspace(t);
  const urls = ['', 'page', 'missing', 'old', 'loop', 'gone'];
  await put(
    'sitemap.xml',
    '<sitemapindex><sitemap><loc>https://docs.test/pages.xml</loc></sitemap></sitemapindex>',
  );
  await put(
    'pages.xml',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls
        .map((s) => '<url><loc>https://docs.test/docs/' + s + '</loc></url>')
        .join('') +
      '</urlset>',
  );
  const config = await put('config.json', {
    site: 'https://docs.test',
    sitemaps: ['sitemap.xml'],
    routes: [{ path: '/docs/gone', status: 410 }],
  });
  await put('dist/index.html', 'home');
  await put('dist/page/index.html', 'body');
  await put(
    'dist/old/index.html',
    '<head><META content="0; URL=/docs/page" HTTP-EQUIV="Refresh"></head>',
  );
  await put(
    'dist/loop/index.html',
    '<meta http-equiv=refresh content="0; url=/docs/loop">',
  );
  const out = await audit({
    config,
    dist: path.join(dir, 'dist'),
    base: '/docs',
  });
  assert.deepEqual(out.summary, { total: 6, pass: 3, fail: 2, unknown: 1 });
  assert.deepEqual(
    out.results.map((r) => r.reason),
    [
      'present',
      'present',
      'missing',
      'redirect-resolves',
      'redirect-loop',
      'requires-http-status',
    ],
  );
  assert.equal(exitCode(out), 2);
});
test('HTTP checks status, location and final response; blocks unapproved cross-origin redirects', async (t) => {
  const { put } = await workspace(t);
  const answers = {
    '/old': [301, '/new'],
    '/wrong': [302, '/new'],
    '/bad': [301, '/oops'],
    '/new': [200],
    '/gone': [410],
    '/still': [200],
    '/loop': [301, '/loop'],
    '/external': [302, 'https://elsewhere.invalid/a'],
    '/unavailable': [503],
  };
  const server = createServer((req, res) => {
    const [code, location] =
      req.url === '/absolute'
        ? [301, 'http://' + req.headers.host + '/new']
        : (answers[req.url] ?? [404]);
    res.writeHead(code, location ? { Location: location } : {});
    res.end('test');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const rules = [
    ...['/old', '/absolute', '/wrong', '/bad'].map((path) => ({
      path,
      status: 301,
      location: '/new',
    })),
    { path: '/gone', status: 410 },
    { path: '/still', status: 410 },
    '/loop',
    '/external',
    '/unavailable',
    '/missing',
  ];
  const config = await put('config.json', {
    site: 'https://original.test',
    routes: rules,
  });
  const out = await audit({
    config,
    preview: 'http://127.0.0.1:' + server.address().port,
  });
  assert.deepEqual(
    out.results.map((r) => r.reason),
    [
      'redirect-resolves',
      'redirect-resolves',
      'wrong-status',
      'wrong-destination',
      'gone-as-expected',
      'wrong-status',
      'redirect-loop',
      'external-target-not-checked',
      'http-unavailable',
      'missing',
    ],
  );
  assert.deepEqual(
    out.results[0].trace.map((h) => h.status),
    [301, 200],
  );
  assert.deepEqual(out.summary, { total: 10, pass: 3, fail: 5, unknown: 2 });
});
test('Astro hook resolves project-relative config and enforces check/report-only', async (t) => {
  const { dir, put } = await workspace(t);
  await put('route-audit.json', {
    site: 'https://docs.test',
    routes: ['/missing'],
  });
  await put('dist/index.html', 'home');
  for (const reportOnly of [false, true]) {
    const hooks = integrate({ reportOnly }).hooks;
    hooks['astro:config:done']({
      config: { root: pathToFileURL(dir + '/'), base: '/', output: 'static' },
    });
    const run = hooks['astro:build:done']({
      dir: pathToFileURL(dir + '/dist/'),
      logger: { info() {} },
    });
    if (reportOnly) await run;
    else await assert.rejects(run, /Route audit/);
  }
});
test('rejects an empty or foreign baseline and ambiguous targets', async (t) => {
  const { dir, put } = await workspace(t);
  const config = await put('r.json', {
    site: 'https://docs.test',
    sitemaps: ['s.xml'],
  });
  await put(
    's.xml',
    '<urlset><url><loc>https://other.test/a</loc></url></urlset>',
  );
  await assert.rejects(
    audit({ config, dist: dir }),
    /Unexpected sitemap origin/,
  );
  await put('s.xml', '<urlset/>');
  await assert.rejects(audit({ config, dist: dir }), /empty sitemap/);
  await assert.rejects(
    audit({ config, dist: dir, preview: 'http://localhost' }),
    /exactly one/,
  );
});

test('HTML fast path still detects encoded refresh directives and ignores script text', async (t) => {
  const { dir, put } = await workspace(t);
  const config = await put('config.json', {
    site: 'https://docs.test',
    routes: ['/encoded', '/done', '/plain'],
  });
  await put(
    'encoded/index.html',
    '<meta content="0;url=/done" http-equiv="&#x72;efresh">',
  );
  await put('done/index.html', '<title>Done</title>');
  await put(
    'plain/index.html',
    "<script>const example = '<meta http-equiv=refresh content=0>';</script>",
  );
  const report = await audit({ config, dist: dir });
  assert.deepEqual(
    report.results.map((row) => row.reason),
    ['redirect-resolves', 'present', 'present'],
  );
  assert.equal(report.results[0].trace[1].url, 'https://docs.test/done');
});
