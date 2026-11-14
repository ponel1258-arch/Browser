'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, clipboard } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { addressToUrl } = require('./address');

const homePath = path.join(__dirname, 'home.html');
const homeUrl = pathToFileURL(homePath).href;
const CHROME_HEIGHT = 64;
let sidebarCollapsed = false;
let window;
let tabs = [];
let activeId;
let nextId = 1;
let pageFullscreen = false;
let memorySaver = true;
let stateScheduled = false;
const IDLE_MS = 5 * 60 * 1000;
const downloading = new Map();
let sleepTimer;

function isHome(url) { return url === homeUrl; }
function allowedUrl(url) {
  if (isHome(url)) return true;
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}
function activeTab() { return tabs.find(tab => tab.id === activeId); }
function resize() {
  const tab = activeTab();
  if (!window || !tab?.view) return;
  const [width, height] = window.getContentSize();
  const top = pageFullscreen ? 0 : CHROME_HEIGHT;
  const left = pageFullscreen ? 0 : (sidebarCollapsed ? 72 : 224);
  tab.view.setBounds({ x: left, y: top, width: Math.max(0, width - left), height: Math.max(0, height - top) });
}
function emitState() {
  if (stateScheduled) return;
  stateScheduled = true;
  setImmediate(() => { stateScheduled = false; publishState(); });
}
function publishState() {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('browser:state', {
    activeId, memorySaver, sidebarCollapsed, sleeping: tabs.filter(tab => tab.sleeping).length,
    tabs: tabs.map(tab => ({ id: tab.id, title: tab.title, favicon: tab.favicon, loading: tab.loading, sleeping: tab.sleeping })),
    current: (() => {
      const tab = activeTab();
      if (!tab) return null;
      if (!tab.view) return { home: true, url: '', loading: false, canBack: !!tab.history && tab.history.index > 0, canForward: !!tab.history && tab.history.index < tab.history.entries.length - 1 };
      const contents = tab.view.webContents;
      return { home: false, url: isHome(contents.getURL()) ? '' : contents.getURL(), canBack: contents.navigationHistory.canGoBack(), canForward: contents.navigationHistory.canGoForward(), loading: tab.loading };
    })()
  });
}
function selectTab(id) {
  const selected = tabs.find(tab => tab.id === id);
  if (!selected || !window) return;
  const previous = activeTab();
  if (previous && previous.id !== id) {
    previous.lastActive = Date.now();
    if (previous.view) {
      previous.view.setVisible(false);
      window.contentView.removeChildView(previous.view);
    }
  }
  activeId = id;
  if (!selected.view && !selected.home) attachView(selected);
  if (selected.view) {
    window.contentView.addChildView(selected.view);
    selected.view.setVisible(true);
  }
  resize();
  emitState();
}
function createTab(url = homeUrl, select = true) {
  const tab = { id: nextId++, view: null, title: 'Новая вкладка', favicon: '', loading: false,
    url: allowedUrl(url) ? url : homeUrl, lastActive: Date.now(), history: null, playing: false, deviceAccess: false, navigationVersion: 0, home: isHome(url), sleeping: false };
  tabs.push(tab);
  if (!tab.home) attachView(tab);
  if (select) selectTab(tab.id); else { tab.view?.setVisible(false); emitState(); }
  return tab;
}
function attachView(tab) {
  const view = new WebContentsView({ webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true
  } });
  tab.view = view;
  tab.sleeping = false;
  const contents = view.webContents;
  contents.on('page-title-updated', (_event, title) => { tab.title = isHome(contents.getURL()) ? 'Новая вкладка' : title || 'Новая вкладка'; emitState(); });
  contents.on('page-favicon-updated', (_event, favicons) => { tab.favicon = favicons[0] || ''; emitState(); });
  contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) tab.navigationVersion++; });
  contents.on('media-started-playing', () => { tab.playing = true; });
  contents.on('media-paused', () => { tab.playing = false; });
  contents.on('did-start-loading', () => { tab.loading = true; emitState(); });
  contents.on('did-stop-loading', () => {
    tab.loading = false;
    if (isHome(contents.getURL()) && tab.view === view) parkHome(tab);
    else tab.title = contents.getTitle() || tab.title;
    emitState();
  });
  const updateNavigation = () => {
    tab.url = contents.getURL();
    if (isHome(contents.getURL())) { tab.title = 'Новая вкладка'; tab.favicon = ''; }
    emitState();
  };
  contents.on('did-navigate', updateNavigation);
  contents.on('did-navigate-in-page', updateNavigation);
  contents.on('will-navigate', (event, target) => { if (!allowedUrl(target)) event.preventDefault(); });
  contents.on('will-redirect', (event, target) => { if (!allowedUrl(target)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url: target }) => {
    if (allowedUrl(target) && !isHome(target)) setImmediate(() => { if (window && !window.isDestroyed()) createTab(target); });
    return { action: 'deny' };
  });
  contents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.linkURL && allowedUrl(params.linkURL)) {
      items.push({ label: 'Открыть ссылку в новой вкладке', click: () => createTab(params.linkURL) });
      items.push({ label: 'Копировать адрес ссылки', click: () => clipboard.writeText(params.linkURL) });
    }
    if (params.isEditable) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Вырезать', enabled: params.editFlags.canCut, click: () => contents.cut() });
      items.push({ label: 'Копировать', enabled: params.editFlags.canCopy, click: () => contents.copy() });
      items.push({ label: 'Вставить', enabled: params.editFlags.canPaste, click: () => contents.paste() });
      items.push({ label: 'Выделить всё', click: () => contents.selectAll() });
    } else if (params.selectionText) {
      items.push({ label: 'Копировать', click: () => contents.copy() });
    }
    if (!items.length) {
      items.push({ label: 'Назад', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
      items.push({ label: 'Вперёд', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
      items.push({ label: 'Обновить', click: () => contents.reload() });
    }
    Menu.buildFromTemplate(items).popup({ window });
  });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    // -3 is an intentional cancellation, for example when navigating again.
    if (isMainFrame && code !== -3) { tab.title = 'Не удалось загрузить страницу'; emitState(); }
  });
  contents.on('enter-html-full-screen', () => { pageFullscreen = true; resize(); });
  contents.on('leave-html-full-screen', () => { pageFullscreen = false; resize(); });
  if (tab.history?.entries.length) {
    contents.navigationHistory.restore(tab.history).catch(() => {});
    tab.history = null;
  } else contents.loadURL(tab.url).catch(() => {});
}
function closeTab(id) {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index < 0) return;
  const tab = tabs[index];
  const wasActive = id === activeId;
  if (wasActive && tab.view) window.contentView.removeChildView(tab.view);
  tabs.splice(index, 1);
  if (wasActive) activeId = undefined;
  tab.view?.webContents.close();
  if (!tabs.length) createTab();
  else if (wasActive) selectTab(tabs[Math.min(index, tabs.length - 1)].id);
  else emitState();
}
function parkHome(tab) {
  const view = tab.view;
  tab.history = { entries: view.webContents.navigationHistory.getAllEntries(), index: view.webContents.navigationHistory.getActiveIndex() };
  if (tab.id === activeId) window.contentView.removeChildView(view);
  tab.view = null; tab.home = true; tab.sleeping = false; tab.playing = false;
  tab.url = homeUrl; tab.title = 'Новая вкладка'; tab.favicon = '';
  view.webContents.close();
}
function navigate(input) {
  const target = addressToUrl(input);
  const tab = activeTab();
  if (!target || !tab) return;
  if (tab.view) { tab.view.webContents.loadURL(target).catch(() => {}); return; }
  const previous = tab.history;
  const entries = previous ? previous.entries.slice(0, previous.index + 1) : [{ url: homeUrl, title: 'Новая вкладка' }];
  entries.push({ url: target, title: target });
  tab.url = target; tab.home = false;
  tab.history = { entries, index: entries.length - 1 };
  attachView(tab); selectTab(tab.id);
}
function traverseHistory(direction) {
  const tab = activeTab();
  if (!tab) return;
  if (tab.view) {
    const history = tab.view.webContents.navigationHistory;
    if (history.canGoToOffset(direction)) history.goToOffset(direction);
  } else if (tab.history) {
    const index = tab.history.index + direction;
    if (index < 0 || index >= tab.history.entries.length) return;
    tab.history.index = index; tab.home = false;
    attachView(tab); selectTab(tab.id);
  }
}
function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 720, minHeight: 500,
    title: 'Luma', backgroundColor: '#101114', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  window.loadFile(path.join(__dirname, 'shell.html'));
  window.on('resize', resize);
  window.on('closed', () => {
    for (const tab of tabs) tab.view?.webContents.close();
    window = null; tabs = []; activeId = undefined;
  });
  window.webContents.on('did-finish-load', () => { if (!tabs.length) createTab(); else emitState(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame || !isHome(event.url)) event.preventDefault();
  });
  const shortcut = (label, accelerator, click) => ({ label, accelerator, click });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Браузер', submenu: [
    shortcut('Новая вкладка', 'CmdOrCtrl+T', () => createTab()),
    shortcut('Закрыть вкладку', 'CmdOrCtrl+W', () => closeTab(activeId)),
    shortcut('Адресная строка', 'CmdOrCtrl+L', () => window.webContents.send('browser:focus-address')),
    shortcut('Обновить', 'CmdOrCtrl+R', () => activeTab()?.view?.webContents.reload()),
    shortcut('Назад', 'Alt+Left', () => traverseHistory(-1)),
    shortcut('Вперёд', 'Alt+Right', () => traverseHistory(1))
  ] }]));
}

