import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
async function project(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'route-init-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    run: (...args) =>
      exec(process.execPath, [cli, ...args], { cwd: root, timeout: 15000 }),
  };
}
async function serve(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return 'http://127.0.0.1:' + server.address().port;
}
const index = (...urls) =>
  '<sitemapindex>' +
  urls.map((u) => '<sitemap><loc>' + u + '</loc></sitemap>').join('') +
  '</sitemapindex>';
const pages = (...urls) =>
  '<urlset>' +
  urls.map((u) => '<url><loc>' + u + '</loc></url>').join('') +
  '</urlset>';

test('init freezes published paths and audits a prefixed build from the saved config', async (t) => {
  const { root, run } = await project(t);
  const hits = [];
  const site = await serve(t, (req, res) => {
    hits.push(req.url);
    switch (req.url) {
      case '/robots.txt':
        return res.end('Sitemap: ' + site + '/index.xml');
      case '/index.xml':
        return res.end(index(site + '/nested.xml', site + '/pages.xml.gz'));
      case '/nested.xml':
        return res.end(index(site + '/index.xml', site + '/pages.xml.gz'));
      case '/pages.xml.gz':
        return res.end(
          gzipSync(
            pages(
              site + '/docs/',
              site + '/docs/old',
              site + '/docs/',
              site + '/other',
            ),
          ),
        );
      default:
        return res.writeHead(404).end();
    }
  });
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/index.html'), '<title>Home</title>');
  const { stdout } = await run('init', '--site', site + '/docs/');
  assert.match(stdout, /2 published URLs/);
  assert.match(stdout, /static: 1\/2 OK, 1 failed/);
  assert.match(stdout, /fail  \/docs\/old/);
  const saved = await readFile(path.join(root, 'route-audit.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), {
    site,
    base: '/docs/',
    routes: ['/docs/', '/docs/old'],
  });
  assert.deepEqual(hits, [
    '/robots.txt',
    '/index.xml',
    '/nested.xml',
    '/pages.xml.gz',
  ]);
  const count = hits.length;
  await assert.rejects(
    run('init'),
    (e) => e.code === 2 && e.stderr.includes('already exists'),
  );
  await assert.rejects(
    run('--dist', 'dist'),
    (e) => e.code === 1 && e.stdout.includes('1/2 OK'),
  );
  assert.equal(hits.length, count);
  assert.equal(
    await readFile(path.join(root, 'route-audit.json'), 'utf8'),
    saved,
  );
});

test('partial sitemap failures leave no config; concurrent retries keep one complete snapshot', async (t) => {
  const { root, run } = await project(t);
  let ready = false;
  const site = await serve(t, (req, res) => {
    if (req.url === '/sitemap-index.xml')
      return res.end(index(site + '/part.xml'));
    if (req.url === '/part.xml' && ready)
      return res.end(pages(site + '/guide'));
    res.writeHead(404).end();
  });
  await assert.rejects(
    run('init', '--site', site),
    (e) => e.code === 2 && e.stderr.includes('/part.xml'),
  );
  assert.deepEqual(await readdir(root), []);
  ready = true;
  const results = await Promise.allSettled([
    run('init', '--site', site),
    run('init', '--site', site),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.match(
    results.find((x) => x.status === 'fulfilled').value.stdout,
    /After building your site/,
  );
  assert.match(
    results.find((x) => x.status === 'rejected').reason.stderr,
    /already exists/,
  );
  assert.deepEqual(await readdir(root), ['route-audit.json']);
});

test('the build can identify the origin, but only the published sitemap supplies the snapshot', async (t) => {
  const { root, run } = await project(t);
  const site = await serve(t, (req, res) => {
    if (req.url === '/sitemap.xml') return res.end(pages(site + '/previous'));
    res.end('<!DOCTYPE html><title>Home</title>');
  });
  await mkdir(path.join(root, 'build'));
  await writeFile(path.join(root, 'build/sitemap.xml'), pages(site + '/new'));
  const { stdout } = await run('init', '--dist', 'build');
  assert.match(stdout, /1 failed/);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, 'route-audit.json'), 'utf8'))
      .routes,
    ['/previous'],
  );
});

test('init can use a custom sitemap and refuses a redirect to an unrelated origin', async (t) => {
  const { root, run } = await project(t);
  let visits = 0;
  const other = await serve(t, (_req, res) => {
    visits++;
    res.end();
  });
  const site = await serve(t, (req, res) => {
    if (req.url === '/bad')
      return res.writeHead(301, { location: other + '/other.xml' }).end();
    if (req.url === '/latest')
      return res.writeHead(301, { location: '/published.xml' }).end();
    res.end(pages(site + '/only'));
  });
  await assert.rejects(
    run('init', '--sitemap', site + '/bad'),
    (e) => e.code === 2,
  );
  assert.equal(visits, 0);
  assert.deepEqual(await readdir(root), []);
  await run('init', '--sitemap', site + '/latest');
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, 'route-audit.json'), 'utf8'))
      .routes,
    ['/only'],
  );
});
