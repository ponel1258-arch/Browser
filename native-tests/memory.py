#!/usr/bin/env python3
"""Report Linux proportional resident memory for Luma and its child processes."""
import os, pathlib, re, shutil, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parent.parent
profile = tempfile.mkdtemp(prefix='luma-native-memory-')
env = os.environ.copy()
env.update({'XDG_DATA_HOME': profile, 'WEBKIT_DISABLE_DMABUF_RENDERER': '1'})
app = subprocess.Popen([str(root/'target/debug/luma')], cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(4)
    if app.poll() is not None: raise RuntimeError('Browser exited during startup')
    rows = subprocess.check_output(['ps','-eo','pid=,ppid='], text=True).splitlines()
    pairs = [tuple(map(int, row.split())) for row in rows]
    ids = {app.pid}
    while True:
        before = len(ids)
        ids.update(pid for pid, ppid in pairs if ppid in ids)
        if before == len(ids): break
    total = 0
    for pid in ids:
        try:
            data = pathlib.Path(f'/proc/{pid}/smaps_rollup').read_text()
            total += int(re.search(r'^Pss:\s+(\d+)', data, re.M).group(1))
        except (FileNotFoundError, ProcessLookupError): pass
    print(f'1 blank tab: {total/1024:.1f} MiB PSS, {len(ids)} processes (including WebKit)')
finally:
    app.terminate()
    try: app.wait(timeout=5)
    except subprocess.TimeoutExpired: app.kill(); app.wait()
    shutil.rmtree(profile, ignore_errors=True)
