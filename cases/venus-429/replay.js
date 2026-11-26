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

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const contract = path.join(root, 'examples/venus-429.json');
const [beforeDir, afterDir, outputDir] = process.argv.slice(2);
if (!beforeDir || !afterDir || !outputDir)
  throw new Error('Usage: node replay.js BEFORE_DIR AFTER_DIR OUTPUT_DIR');
const revisions = venusRevisions(beforeDir, afterDir);
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
              new URL(route.location, preview).href,
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
      await closePreview(server);
    }
  }
} finally {
  await rm(controls, { force: true });
  await rmdir(scratch);
}
