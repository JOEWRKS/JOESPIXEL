'use strict';
// Run each existing test in its own process; avoid shared fixtures/module state.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tests = fs.readdirSync(__dirname)
  .filter(name => /^test-.*\.cjs$/.test(name) && name !== path.basename(__filename)).sort();
let failed = 0;
for (const name of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed++;
    console.error(name + ': FAIL\n' + result.stdout + result.stderr);
  } else console.log(name + ': PASS\n' + result.stdout.trim().split(/\r?\n/).at(-1));
}
console.log(`${tests.length - failed}/${tests.length} test files passed. Synthetic tests do not approve artwork.`);
process.exitCode = failed ? 1 : 0;
