'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<title>${request.url === '/second' ? 'Second page' : 'First page'}</title><h1>Test site</h1><a href="/second">Next</a><a href="/popup" target="_blank">Popup</a>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-ui-'));
  let app;
  try {
    app = await electron.launch({ args: ['--no-sandbox', `--user-data-dir=${profile}`, '.'], timeout: 20000 });
    const shell = await app.firstWindow();
    const pageContents = async () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.contentView.children.map(view => view.webContents).filter(Boolean).map(contents => ({ url: contents.getURL(), title: contents.getTitle() }));
    });
    const waitForPage = async predicate => {
      for (let i = 0; i < 100; i++) { const pages = await pageContents(); if (pages.some(predicate)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
      throw Error(`Page not found: ${JSON.stringify(await pageContents())}`);
    };
    await shell.getByRole('tab', { name: /Новая вкладка/ }).waitFor();
    await shell.locator('#home-surface').waitFor({ state: 'visible' });
    const home = shell.frameLocator('#home-surface');
    await home.locator('.search').waitFor();
    const frame = shell.frames().find(frame => frame.url().endsWith('/home.html'));
    // A remote URL must never load inside the trusted shell renderer.
    await frame.evaluate(url => { window.location.href = url; }, `http://127.0.0.1:${port}/forbidden-frame`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(!shell.frames().some(frame => frame.url().endsWith('/forbidden-frame')));
    await shell.locator('#home-surface').evaluate(element => { element.src = 'home.html'; });
    await home.locator('.search').waitFor();
    await home.locator('a[href="https://www.youtube.com"]').evaluate((link, target) => { link.href = target; }, `http://127.0.0.1:${port}/from-home`);
    await home.locator(`a[href="http://127.0.0.1:${port}/from-home"]`).click();
    await waitForPage(page => page.url.endsWith('/from-home'));
    await shell.locator('#toggle-sidebar').click();
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents).getBounds().x), 72);
    await shell.locator('#toggle-sidebar').click();
    await shell.locator('#home').click();
    await shell.locator('#home-surface').waitFor({ state: 'visible' });
    await shell.locator('#address').fill(`http://127.0.0.1:${port}/first`);
    await shell.locator('#address').press('Enter');
    await waitForPage(page => page.url.endsWith('/first'));
    await shell.getByRole('tab', { name: /First page/ }).waitFor();
    await shell.locator('#back').click();
    await shell.locator('#home-surface').waitFor({ state: 'visible' });
    await shell.locator('#forward').click();
    await waitForPage(page => page.url.endsWith('/first'));
    await shell.locator('#new-tab').click();
    assert.equal(await shell.getByRole('tab').count(), 2);
    await shell.getByRole('tab', { name: /First page/ }).click();
    assert.match(await shell.locator('#address').inputValue(), /\/first$/);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(v => v.webContents).find(c => c?.getURL().endsWith('/first')).executeJavaScript("document.querySelector('a').click()", true));
    await waitForPage(page => page.url.endsWith('/second') && page.title === 'Second page');
    await shell.getByRole('tab', { name: /Second page/ }).waitFor();
    await shell.locator('#back').click();
    await waitForPage(page => page.url.endsWith('/first'));
    await shell.locator('#forward').click();
    await waitForPage(page => page.url.endsWith('/second'));
    await shell.locator('#home').click();
    await shell.locator('#home-surface').waitFor({ state: 'visible' });
    await shell.getByRole('button', { name: /Закрыть вкладку/ }).first().click();
    assert.equal(await shell.getByRole('tab').count(), 1);
    console.log('Desktop integration passed: home, navigation, tabs, back/forward, home and close.');
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
