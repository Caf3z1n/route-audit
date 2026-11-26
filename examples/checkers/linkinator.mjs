import { LinkChecker } from 'linkinator';

export async function observe(urls) {
  const checker = new LinkChecker();
  const redirects = new Map();
  checker.on('redirect', ({ url, targetUrl }) => redirects.set(url, targetUrl));
  const report = await checker.check({ path: urls, redirects: 'warn' });
  return new Map(
    report.links.map(({ url, state }) => [
      url,
      state === 'OK' ? (redirects.has(url) ? redirects.get(url) : url) : null,
    ]),
  );
}