app.whenReady().then(() => {
  // Sites must ask before accessing device or notification capabilities.
  const session = require('electron').session.defaultSession;
  session.on('will-download', (_event, item, contents) => {
    if (!contents) return;
    const id = contents.id;
    downloading.set(id, (downloading.get(id) || 0) + 1);
    item.once('done', () => {
      const remaining = (downloading.get(id) || 1) - 1;
      if (remaining) downloading.set(id, remaining); else downloading.delete(id);
    });
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const supported = ['media', 'geolocation', 'notifications', 'display-capture'];
    if (!supported.includes(permission) || !contents || !allowedUrl(contents.getURL()) || isHome(contents.getURL())) return callback(false);
    const origin = (() => { try { return new URL(details.requestingUrl || contents.getURL()).origin; } catch { return 'Этот сайт'; } })();
    dialog.showMessageBox(window, { type: 'question', buttons: ['Запретить', 'Разрешить'], defaultId: 0, cancelId: 0, message: `${origin} запрашивает доступ`, detail: `Разрешение: ${permission}` }).then(result => {
      if (result.response === 1 && permission === 'media') {
        const tab = tabs.find(tab => tab.view?.webContents === contents);
        if (tab) tab.deviceAccess = true;
      }
      callback(result.response === 1);
    }).catch(() => callback(false));
  });
  ipcMain.on('browser:command', (event, command, value) => {
    if (!window || event.sender !== window.webContents) return;
    const tab = activeTab();
    switch (command) {
      case 'toggle-sidebar': sidebarCollapsed = !sidebarCollapsed; resize(); emitState(); break;
      case 'sleep-tabs': void sleepBackgroundTabs(false); break;
      case 'toggle-saver': memorySaver = !memorySaver; emitState(); break;
      case 'new-tab': createTab(); break;
      case 'select-tab': selectTab(value); break;
      case 'close-tab': closeTab(value); break;
      case 'navigate': if (typeof value === 'string') navigate(value); break;
      case 'back': traverseHistory(-1); break;
      case 'forward': traverseHistory(1); break;
      case 'reload': if (tab?.view) tab.loading ? tab.view.webContents.stop() : tab.view.webContents.reload(); break;
      case 'home': if (tab?.view) tab.view.webContents.loadURL(homeUrl).catch(() => {}); break;
    }
  });
  createWindow();
  sleepTimer = setInterval(() => { if (memorySaver) void sleepBackgroundTabs(true); }, 30000);
  sleepTimer.unref();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Conservative discard: keep pages with media, device access, frames or form state alive.
// Restoration preserves Chromium's navigation entries; application JS state is recreated.
async function sleepBackgroundTabs(onlyIdle) {
  for (const tab of [...tabs]) {
    const view = tab.view;
    if (!view || tab.id === activeId || tab.loading || tab.playing || tab.deviceAccess) continue;
    if (onlyIdle && Date.now() - tab.lastActive < IDLE_MS) continue;
    const contents = view.webContents;
    if (contents.isDestroyed() || contents.isCurrentlyAudible() || contents.isBeingCaptured() || downloading.has(contents.id)) continue;
    const navigationVersion = tab.navigationVersion;
    let safe;
    try {
      safe = await Promise.race([
        contents.executeJavaScript(`(() => {
          if (document.querySelector('iframe, frame, [contenteditable]')) return false;
          if ([...document.querySelectorAll('video,audio')].some(media => !media.paused)) return false;
          return ![...document.querySelectorAll('input,textarea,select')].some(el => {
            if (el.tagName === 'SELECT') return [...el.options].some(option => option.selected !== option.defaultSelected);
            return el.value !== el.defaultValue || ('checked' in el && el.checked !== el.defaultChecked);
          });
        })()`),
        new Promise(resolve => { const timer = setTimeout(() => resolve(false), 1500); timer.unref(); })
      ]);
    } catch { continue; }
    // Selection, navigation or closure can occur while the page inspection is in flight.
    if (!safe || navigationVersion !== tab.navigationVersion || !window || !tabs.includes(tab) || tab.view !== view || tab.id === activeId || contents.isDestroyed() || tab.loading || tab.playing || tab.deviceAccess || contents.isCurrentlyAudible() || contents.isBeingCaptured() || downloading.has(contents.id)) continue;
    if (onlyIdle && (!memorySaver || Date.now() - tab.lastActive < IDLE_MS)) continue;
    tab.history = { entries: contents.navigationHistory.getAllEntries(), index: contents.navigationHistory.getActiveIndex() };
    if (!tab.history.entries.length) { tab.history = null; continue; }
    tab.view = null;
    tab.sleeping = true;
    tab.loading = false;
    contents.close();
    emitState();
  }
}
