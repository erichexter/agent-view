import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fmtRel, fmtDur, fmtCountdown, fmtTokens, fmtTime, escapeHTML } from '../public/utils.js';

describe('fmtRel', () => {
  test('null → "—"', () => {
    assert.equal(fmtRel(null), '—');
  });

  test('now → "now"', () => {
    assert.equal(fmtRel(Date.now()), 'now');
  });

  test('30s ago → "30s ago"', () => {
    assert.equal(fmtRel(Date.now() - 30000), '30s ago');
  });

  test('90s ago → "1m ago"', () => {
    assert.equal(fmtRel(Date.now() - 90000), '1m ago');
  });

  test('3700s ago → "1h ago"', () => {
    assert.equal(fmtRel(Date.now() - 3700000), '1h ago');
  });
});

describe('fmtDur', () => {
  test('null → "—"', () => {
    assert.equal(fmtDur(null), '—');
  });

  test('500ms → "500ms"', () => {
    assert.equal(fmtDur(500), '500ms');
  });

  test('5000ms → "5s"', () => {
    assert.equal(fmtDur(5000), '5s');
  });

  test('90000ms → "1m 30s"', () => {
    assert.equal(fmtDur(90000), '1m 30s');
  });
});

describe('fmtTokens', () => {
  test('null → "—"', () => {
    assert.equal(fmtTokens(null), '—');
  });

  test('500 → "500"', () => {
    assert.equal(fmtTokens(500), '500');
  });

  test('1500 → "1.5k"', () => {
    assert.equal(fmtTokens(1500), '1.5k');
  });

  test('1200000 → "1.20M"', () => {
    assert.equal(fmtTokens(1200000), '1.20M');
  });
});

describe('escapeHTML', () => {
  test('escapes <script> tags and quotes', () => {
    const input = '<script>alert("xss")</script>';
    const output = escapeHTML(input);
    assert.ok(!output.includes('<'), 'Should not contain <');
    assert.ok(!output.includes('>'), 'Should not contain >');
    assert.ok(!output.includes('"'), 'Should not contain "');
    assert.ok(output.includes('&lt;'), 'Should contain &lt;');
    assert.ok(output.includes('&gt;'), 'Should contain &gt;');
    assert.ok(output.includes('&quot;'), 'Should contain &quot;');
  });
});

describe('fmtCountdown', () => {
  test('~90s future → "1m 30s"', () => {
    // Allow small timing variance by using 91s
    const result = fmtCountdown(Date.now() + 90000);
    // Could be "1m 30s" or "1m 29s" depending on execution time
    assert.ok(result.startsWith('1m'), `Expected "1m ..." but got "${result}"`);
  });

  test('past timestamp → "now"', () => {
    assert.equal(fmtCountdown(Date.now() - 1000), 'now');
  });
});
