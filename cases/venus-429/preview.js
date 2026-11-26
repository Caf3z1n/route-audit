import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import routing from '@vercel/routing-utils';
import serve from 'serve-handler';

export function venusRevisions(beforeDir, afterDir) {
  return [
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
}

export async function startPreview(revision) {
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

export async function closePreview(server) {
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await closed;
}
