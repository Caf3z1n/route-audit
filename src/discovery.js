import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const extensions = new Set([
  '.md',
  '.mdx',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.rst',
]);
const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.astro',
  '.next',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
]);
const slash = (value) => value.split(path.sep).join('/');
const linesFromGit = (output) => output.split('\0').filter(Boolean);

async function git(directory, ...args) {
  const { stdout } = await exec('git', ['-C', directory, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}

async function listWorkingTree(directory) {
  let root;
  try {
    root = (await git(directory, 'rev-parse', '--show-toplevel')).trim();
  } catch (error) {
    if (
      error.code === 'ENOENT' ||
      error.stderr?.includes('not a git repository')
    )
      return;
    throw error;
  }
  const files = linesFromGit(await git(directory, 'ls-files', '-z', '--', '.'));
  // A local checkout without a remote or a commit can still be scanned.
  const [remote, head] = await Promise.all([
    git(directory, 'remote', 'get-url', 'origin').catch(() => ''),
    git(directory, 'rev-parse', '--verify', 'HEAD').catch(() => ''),
  ]);
  const repo =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(
      remote.trim(),
    );
  const linkBase =
    repo && head.trim()
      ? 'https://github.com/' + repo[1] + '/blob/' + head.trim()
      : undefined;
  const changed = linkBase
    ? linesFromGit(
        await git(
          directory,
          'diff',
          '--relative',
          '--no-ext-diff',
          '--name-only',
          '-z',
          'HEAD',
          '--',
          '.',
        ),
      )
    : [];
  return {
    root: await realpath(root),
    files,
    linkBase,
    changed: new Set(changed),
  };
}

async function* walk(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (ignored.has(entry.name)) continue;
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) yield* walk(root, rel);
    else if (entry.isFile()) yield rel;
  }
}

function pathnameForSite(text, site) {
  try {
    const url = new URL(text);
    if (
      url.origin === site &&
      !url.username &&
      !url.password &&
      !url.pathname.startsWith('//')
    )
      return url.pathname;
  } catch {
    /* Malformed prose is not a literal URL. */
  }
}

function* links(line, site) {
  const starts = /https?:\/\//gi;
  for (let match; (match = starts.exec(line));) {
    const start = match.index;
    let end = starts.lastIndex;
    let parentheses = 0,
      brackets = 0;
    for (; end < line.length; end++) {
      const c = line[end];
      if (/[\s<>"'\x60\\]/.test(c)) break;
      if (c === '(') parentheses++;
      if (c === ')' && --parentheses < 0) break;
      if (c === '[') brackets++;
      if (c === ']' && --brackets < 0) break;
    }
    starts.lastIndex = end;
    let raw = line.slice(start, end);
    if (/[{}]/.test(raw)) continue;
    // In bare prose the terminating punctuation belongs to the sentence.
    if (!['(', '<', '"', "'", '\x60'].includes(line[start - 1]))
      raw = raw.replace(/[.,;:!?]+$/, '');
    const pathname = pathnameForSite(raw, site);
    if (pathname) yield { path: pathname, column: start + 1 };
  }
}

function getLinkBase(value) {
  if (value === undefined) return;
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('linkBase must be an HTTPS source directory URL.');
  return url.href.replace(/\/$/, '');
}

export async function discoverSources(sources, configDirectory, site) {
  if (!Array.isArray(sources))
    throw new Error('sources must be an array of directories.');
  const routes = new Map(),
    seenFiles = new Set();
  for (const source of sources) {
    const options = typeof source === 'string' ? { directory: source } : source;
    if (
      !options ||
      typeof options.directory !== 'string' ||
      !options.directory.trim()
    )
      throw new Error('Each source requires a directory.');
    const root = await realpath(
      path.resolve(configDirectory, options.directory),
    );
    if (!(await lstat(root)).isDirectory())
      throw new Error('Expected a source directory: ' + root);
    const customBase = getLinkBase(options.linkBase);
    if (
      options.extensions !== undefined &&
      (!Array.isArray(options.extensions) ||
        !options.extensions.length ||
        options.extensions.some(
          (ext) => typeof ext !== 'string' || !/^\.[a-z0-9]+$/i.test(ext),
        ))
    ) {
      throw new Error(
        'Source extensions must be a non-empty list such as [".ts", ".md"].',
      );
    }
    const allowed = options.extensions
      ? new Set(options.extensions.map((ext) => ext.toLowerCase()))
      : extensions;
    const sourceName = path.isAbsolute(options.directory)
      ? path.basename(root)
      : slash(options.directory);
    const tree = await listWorkingTree(root);
    for await (const rel of tree?.files ?? walk(root)) {
      if (
        !allowed.has(path.extname(rel).toLowerCase()) ||
        rel.split('/').some((p) => ignored.has(p))
      )
        continue;
      const name = path.join(root, rel);
      if (seenFiles.has(name)) continue;
      seenFiles.add(name);
      // Git can list deleted files, submodules, or links. Only read regular files
      // actually inside the selected tree, including when a parent is a symlink.
      if (tree) {
        const info = await lstat(name).catch((error) => {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        });
        if (!info?.isFile()) continue;
        const relative = path.relative(root, await realpath(name));
        if (
          path.isAbsolute(relative) ||
          relative.split(path.sep).includes('..')
        )
          continue;
      }
      const file = tree ? slash(path.relative(tree.root, name)) : rel;
      const base =
        customBase ?? (!tree?.changed.has(rel) ? tree?.linkBase : undefined);
      const encoded = (customBase ? rel : file)
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      const contents = await readFile(name, 'utf8');
      if (contents.includes('\0')) continue;
      const lines = contents.split(/\r\n?|\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const hit of links(lines[i], site)) {
          const reference = {
            source: sourceName,
            file,
            line: i + 1,
            column: hit.column,
          };
          if (base) reference.url = base + '/' + encoded + '#L' + (i + 1);
          if (!routes.has(hit.path)) routes.set(hit.path, []);
          routes.get(hit.path).push(reference);
        }
      }
    }
  }
  return routes;
}
