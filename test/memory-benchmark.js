'use strict';
const http = require('node:http');
const fs = require('node:fs');
require('./desktop-harness').run(async ({ app, ui, command, navigate, until, wait }) => {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<title>Memory fixture</title><script>window.payload=new Uint8Array(32*1024*1024);window.payload.fill(42)</script>Memory fixture');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (let i = 0; i < 6; i++) {
      if (i) await command('new-tab');
      await navigate(`http://127.0.0.1:${server.address().port}/${i}`);
    }
    if (process.argv.includes('--sleep')) {
      await command('sleep-tabs');
      await until(() => ui("document.querySelectorAll('.tab.sleeping').length === 5"));
    }
    await wait(1000);
    const pids = app.getAppMetrics().map(metric => metric.pid);
    let pssKiB = 0;
    for (const pid of new Set(pids)) {
      try { pssKiB += Number(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m)[1]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    console.log(JSON.stringify({ scenario: '6 local pages × 32 MiB', sleeping: process.argv.includes('--sleep'), pssMiB: Math.round(pssKiB / 1024 * 10) / 10, processes: pids.length }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
