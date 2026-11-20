'use strict';
// Diagnostic replay of one recorded case. Never creates a delivery approval.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const build = require('../../scripts/build-palette-native.cjs');
const traceModule = require('../../scripts/conversion-trace.cjs');

const root = path.resolve(__dirname, '../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const artifact = file => ({ path: file, sha256: hash(fs.readFileSync(file)) });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const manifest = read('manifest.json');
for (const [file, expected] of Object.entries(manifest.files)) {
  assert.equal(hash(fs.readFileSync(path.join(__dirname, file))), expected, 'Evidence changed: ' + file);
}
const inputs = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'inputs.json.gz'))));
const outputRoot = path.join(root, 'outputs');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'rapi-fringe-replay-'));
const sourcePath = path.join(__dirname, 'source.png');
const palettePath = path.join(__dirname, 'palette.json');
const beforePath = path.join(__dirname, 'before.native.png');
// Only file bindings change. This record is explicitly a transport derivative,
// not an original signed run, stage ledger, or new visual approval.
const prior = inputs.priorRun;
prior.source = artifact(sourcePath);
prior.palette = artifact(palettePath);
prior.native = artifact(beforePath);
const priorPath = path.join(output, 'transport-prior-run.json');
write(priorPath, prior);
inputs.material.preserveOutside.baseline = artifact(beforePath);
inputs.material.preserveOutside.baselineRun = artifact(priorPath);
const materialPath = path.join(output, 'material.json');
write(materialPath, inputs.material);

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const palette = build.parsePalette(read('palette.json'));
const policies = inputs.policies;
const trace = traceModule.createTrace(path.join(output, 'stages'), { source: artifact(sourcePath), cell: 8 });
try {
  const result = build.buildNative(PNG, source, palette, 128, 192, '#FFF7E6',
    'source-region-area', null, null, null, policies.eyePolicy, policies.formPolicy,
    policies.outlinePolicy, artifact(materialPath), trace.record);
  const expanded = build.enlarge(PNG, result.image, 8);
  const save = (name, image) => fs.writeFileSync(path.join(output, name), PNG.sync.write(image));
  save('native.png', result.image);
  save('display.png', expanded);
  const expected = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'after.native.png')));
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  let differentFromExpected = 0;
  let differentFromBefore = 0;
  for (let p = 0; p < result.image.width * result.image.height; p++) {
    const actual = result.image.data.readUInt32BE(p * 4);
    if (actual !== expected.data.readUInt32BE(p * 4)) differentFromExpected++;
    if (actual !== before.data.readUInt32BE(p * 4)) differentFromBefore++;
  }
  const report = {
    status: differentFromExpected ? 'DIFFERS_FROM_RECORDED_RESULT' : 'RECORDED_PIXELS_REPRODUCED',
    visualApproval: 'NOT_ASSESSED_BY_REPLAY', differentFromExpected, differentFromBefore,
    native: artifact(path.join(output, 'native.png')),
    expanded: artifact(path.join(output, 'display.png')),
    stats: build.inspect(result.image, palette),
    outline: result.outlineReport, eyes: result.eyePolicyReport, forms: result.formReport,
  };
  write(path.join(output, 'result.json'), report);
  trace.finish('BUILT');
  console.log(JSON.stringify({ output, status: report.status, differentFromExpected, differentFromBefore }, null, 2));
  // After a deliberate fix, a difference needs new direct review; do not update
  // golden PNGs merely to make this replay return zero.
  if (differentFromExpected) process.exitCode = 1;
} catch (error) {
  trace.finish('FAILED', error.message);
  throw error;
}
