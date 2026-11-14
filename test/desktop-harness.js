'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Run a normal Electron process, without CDP: DevTools marks pages as captured,
// which intentionally prevents our memory saver from discarding them.
exports.run = async function run(check) {
  if (!process.versions.electron) {
    const child = spawn(require('electron'), ['--no-sandbox', process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit' });
    child.on('error', error => { console.error(error); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-desktop-'));
  app.setPath('userData', profile);
  require('../src/main');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => {
    for (let n = 0; n < 200; n++) { if (await predicate()) return; await wait(50); }
    throw Error('Desktop condition timed out');
  };
  const deadline = setTimeout(() => { console.error('Desktop test deadline exceeded'); app.exit(1); }, 45000);
  let exitCode = 0;
  try {
    await app.whenReady();
    await until(() => BrowserWindow.getAllWindows().length);
    const window = BrowserWindow.getAllWindows()[0];
    const ui = script => window.webContents.executeJavaScript(script, true);
    await until(() => ui("!!document.querySelector('.tab')"));
    const page = () => window.contentView.children.map(view => view.webContents).find(Boolean);
    const command = async (name, value) => { await ui(`window.browser.command(${JSON.stringify(name)}, ${JSON.stringify(value)})`); await wait(50); };
    const navigate = async url => {
      await command('navigate', url);
      await until(() => page()?.getURL() === url && !page().isLoading());
    };
    await check({ app, window, ui, page, command, navigate, wait, until });
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    clearTimeout(deadline);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(exitCode);
  }
};
