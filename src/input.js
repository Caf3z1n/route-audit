import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sitemapPaths } from './sitemap.js';
import { discoverSources } from './discovery.js';
import { destinationUrl } from './destinations.js';

export function origin(value) {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.href !== url.origin + '/'
  ) {
    throw new Error(
      'Use an HTTP(S) origin without a path, credentials, or query.',
    );
  }
  return url.origin;
}
function routePath(value, site) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#')
  ) {
    throw new Error('Invalid route: ' + value);
  }
  const url = new URL(value, site);
  if (url.origin !== site || url.pathname.startsWith('//'))
    throw new Error('Ambiguous route: ' + value);
  return url.pathname + url.search;
}
function contractReferences(inventory, supplied = []) {
  if (!Array.isArray(supplied))
    throw new Error('Route references must be an array.');
  if (!supplied.length) return inventory;
  const references = new Map();
  for (const ref of [...(inventory ?? []), ...supplied]) {
    if (
      !ref ||
      typeof ref.file !== 'string' ||
      !ref.file ||
      !Number.isSafeInteger(ref.line) ||
      ref.line < 1 ||
      !Number.isSafeInteger(ref.column) ||
      ref.column < 1 ||
      (ref.source !== undefined && typeof ref.source !== 'string')
    )
      throw new Error('Invalid source file, line or column.');
    if (ref.url !== undefined) {
      if (typeof ref.url !== 'string')
        throw new Error('Invalid source permalink.');
      const link = new URL(ref.url);
      if (link.protocol !== 'https:' || link.username || link.password)
        throw new Error('Invalid source permalink.');
    }
    const { source, file, line, column, url } = ref;
    references.set(JSON.stringify([source, file, line, column, url]), {
      source,
      file,
      line,
      column,
      url,
    });
  }
  return [...references.values()];
}
export async function loadConfig(filename) {
  const dir = path.dirname(path.resolve(filename));
  const cfg = JSON.parse(await readFile(filename, 'utf8'));
  const site = origin(cfg.site);
  const routes = new Map();
  const explicit = new Set();
  for (const value of await sitemapPaths(cfg.sitemaps ?? [], dir, site)) {
    const key = routePath(value, site);
    routes.set(key, { path: key });
  }
  const discovered = await discoverSources(cfg.sources ?? [], dir, site);
  for (const pathname of [...discovered.keys()].sort()) {
    const key = routePath(pathname, site);
    routes.set(key, { path: key, references: discovered.get(pathname) });
  }
  for (const entry of cfg.routes ?? []) {
    const rule = typeof entry === 'string' ? { path: entry } : entry;
    const key = routePath(rule.path, site);
    if (explicit.has(key)) throw new Error('Duplicate explicit route: ' + key);
    explicit.add(key);
    if (
      rule.status !== undefined &&
      ![200, 301, 302, 303, 307, 308, 410].includes(rule.status)
    )
      throw new Error('Unsupported status for ' + key);
    let location;
    if (rule.location !== undefined) {
      if (![301, 302, 303, 307, 308].includes(rule.status))
        throw new Error('Location requires a redirect status for ' + key);
      const u = new URL(rule.location, new URL(key, site));
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
        throw new Error('Invalid redirect destination.');
      location = u.href;
    }
    let finalLocation;
    if (rule.finalLocation !== undefined) {
      if (rule.status === 410)
        throw new Error('A gone route cannot have a finalLocation: ' + key);
      finalLocation = destinationUrl(
        rule.finalLocation,
        new URL(key, site),
      ).href;
    }
    const references = contractReferences(
      routes.get(key)?.references,
      rule.references,
    );
    routes.set(key, {
      path: key,
      status: rule.status,
      location,
      ...(finalLocation && { finalLocation }),
      ...(references?.length && { references }),
    });
  }
  if (!routes.size) throw new Error('No routes configured.');
  return { site, routes: [...routes.values()] };
}
