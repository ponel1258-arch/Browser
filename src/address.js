'use strict';

function addressToUrl(input) {
  const value = input.trim();
  if (!value) return null;
  const search = () => `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return url.hostname ? url.href : search();
    } catch { return search(); }
  }
  // Other schemes, whitespace, and single words are searches, never executable URLs.
  if (/\s/.test(value) || (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/]+:\d+(?:[/?#]|$)/.test(value))) return search();
  if (/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#]|$)/i.test(value) || /^[^/]+\.[^/]+(?:[/?#]|$)/.test(value)) {
    try { return new URL(`${/^(?:localhost|127\.0\.0\.1)(?::|[/?#]|$)/i.test(value) ? 'http' : 'https'}://${value}`).href; } catch { return search(); }
  }
  return search();
}
module.exports = { addressToUrl };
