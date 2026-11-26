import {
  link,
  lstat,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditContract, exitCode, format } from './audit.js';
import { publishedRoutes } from './published-sitemap.js';
import { staticBase } from './input.js';
import { parseLocations } from './sitemap.js';

async function existing(file, lookup = stat) {
  try {
    return await lookup(file);
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
}

async function astroSettings(root) {
  for (const ext of ['mjs', 'js', 'ts', 'mts', 'cjs', 'cts']) {
    const file = path.join(root, 'astro.config.' + ext);
    if (!(await existing(file))) continue;
    const project = createRequire(path.join(root, 'package.json'));
    const astro = createRequire(project.resolve('astro/package.json'));
    const { loadConfigFromFile } = await import(
      pathToFileURL(astro.resolve('vite'))
    );
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      file,
      root,
      'silent',
      undefined,
      'runner',
    );
    return loaded.config;
  }
  return {};
}

// Integrations can set Astro's site during a build. Its emitted sitemap can tell
// us which origin to contact; only the published sitemap supplies the inventory.
async function builtSite(dist) {
  for (const name of ['sitemap-index.xml', 'sitemap.xml']) {
    const file = path.join(dist, name);
    if (!(await existing(file))) continue;
    const sitemap = parseLocations(await readFile(file, 'utf8'));
    return new URL(sitemap.locations[0]).origin;
  }
}

async function askSite() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      'Specify your published URL: route-audit init --site https://docs.example.org',
    );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await prompt.question('Published site URL: ');
  } finally {
    prompt.close();
  }
}

function outDir(root, value = 'dist') {
  return value instanceof URL
    ? fileURLToPath(value)
    : path.resolve(root, value);
}

export async function initialize(options) {
  const root = process.cwd();
  const file = path.join(root, 'route-audit.json');
  const conflict = 'route-audit.json already exists. Its saved URLs were kept.';
  if (await existing(file, lstat)) throw new Error(conflict);
  let astro = {};
  try {
    astro = await astroSettings(root);
  } catch (e) {
    console.error('Could not load Astro settings: ' + e.message);
    console.error(
      'Using available build metadata or CLI options. Use --base and --dist for custom paths.',
    );
  }
  const dist =
    options.dist === undefined
      ? outDir(outDir(root, astro.root ?? '.'), astro.outDir)
      : outDir(root, options.dist);
  const sitemapSite =
    options.sitemap && URL.canParse(options.sitemap)
      ? new URL(options.sitemap).origin
      : undefined;
  const value =
    options.site ??
    astro.site ??
    sitemapSite ??
    (await builtSite(dist)) ??
    (await askSite());
  const published = new URL(value);
  if (
    !['https:', 'http:'].includes(published.protocol) ||
    published.username ||
    published.password ||
    published.search ||
    published.hash
  )
    throw new Error(
      'Use a published HTTP(S) site URL without credentials, query, or fragment.',
    );
  const site = published.origin;
  const base = staticBase(
    options.base ??
      (options.site && published.pathname !== '/'
        ? published.pathname
        : (astro.base ?? published.pathname)),
  );
  const { routes, sources } = await publishedRoutes(
    site,
    base,
    options.sitemap,
  );
  console.log('Published sitemap: ' + sources.join(', '));
  const config = { site, ...(base !== '/' && { base }), routes };
  const scratch = await mkdtemp(path.join(root, '.route-audit-init-'));
  try {
    const ready = path.join(scratch, 'config.json');
    await writeFile(ready, JSON.stringify(config, null, 2) + '\n');
    // An atomic, exclusive link keeps existing configs and concurrent runs intact.
    try {
      await link(ready, file);
    } catch (e) {
      if (e.code === 'EEXIST') throw new Error(conflict);
      throw e;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(
    `Saved ${routes.length} published URLs in route-audit.json. Commit this file to keep your baseline.`,
  );
  if (astro.output === 'server' && !options.dist) {
    console.log(
      'Audit the running server with: npx route-audit --preview <preview-origin> --report-only',
    );
    return 0;
  }
  const display = path.relative(root, dist).split(path.sep).join('/') || '.';
  if (!(await existing(dist))) {
    console.log(
      `After building your site, run: npx route-audit --dist "${display}" --report-only`,
    );
    return 0;
  }
  console.log(`Checking ${display} (report only).`);
  const report = await auditContract(
    { site, routes: routes.map((path) => ({ path })) },
    { dist, base },
  );
  console.log(format(report));
  return exitCode(report, true);
}
