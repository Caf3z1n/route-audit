import linkCheck from 'link-check';
import { promisify } from 'node:util';

const check = promisify(linkCheck);

export async function observe(urls) {
  const destinations = new Map();
  for (const url of urls) {
    const result = await check(url, {});
    // The sample patch adds finalUrl to successful HTTP observations in 5.6.0.
    // A stock result only exposes the input link, even after a redirect.
    if (result.status === 'alive' && !result.finalUrl)
      throw new Error(
        'Apply the link-check 5.6.0 example patch to expose finalUrl.',
      );
    destinations.set(url, result.status === 'alive' ? result.finalUrl : null);
  }
  return destinations;
}
