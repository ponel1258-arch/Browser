'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
require('./desktop-harness').run(async ({ ui, page, command, navigate, until }) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<title>${req.url}</title><h1>${req.url}</h1>${req.url === '/form' ? '<textarea>Initial</textarea>' : ''}${req.url === '/frame' ? '<iframe src="/inner"></iframe>' : ''}<a href="/second">Next</a>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await navigate(`${base}/first`);
    await page().executeJavaScript("document.querySelector('a').click()", true);
    await until(() => page().getURL().endsWith('/second') && !page().isLoading());
    await command('new-tab');
    await command('sleep-tabs');
    await until(() => ui("document.querySelectorAll('.sleeping').length === 1"));
    await command('select-tab', 1);
    await until(() => page()?.getURL().endsWith('/second') && !page().isLoading());
    await command('back');
    await until(() => page().getURL().endsWith('/first') && !page().isLoading());
    await navigate(`${base}/form`);
    await page().executeJavaScript("document.querySelector('textarea').value = 'Unsaved draft'");
    await command('new-tab');
    await navigate(`${base}/frame`);
    await command('new-tab');
    await navigate(`${base}/media`);
    await page().executeJavaScript(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
      const video = document.createElement('video'); video.muted = true;
      video.srcObject = canvas.captureStream(1); document.body.append(video);
      canvas.getContext('2d').fillRect(0,0,20,20); video.play();
    })()`, true);
    await command('new-tab');
    await navigate(`${base}/discardable`);
    await command('new-tab');
    await command('sleep-tabs');
    await until(() => ui("document.querySelectorAll('.sleeping').length === 1"));
    assert.equal(await ui("document.querySelectorAll('.tab:not(.sleeping)').length"), 5, 'active home, background home, draft, iframe and muted media remain awake');
    await command('select-tab', 1);
    assert.equal(await page().executeJavaScript("document.querySelector('textarea').value"), 'Unsaved draft');
    await command('toggle-saver');
    assert.equal(await ui("document.querySelector('#saver-toggle').getAttribute('aria-pressed')"), 'false');
    await command('toggle-saver');
    await command('new-tab');
    await navigate(`${base}/clean`);
    await command('new-tab');
    // Advance only the idle clock; exercise the real 30-second scheduling interval.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      await new Promise(resolve => setTimeout(resolve, 31000));
      assert.equal(await ui("[...document.querySelectorAll('.tab.sleeping .tab-title')].some(el => el.textContent === '/clean')"), true);
      await command('select-tab', 1);
      assert.equal(await page().executeJavaScript("document.querySelector('textarea').value"), 'Unsaved draft');
    } finally { Date.now = realNow; }
    console.log('Memory integration passed: manual and automatic discard, wake, history, draft, iframe, muted media and saver toggle.');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
