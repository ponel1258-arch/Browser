'use strict';
const fs = require('node:fs');
require('./desktop-harness').run(async ({ app, command, wait }) => {
  async function measure(label) {
    await wait(750);
    const metrics = app.getAppMetrics();
    let pssKiB = 0;
    for (const { pid } of metrics) {
      try { pssKiB += Number(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m)[1]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    console.log(JSON.stringify({ label, pssMiB: +(pssKiB / 1024).toFixed(1), processes: metrics.length, renderers: metrics.filter(metric => metric.type === 'Tab').length }));
  }
  await measure('1 empty tab');
  for (let i = 1; i < 20; i++) await command('new-tab');
  await measure('20 empty tabs');
});
