import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/input.js';

test('discovers literals, attributes every occurrence, merges expectations and round-trips a frozen contract', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'discover-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = path.join(root, 'sdk');
  await mkdir(path.join(sdk, 'dist'), { recursive: true });
  await writeFile(
    path.join(sdk, 'dist', 'ignored.ts'),
    "'https://docs.test/bundled'",
  );
  await writeFile(
    path.join(sdk, 'notes.md'),
    [
      '[guide](https://docs.test/g(u)ide#part)[guide](https://docs.test/g(u)ide?x=1)',
      'See https://docs.test/legacy. Also <https://docs.test/trailing/>',
      'https://docs.test.other/foreign https://u:p@docs.test/private',
      'https://docs.test/users/\${id} https://docs.test//elsewhere.invalid/path',
    ].join('\r\n'),
  );
  const config = path.join(root, 'config.json');
  await writeFile(
    config,
    JSON.stringify({
      site: 'https://docs.test',
      sources: [
        { directory: 'sdk', linkBase: 'https://github.com/o/sdk/blob/abc' },
        'sdk',
      ],
      routes: [{ path: '/legacy', status: 410 }],
    }),
  );
  const inventory = await loadConfig(config);
  const paths = inventory.routes.map((r) => r.path);
  assert.deepEqual(paths, ['/g(u)ide', '/legacy', '/trailing/']);
  const [guide, legacy] = inventory.routes;
  assert.equal(guide.references.length, 2);
  assert.deepEqual(
    guide.references.map((r) => [r.file, r.line, r.column]),
    [
      ['notes.md', 1, 9],
      ['notes.md', 1, 48],
    ],
  );
  assert.equal(legacy.status, 410);
  assert.equal(
    legacy.references[0].url,
    'https://github.com/o/sdk/blob/abc/notes.md#L2',
  );
  await writeFile(config, JSON.stringify(inventory));
  assert.deepEqual(
    JSON.parse(JSON.stringify(await loadConfig(config))),
    JSON.parse(JSON.stringify(inventory)),
  );
});

test('infers GitHub commit permalinks for tracked files in subdirectories', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'discover-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  run('init', '-q');
  run('config', 'core.autocrlf', 'false');
  run('remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
  await mkdir(path.join(root, 'examples'));
  const file = path.join(root, 'examples', 'usage guide.md');
  await writeFile(file, 'title\nhttps://docs.test/widgets\n');
  run('add', 'examples');
  run(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fixture',
  );
  await writeFile(
    path.join(root, 'examples', 'untracked.md'),
    'https://docs.test/untracked',
  );
  const conf = path.join(root, 'config.json');
  await writeFile(
    conf,
    JSON.stringify({ site: 'https://docs.test', sources: ['examples'] }),
  );
  const inventory = await loadConfig(conf);
  assert.equal(inventory.routes.length, 1);
  const ref = inventory.routes[0].references[0];
  assert.equal(ref.file, 'examples/usage guide.md');
  assert.equal(
    ref.url,
    'https://github.com/acme/widgets/blob/' +
      run('rev-parse', 'HEAD') +
      '/examples/usage%20guide.md#L2',
  );
  await writeFile(file, 'line added\ntitle\nhttps://docs.test/widgets\n');
  const modified = (await loadConfig(conf)).routes[0].references[0];
  assert.equal(modified.line, 3);
  assert.equal(modified.url, undefined);
});

test('rejects unsafe permalink metadata and an origin-escaping normalized path', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'bad-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'config.json');
  for (const entry of [
    {
      routes: [
        {
          path: '/x',
          references: [
            { file: 'x', line: 1, column: 1, url: 'javascript:alert(1)' },
          ],
        },
      ],
    },
    {
      sources: [
        { directory: '.', linkBase: 'https://user:secret@github.com/o/r' },
      ],
    },
    { routes: ['/dir/..//outside.example'] },
  ]) {
    await writeFile(
      file,
      JSON.stringify({ site: 'https://docs.test', ...entry }),
    );
    await assert.rejects(loadConfig(file));
  }
});

test('scans a Python SDK and honors per-directory extension selection', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'source-formats-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sdk'));
  await writeFile(
    path.join(root, 'sdk', 'docs.py'),
    'HELP = "https://docs.test/python"',
  );
  await writeFile(
    path.join(root, 'sdk', 'openapi.yaml'),
    'url: https://docs.test/schema',
  );
  const file = path.join(root, 'routes.json');
  async function paths(source) {
    await writeFile(
      file,
      JSON.stringify({ site: 'https://docs.test', sources: [source] }),
    );
    return (await loadConfig(file)).routes.map((r) => r.path);
  }
  assert.deepEqual(await paths('sdk'), ['/python']);
  assert.deepEqual(await paths({ directory: 'sdk', extensions: ['.yaml'] }), [
    '/schema',
  ]);
});
