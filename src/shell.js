'use strict';
const $ = id => document.getElementById(id);
const command = (name, value) => window.browser.command(name, value);
const address = $('address');
const nodes = new Map();
let editing = false;
let lastUrl = '';
address.addEventListener('focus', () => { editing = true; address.select(); });
address.addEventListener('blur', () => { editing = false; address.value = lastUrl; });
address.addEventListener('keydown', event => { if (event.key === 'Escape') address.blur(); });
$('address-form').addEventListener('submit', event => { event.preventDefault(); const target = address.value; lastUrl = target; command('navigate', target); address.blur(); });
$('new-tab').addEventListener('click', () => command('new-tab'));
for (const name of ['back', 'forward', 'reload', 'home', 'sleep-tabs']) $(name).addEventListener('click', () => command(name));
$('toggle-sidebar').addEventListener('click', () => command('toggle-sidebar'));
window.addEventListener('message', event => {
  if (event.source !== $('home-surface').contentWindow || event.data?.type !== 'luma-navigate' || typeof event.data.target !== 'string') return;
  command('navigate', event.data.target);
});
$('saver-toggle').addEventListener('click', () => command('toggle-saver'));
window.browser.onFocusAddress(() => { window.focus(); address.focus(); });

function createTabNode(id) {
  const item = document.createElement('div');
  const select = document.createElement('button');
  select.className = 'tab-select'; select.setAttribute('role', 'tab');
  const icon = document.createElement('img'); icon.className = 'tab-favicon'; icon.alt = ''; icon.width = 16; icon.height = 16; icon.hidden = true;
  icon.addEventListener('error', () => { icon.hidden = true; });
  const fallback = document.createElement('span'); fallback.className = 'tab-dot'; fallback.textContent = '◌'; fallback.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span'); title.className = 'tab-title';
  const badge = document.createElement('span'); badge.className = 'sleep-badge'; badge.textContent = 'z'; badge.setAttribute('aria-hidden', 'true');
  const close = document.createElement('button'); close.className = 'tab-close'; close.title = 'Закрыть вкладку'; close.textContent = '×';
  select.addEventListener('click', () => command('select-tab', id));
  select.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const list = [...nodes.values()]; const index = list.findIndex(node => node.item === item);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[next].select.focus(); list[next].select.click();
  });
  close.addEventListener('click', () => command('close-tab', id));
  item.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); command('close-tab', id); } });
  select.append(icon, fallback, title, badge); item.append(select, close);
  return { item, select, icon, fallback, title, close, favicon: '' };
}
window.browser.onState(state => {
  const ids = new Set(state.tabs.map(tab => tab.id));
  for (const [id, node] of nodes) if (!ids.has(id)) { node.item.remove(); nodes.delete(id); }
  for (const tab of state.tabs) {
    let node = nodes.get(tab.id);
    if (!node) { node = createTabNode(tab.id); nodes.set(tab.id, node); $('tabs').append(node.item); }
    const active = tab.id === state.activeId;
    node.item.className = `tab${active ? ' active' : ''}${tab.sleeping ? ' sleeping' : ''}${tab.loading ? ' loading' : ''}`;
    node.select.setAttribute('aria-label', tab.title);
    node.select.setAttribute('aria-selected', String(active)); node.select.tabIndex = active ? 0 : -1;
    node.select.title = `${tab.title}${tab.sleeping ? ' — спит, нажмите для восстановления' : ''}`;
    if (node.title.textContent !== tab.title) node.title.textContent = tab.title;
    node.close.setAttribute('aria-label', `Закрыть вкладку ${tab.title}`);
    if (node.favicon !== tab.favicon) { node.favicon = tab.favicon; node.icon.hidden = !tab.favicon; if (tab.favicon) node.icon.src = tab.favicon; else node.icon.removeAttribute('src'); }
    node.fallback.hidden = !!tab.favicon;
  }
  document.documentElement.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('toggle-sidebar').setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  const panelLabel = state.sidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель';
  $('toggle-sidebar').setAttribute('aria-label', panelLabel); $('toggle-sidebar').title = panelLabel;
  $('saver-toggle').setAttribute('aria-pressed', String(state.memorySaver));
  $('saver-toggle').title = state.memorySaver ? 'Автоэкономия включена: фоновые вкладки засыпают через 5 минут. Нажмите, чтобы выключить.' : 'Включить автоэкономию памяти';
  $('memory-status').textContent = state.sleeping ? `Спят: ${state.sleeping}` : 'Экономия памяти';
  $('sleep-tabs').disabled = state.tabs.length - state.sleeping <= 1;
  if (state.current) {
    $('home-surface').hidden = !state.current.home;
    lastUrl = state.current.url;
    if (!editing) address.value = lastUrl;
    $('back').disabled = !state.current.canBack; $('forward').disabled = !state.current.canForward;
    $('reload').classList.toggle('is-loading', state.current.loading);
    $('reload').title = state.current.loading ? 'Остановить загрузку' : 'Обновить (Ctrl+R)';
    $('reload').setAttribute('aria-label', state.current.loading ? 'Остановить загрузку' : 'Обновить');
  }
});
