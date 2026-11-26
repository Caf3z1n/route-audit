import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDestinations } from 'route-audit/destinations';

test('observed destinations compare the entire resource URL without fetching it', () => {
  const requestedUrl = 'https://docs.test/old/';
  const verdict = (expected, observed, options) =>
    compareDestinations({ requestedUrl, expected, observed, ...options });
  assert.deepEqual(
    verdict('../guide?q=1#example', new URL('https://docs.test/guide?q=1#top')),
    {
      outcome: 'pass',
      reason: 'final-location-matches',
      expected: 'https://docs.test/guide?q=1',
      observed: 'https://docs.test/guide?q=1',
    },
  );
  for (const other of [
    'https://other.test/guide',
    'http://docs.test/guide',
    '/guide/',
    '/guide?q=1',
    '/Guide',
  ]) {
    assert.equal(verdict('/guide', other).reason, 'wrong-final-destination');
  }
  assert.equal(verdict('/guide', null).outcome, 'unknown');
  assert.equal(
    verdict('https://published.test/guide', '/guide', {
      baselineUrl: 'https://published.test/old/',
    }).outcome,
    'pass',
  );
  assert.equal(
    verdict('/guide', 'https://published.test/guide', {
      baselineUrl: 'https://published.test/old/',
    }).outcome,
    'fail',
  );
  assert.equal(
    verdict('https://external.test/guide', '/guide', {
      baselineUrl: 'https://published.test/old/',
    }).outcome,
    'fail',
  );
  for (const invalid of [
    '',
    null,
    'file:///guide',
    'https://user:pass@docs.test/guide',
  ]) {
    assert.throws(() => verdict(invalid, '/guide'));
  }
});
