import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import routing from '@vercel/routing-utils';
import serve from 'serve-handler';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const contract = path.join(root, 'examples/venus-429.json');
const [beforeDir, afterDir, outputDir] = process.argv.slice(2);
if (!beforeDir || !afterDir || !outputDir)
  throw new Error('Usage: node replay.js BEFORE_DIR AFTER_DIR OUTPUT_DIR');
const revisions = [
  {
    label: 'before',
    dir: beforeDir,
    sha: '39e5696577d089a207c671997acf996969ff67f5',
    configHash:
      '8246bfaa4b0b2298fb92ee522f3c0b45e97e22c252c5bf8710980e382e67fc26',
  },
  {
    label: 'after',
    dir: afterDir,
    sha: '46866f830f44b728cb732b77d0630cea7caec5cb',
    configHash:
      '3915dd241989474aea68e43820cecaa50439124908e9fcb018c08a587ced523e',
  },
];
const expected = JSON.parse(await readFile(contract, 'utf8'));
const scratch = await mkdtemp(path.join(tmpdir(), 'venus-controls-'));
const controls = path.join(scratch, 'controls.json');
await writeFile(
  controls,
  JSON.stringify({
    site: expected.site,
    routes: expected.routes.map(({ location }) => ({
      path: location,
      status: 200,
    })),
  }),
);
await mkdir(outputDir, { recursive: true });

async function startPreview(revision) {
  const text = (
    await readFile(path.join(revision.dir, 'vercel.json'), 'utf8')
  ).replaceAll('\r\n', '\n');
  assert.equal(
    createHash('sha256').update(text).digest('hex'),
    revision.configHash,
    'Unexpected upstream routing configuration',
  );
  const { redirects, trailingSlash } = JSON.parse(text);
  const converted = routing.getTransformedRoutes({ redirects, trailingSlash });
  if (converted.error) throw new Error(converted.error.message);
  // The pinned configurations have unconditional redirects. The remote edge,
  // response headers and deployment authentication are outside this replay.
  const rules = converted.routes.map((route) => {
    assert.ok(
      route.headers?.Location && route.status && !route.has && !route.missing,
    );
    return {
      pattern: new RegExp(route.src),
      location: route.headers.Location,
      status: route.status,
    };
  });
  const dist = path.resolve(revision.dir, 'dist');
  await readFile(path.join(dist, 'index.html'));
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      for (const rule of rules) {
        if (!rule.pattern.test(pathname)) continue;
        res
          .writeHead(rule.status, {
            Location: pathname.replace(rule.pattern, rule.location),
          })
          .end();
        return;
      }
      await serve(req, res, {
        public: dist,
        cleanUrls: true,
        trailingSlash: false,
        directoryListing: false,
      });
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
async function runCli(config, preview, file, expectedExit) {
  let code = 0;
  try {
    await exec(process.execPath, [
      path.join(root, 'bin/cli.js'),
      '--config',
      config,
      '--preview',
      preview,
      '--json',
      file,
    ]);
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    code = error.code;
  }
  assert.equal(code, expectedExit, 'Unexpected CLI exit code for ' + file);
  return JSON.parse(await readFile(file, 'utf8'));
}
try {
  for (const revision of revisions) {
    const server = await startPreview(revision);
    const preview = 'http://127.0.0.1:' + server.address().port;
    const before = revision.label === 'before';
    try {
      for (const control of [true, false]) {
        const filename = path.resolve(
          outputDir,
          revision.label + (control ? '-controls' : '') + '.json',
        );
        const exit = !control && before ? 1 : 0;
        const report = await runCli(
          control ? controls : contract,
          preview,
          filename,
          exit,
        );
        assert.equal(report.results.length, 6);
        for (const [i, row] of report.results.entries()) {
          const route = expected.routes[i];
          assert.equal(row.path, control ? route.location : route.path);
          assert.equal(row.outcome, exit ? 'fail' : 'pass');
          assert.deepEqual(
            row.trace.map((hop) => hop.status),
            control ? [200] : before ? [404] : [308, 200],
          );
          if (!control && !before)
            assert.equal(
              row.trace[1].url,
              new URL(route.location, expected.site).href,
            );
        }
        report.replay = {
          commit: revision.sha,
          configSha256: revision.configHash,
          environment:
            'local HTTP replay of built HTML and pinned Vercel redirects',
          cliExitCode: exit,
        };
        await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
        console.log(path.basename(filename), report.summary);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
} finally {
  await rm(controls, { force: true });
  await rmdir(scratch);
}
