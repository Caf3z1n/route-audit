import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sitemapPaths } from './sitemap.js';

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
  return url.pathname + url.search;
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
    routes.set(key, { path: key, status: rule.status, location });
  }
  if (!routes.size) throw new Error('No routes configured.');
  return { site, routes: [...routes.values()] };
}
