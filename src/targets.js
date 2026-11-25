import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { parse } from 'parse5';

function metaRefreshLocation(html) {
  // Attribute names cannot be encoded in HTML. Leave the final decision to
  // the parser when a refresh value or a character reference is possible.
  if (!/http-equiv\s*=\s*["']?\s*[r&]/i.test(html)) return;
  const doc = parse(html);
  const head = doc.childNodes
    .find((n) => n.tagName === 'html')
    ?.childNodes.find((n) => n.tagName === 'head');
  for (const n of head?.childNodes ?? []) {
    if (n.tagName !== 'meta') continue;
    const attrs = Object.fromEntries(n.attrs.map((a) => [a.name, a.value]));
    if (attrs['http-equiv']?.trim().toLowerCase() !== 'refresh') continue;
    const m = /^\s*0(?:\.0*)?\s*;\s*url\s*=\s*(.*?)\s*$/i.exec(
      attrs.content ?? '',
    );
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
}
export async function staticTarget(dir, base = '/') {
  if (!(await stat(dir)).isDirectory())
    throw new Error('Static output must be a directory.');
  const root = path.resolve(dir),
    prefix = base.replace(/\/$/, '');
  const pages = new Map();
  return async (url) => {
    const pathname = url.pathname;
    if (prefix && pathname !== prefix && !pathname.startsWith(prefix + '/'))
      return { status: 404 };
    const segments = pathname
      .slice(prefix.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    if (
      segments.some(
        (s) => !s || s === '.' || s === '..' || /[\\/:\x00]/.test(s),
      )
    )
      throw new Error('Path cannot be mapped to a static file.');
    const local = path.join(root, ...segments);
    const candidates =
      pathname.endsWith('/') || !segments.length
        ? [path.join(local, 'index.html')]
        : [local, local + '.html', path.join(local, 'index.html')];
    for (const file of candidates) {
      let info;
      try {
        info = await stat(file);
      } catch (e) {
        if (['ENOENT', 'ENOTDIR'].includes(e.code)) continue;
        throw e;
      }
      if (!info.isFile()) continue;
      if (!pages.has(file)) {
        const location = file.toLowerCase().endsWith('.html')
          ? metaRefreshLocation(await readFile(file, 'utf8'))
          : undefined;
        pages.set(
          file,
          location === undefined
            ? { status: 200 }
            : { status: 'meta', location },
        );
      }
      return pages.get(file);
    }
    return { status: 404 };
  };
}
export function httpTarget(site, preview) {
  return async (url) => {
    const target =
      url.origin === site ? new URL(preview + url.pathname + url.search) : url;
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { 'user-agent': 'route-audit (public route check)' },
    });
    const location = response.headers.get('location');
    await response.body?.cancel();
    return { status: response.status, location };
  };
}
