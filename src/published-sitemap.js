import { gunzipSync } from 'node:zlib';
import { parseLocations } from './sitemap.js';
import { routePath } from './input.js';

const maxBytes = 50 * 1024 * 1024;

function sameSite(value, site, parent) {
  const url = new URL(value, parent);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== site ||
    url.username ||
    url.password
  )
    throw new Error('Expected a sitemap or URL on ' + site);
  url.hash = '';
  return url;
}

async function download(start, site) {
  let url = sameSite(start, site);
  const signal = AbortSignal.timeout(20000);
  for (let hop = 0; hop <= 10; hop++) {
    const res = await fetch(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel();
      const next = res.headers.get('location');
      if (!next) throw new Error('Missing redirect destination at ' + url);
      url = sameSite(next, site, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { url, status: res.status };
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body ?? []) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Sitemap exceeds 50 MiB: ' + url);
      chunks.push(chunk);
    }
    let bytes = Buffer.concat(chunks);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b)
      bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
    return { url, text: bytes.toString('utf8'), status: res.status };
  }
  throw new Error('Too many redirects at ' + start);
}

async function findSitemaps(site, prefix, explicit) {
  if (explicit) return [{ url: sameSite(explicit, site, site + prefix + '/') }];
  const robots = await download(site + '/robots.txt', site);
  const advertised = [];
  for (const line of (robots.text ?? '').split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (match) advertised.push({ url: sameSite(match[1], site, robots.url) });
  }
  if (advertised.length) return advertised;
  for (const name of ['sitemap-index.xml', 'sitemap.xml']) {
    const page = await download(site + prefix + '/' + name, site);
    if (page.text && !/^\s*(?:<!doctype html\b|<html\b)/i.test(page.text))
      return [page];
  }
  throw new Error(
    'No published sitemap found. Specify its URL with --sitemap.',
  );
}

export async function publishedRoutes(site, base, sitemap) {
  const prefix = base.replace(/\/$/, '');
  const queue = await findSitemaps(site, prefix, sitemap);
  const sources = queue.map(({ url }) => url.href);
  const seen = new Set();
  const routes = new Set();
  for (const entry of queue) {
    const key = entry.url.href;
    if (seen.has(key)) continue;
    seen.add(key);
    const page = entry.text === undefined ? await download(key, site) : entry;
    if (!page.text)
      throw new Error('Sitemap returned HTTP ' + page.status + ': ' + key);
    seen.add(page.url.href);
    let parsed;
    try {
      parsed = parseLocations(page.text);
    } catch (e) {
      throw new Error('Invalid sitemap at ' + page.url + ': ' + e.message);
    }
    for (const loc of parsed.locations) {
      const url = sameSite(loc, site);
      if (parsed.index) queue.push({ url });
      else if (
        !prefix ||
        url.pathname === prefix ||
        url.pathname.startsWith(prefix + '/')
      )
        routes.add(routePath(url.pathname + url.search, site));
    }
  }
  if (!routes.size)
    throw new Error('No published URLs found under ' + site + base);
  return { routes: [...routes].sort(), sources };
}
