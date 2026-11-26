// Compare resource URLs. Fragments are client-side and never reach the server.
export function destinationUrl(value, base) {
  if (!(value instanceof URL) && (typeof value !== 'string' || !value.trim()))
    throw new TypeError('A destination must be a non-empty HTTP(S) URL.');
  const url = new URL(value, base);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new TypeError(
      'A destination must be an HTTP(S) URL without credentials.',
    );
  url.hash = '';
  return url;
}

// Translate contract expectations only. Observed redirects keep their wire origin.
export function expectedAtOrigin(url, site, target) {
  return url.origin === site ? target + url.href.slice(site.length) : url.href;
}

// Supply null when the checker could not observe a successful final response.
export function compareDestinations({
  requestedUrl,
  expected,
  observed,
  baselineUrl = requestedUrl,
}) {
  const base = destinationUrl(requestedUrl);
  const baseline =
    baselineUrl === requestedUrl ? base : destinationUrl(baselineUrl);
  const original = destinationUrl(expected, baseline);
  const target = expectedAtOrigin(original, baseline.origin, base.origin);
  if (observed == null)
    return {
      outcome: 'unknown',
      reason: 'final-location-unavailable',
      expected: target,
      observed: null,
    };
  const actual = destinationUrl(observed, base).href;
  const matches = actual === target;
  return {
    outcome: matches ? 'pass' : 'fail',
    reason: matches ? 'final-location-matches' : 'wrong-final-destination',
    expected: target,
    observed: actual,
  };
}
