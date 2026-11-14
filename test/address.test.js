'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addressToUrl } = require('../src/address');
test('searches words and preserves query characters', () => {
  assert.equal(addressToUrl('  коты и собаки  '), 'https://www.google.com/search?q=%D0%BA%D0%BE%D1%82%D1%8B%20%D0%B8%20%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B8');
  assert.equal(addressToUrl('hello'), 'https://www.google.com/search?q=hello');
  assert.equal(addressToUrl(''), null);
});
test('opens web addresses while treating dangerous schemes as searches', () => {
  assert.equal(addressToUrl('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
  assert.equal(addressToUrl('localhost:3000/path'), 'http://localhost:3000/path');
  assert.equal(addressToUrl('example.com:8080/path'), 'https://example.com:8080/path');
  assert.equal(addressToUrl('http://localhost:3000/path'), 'http://localhost:3000/path');
  assert.equal(addressToUrl('javascript:alert(1)'), 'https://www.google.com/search?q=javascript%3Aalert(1)');
  assert.equal(addressToUrl('file:///etc/passwd'), 'https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd');
});
