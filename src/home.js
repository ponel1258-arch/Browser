'use strict';
const today = new Date();
const date = document.getElementById('today');
date.textContent = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long' }).format(today);
date.dateTime = today.toISOString();
const toggle = document.getElementById('theme');
function setTheme(light) {
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  const label = light ? 'Включить тёмную тему' : 'Включить светлую тему';
  toggle.setAttribute('aria-label', label); toggle.title = label;
  document.querySelector('meta[name="theme-color"]').content = light ? '#f2f3f7' : '#17191e';
}
let light = false;
try { light = localStorage.getItem('luma-theme') === 'light'; } catch {}
setTheme(light);
toggle.addEventListener('click', () => {
  light = !light; setTheme(light);
  try { localStorage.setItem('luma-theme', light ? 'light' : 'dark'); } catch {}
});

// This trusted local page shares the shell renderer. All web navigation is
// forwarded to the main browser; remote pages never load inside this frame.
if (window.parent !== window) {
  const navigate = target => window.parent.postMessage({ type: 'luma-navigate', target }, '*');
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link && /^https?:/.test(link.href)) { event.preventDefault(); navigate(link.href); }
  });
  document.querySelector('.search').addEventListener('submit', event => {
    event.preventDefault();
    const query = document.getElementById('search').value.trim();
    if (query) navigate(query);
  });
}
