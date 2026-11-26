import blc from 'broken-link-checker';

export async function observe(urls) {
  const destinations = new Map();
  await new Promise((resolve, reject) => {
    const checker = new blc.UrlChecker(
      {},
      {
        link(result, requested) {
          destinations.set(
            requested,
            result.broken === false
              ? (result.url.redirected ?? result.url.resolved)
              : null,
          );
        },
        end: resolve,
      },
    );
    for (const url of urls) {
      const queued = checker.enqueue(url, undefined, url);
      if (queued instanceof Error) {
        reject(queued);
        return;
      }
    }
    if (urls.length === 0) resolve();
  });
  return destinations;
}
