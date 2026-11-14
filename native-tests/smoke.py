#!/usr/bin/env python3
"""Exercise native views with a disposable profile and local pages under Xvfb."""
import http.server
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
requests = []
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        requests.append(self.path)
        if self.path.startswith('/seen'):
            body = b'ok'
        else:
            path = self.path.split('?')[0]
            extra = '<iframe src="/inner"></iframe>' if path == '/frame' else '<video></video>' if path == '/media' else ''
            body = f'''<!doctype html><title>{path}</title>
<style>input{{position:absolute;top:20px;left:20px}}a{{position:absolute;top:70px;left:20px}}</style>
{extra}<input id="draft"><a href="/second">Next</a><button style="position:absolute;top:110px;left:20px" onclick="fetch('/draft?value='+encodeURIComponent(document.querySelector('#draft').value))">Check</button>
<script>addEventListener('pageshow',()=>fetch('/seen{path}?value='+encodeURIComponent(document.querySelector('#draft').value)))</script>'''.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_): pass

def wait_for(predicate, description, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate(): return
        time.sleep(.1)
    raise AssertionError(f'{description}; requests: {requests}')

def xdo(*args): subprocess.run(['xdotool', *map(str, args)], check=True, stdout=subprocess.DEVNULL)
def click(x, y): xdo('mousemove', x, y, 'click', 1)
def key(*keys): xdo('key', *keys)
def address(url):
    click(400, 70); key('ctrl+a'); xdo('type', '--clearmodifiers', url); key('Return')

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
profile = tempfile.mkdtemp(prefix='luma-native-smoke-')
env = os.environ.copy()
env.update({'XDG_DATA_HOME': profile, 'WEBKIT_DISABLE_DMABUF_RENDERER': '1'})
app = subprocess.Popen([str(ROOT / 'target/debug/luma')], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    def app_window():
        result = subprocess.run(['xdotool', 'search', '--onlyvisible', '--name', '^Luma$'], capture_output=True, text=True)
        return result.stdout.splitlines()[-1:] if result.returncode == 0 else []
    wait_for(lambda: app_window() or app.poll() is not None, 'window appears')
    if app.poll() is not None: raise AssertionError('application exited during startup')
    win = app_window()[0]
    xdo('windowfocus', '--sync', win)
    time.sleep(1)
    theme_file = pathlib.Path(profile) / 'Luma' / 'theme'
    click(1238, 135)
    wait_for(lambda: theme_file.exists() and theme_file.read_text() == 'light', 'light theme persisted')
    click(1238, 135)
    wait_for(lambda: theme_file.exists() and theme_file.read_text() == 'dark', 'dark theme persisted')
    address(f'http://127.0.0.1:{server.server_port}/first')
    wait_for(lambda: any(p.startswith('/seen/first') for p in requests), 'first page loaded')
    click(50, 125); xdo('type', '--clearmodifiers', 'draft'); click(50, 175)
    wait_for(lambda: any(p.startswith('/seen/second') for p in requests), 'link opened')
    click(24, 70)
    wait_for(lambda: any(p.startswith('/seen/first?value=draft') for p in requests), 'back restored form without reload')
    click(60, 70)
    wait_for(lambda: sum(p.startswith('/seen/second') for p in requests) >= 2, 'forward navigation')
    click(24, 70)
    wait_for(lambda: sum(p.startswith('/seen/first?value=draft') for p in requests) >= 2, 'second back preserved form')
    click(400, 70); key('ctrl+t')
    time.sleep(.5)
    click(1212, 70)  # Request sleeping in the background.
    time.sleep(1)
    click(70, 20)
    time.sleep(.5)
    click(50, 215)
    wait_for(lambda: any(p.startswith('/draft?value=draft') for p in requests), 'draft preserved while sleeping other tabs')
    address(f'http://127.0.0.1:{server.server_port}/third')
    wait_for(lambda: any(p.startswith('/seen/third') for p in requests), 'third page loaded')
    click(400, 70); key('ctrl+t')  # Open another empty tab.
    time.sleep(.5)
    click(1212, 70)
    time.sleep(2)
    click(70, 20)
    wait_for(lambda: sum(p.startswith('/seen/third') for p in requests) >= 2, 'sleeping tab restored')
    click(24, 70)
    wait_for(lambda: requests.count('/first') >= 2, 'back after restoring sleeping tab')
    click(60, 70)
    wait_for(lambda: requests.count('/third') >= 3, 'forward after restoring sleeping tab')
    for route in ('frame', 'media'):
        address(f'http://127.0.0.1:{server.server_port}/{route}')
        wait_for(lambda: any(p.startswith(f'/seen/{route}') for p in requests), f'{route} loaded')
        click(400, 70); key('ctrl+t')
        time.sleep(.5)
        click(1212, 70)
        time.sleep(1)
        click(70, 20)
        time.sleep(.5)
        before = sum(p == f'/{route}' for p in requests)
        click(50, 215)
        wait_for(lambda: requests.count('/draft?value=') >= (1 if route == 'frame' else 2), f'{route} stays interactive')
        assert sum(p == f'/{route}' for p in requests) == before == 1, f'{route} should remain loaded'
    assert app.poll() is None, 'application remains running after tab switch'
    print('Native smoke passed: address, links, theme persistence, history, draft, iframe and media protection, sleep and restored tab.')
finally:
    app.terminate()
    try: app.wait(timeout=5)
    except subprocess.TimeoutExpired: app.kill(); app.wait()
    server.shutdown(); server.server_close(); shutil.rmtree(profile, ignore_errors=True)
