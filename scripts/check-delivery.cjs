#!/usr/bin/env node
'use strict';

// Read-only delivery gate. It verifies files and review coverage, NOT visual truth.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePalette, inspect, exactBlocks } = require('./build-palette-native.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function requireValue(condition, message) { if (!condition) throw new Error(message); }

function checkDelivery(contractPath, reviewPath, PNG) {
  const contractBytes = fs.readFileSync(contractPath);
  const contract = JSON.parse(contractBytes);
  const review = JSON.parse(fs.readFileSync(reviewPath));
  requireValue(!contract.redesign && !contract.measuredConversion && !contract.mode, 'Retired conversion route; use the seven-stage fixed-grid workflow');
  requireValue(contract.eyePolicy?.coordinateSource !== 'reference', 'Eye coordinates must use the current pixel design');
  const contractDir = path.dirname(path.resolve(contractPath));
  const reviewDir = path.dirname(path.resolve(reviewPath));
  const issues = [];
  const add = (gate, status, detail) => issues.push({ gate, status, detail });
  const hashes = {};
  try {
    require('./stage-gates.cjs').assertProductionStages(contract.stageChecks,2);
    require('./stage-gates.cjs').assertProductionStages(review.stageChecks,5,{
      outputSha256:review.native?.sha256,
      paletteSha256:contract.palette?.sha256,
      pixelSourceSha256:contract.source?.sha256,
      prefix:contract.stageChecks
    });
    if(!contract.stageChecks)throw Error('Conversion must retain its passed stage snapshot');
  } catch(error) { add('shape',error.status==='FAIL'?'FAIL':'UNVERIFIED',error.message); }
  function readArtifact(spec, dir, name) {
    requireValue(spec && nonempty(spec.path) && /^[a-f0-9]{64}$/i.test(spec.sha256), 'Invalid artifact: ' + name);
    const bytes = fs.readFileSync(path.resolve(dir, spec.path));
    hashes[name] = sha(bytes);
    if (hashes[name] !== spec.sha256.toLowerCase()) add('evidence', 'UNVERIFIED', name + ': hash changed');
    return bytes;
  }
  requireValue(contract.version === 1 && review.version === 1, 'Unsupported contract/review version');
  for (const key of ['width', 'height', 'scale', 'paletteCount']) {
    requireValue(Number.isSafeInteger(contract[key]) && contract[key] > 0, 'Invalid ' + key);
  }
  requireValue(['opaque', 'binary'].includes(contract.alpha), 'Explicit alpha policy required');
  requireValue(nonempty(contract.displayTarget), 'Actual display target required');
  const fit = contract.sourceToNative;
  requireValue(fit && ['scaleX', 'scaleY', 'offsetX', 'offsetY'].every(key => Number.isFinite(fit[key])) &&
    fit.scaleX > 0 && fit.scaleY > 0, 'Explicit source-to-native mapping required');
  requireValue(Array.isArray(contract.features) && contract.features.length > 0, 'Source-derived feature inventory required');
  const ids = contract.features.map(feature => feature.id);
  requireValue(ids.every(nonempty) && !ids.includes('$whole') && new Set(ids).size === ids.length, 'Unique feature ids required');
  for (const feature of contract.features) {
    requireValue(nonempty(feature.criterion) && nonempty(feature.sourceObservation), 'Feature needs source observation and criterion: ' + feature.id);
  }
  const requiredFindings = contract.requiredFindings || [];
  requireValue(Array.isArray(requiredFindings) && requiredFindings.every(nonempty) &&
    new Set(requiredFindings).size === requiredFindings.length, 'Unique required finding ids expected');
  const source = PNG.sync.read(readArtifact(contract.source, contractDir, 'source'));
  require('./build-palette-native.cjs').assertFixedGridPlacement(contract,source);
  const palette = parsePalette(JSON.parse(readArtifact(contract.palette, contractDir, 'palette')));
  const eyeRules=require('./eye-plane-policy.cjs');
  eyeRules.assertEyePolicy(contract.eyePolicy,palette);
  let eyeGrid=null;
  const native = PNG.sync.read(readArtifact(review.native, reviewDir, 'native'));
  const expanded = PNG.sync.read(readArtifact(review.expanded, reviewDir, 'expanded'));
  try { require('./stage-gates.cjs').assertProductionStages(review.stageChecks,5,{grid:{canvas:[expanded.width,expanded.height],cell:contract.scale}}); }
  catch(error) { add('shape',error.status==='FAIL'?'FAIL':'UNVERIFIED',error.message); }
  const stats = inspect(native, palette);
  if (native.width !== contract.width || native.height !== contract.height) add('technical', 'FAIL', 'Native size mismatch');
  if (palette.length !== contract.paletteCount) add('technical', 'FAIL', 'Palette entry count mismatch');
  if (stats.offPalettePixels) add('technical', 'FAIL', 'Pixels outside fixed palette: ' + stats.offPalettePixels);
  if (stats.partialAlphaPixels || (contract.alpha === 'opaque' && stats.transparentPixels)) add('technical', 'FAIL', 'Alpha policy violated');
  if (!exactBlocks(native, expanded, contract.scale)) add('technical', 'FAIL', 'Expanded file is not exact integer replication');

  eyeGrid??=eyeRules.affineEyeGrid(source,native,{fitWidth:source.width*fit.scaleX,fitHeight:source.height*fit.scaleY,offsetX:fit.offsetX,offsetY:fit.offsetY});
  const eyeSource=source;
  const material=contract.materialPlan?require('./material-assignment.cjs').compile(PNG,source,palette,native.width,native.height,require('./material-assignment.cjs').readPlan(contract.materialPlan),{eyePolicy:contract.eyePolicy,formPolicy:contract.formPolicy??null,outlinePolicy:contract.outlinePolicy??null}):null;
  if(material)require('./build-palette-native.cjs').resolveSourcePlanes(PNG,source,palette,native.width,native.height,contract.eyePolicy,material,
    {coherentPlanes:true,preserveSmallRegions:contract.outlinePolicy?.layout==='joint-source-band'});
  const savedEyeAudit=eyeRules.auditEyePolicy(PNG,eyeSource,native,palette,contract.eyePolicy,eyeGrid,material);
  if(savedEyeAudit.status==='FAIL')add('technical','FAIL','Saved eyes violate flat-role policy: '+savedEyeAudit.nonconformingCells);
  if(material&&contract.outlinePolicy?.layout!=='joint-source-band'){const audit=require('./material-assignment.cjs').audit(native,material);if(audit.violations)add('shape','FAIL','Stored material assignment violated: '+audit.violations);}
  if(contract.outlinePolicy){
    try{
      if(contract.outlinePolicy.observedStrokes||contract.outlinePolicy.layout==='joint-source-band'){
        // The exterior pass clears redundant source rim before internal
        // contact paths are assigned. Reapplying that pass alone to the final
        // composite erases valid internal contacts. Verify the complete locked
        // source pipeline instead; this checks every saved pixel, not just rim.
        const sampling=contract.stageChecks.stages[0].execution.sampling;
        const rebuilt=require('./build-palette-native.cjs').buildNative(PNG,source,palette,contract.width,contract.height,contract.background,sampling,null,null,null,contract.eyePolicy,contract.formPolicy??null,contract.outlinePolicy,contract.materialPlan??null);
        if(rebuilt.outlineReport?.savedWidth?.renderedStrokeChecked!==true)add('shape','UNVERIFIED','Required actual rendered-stroke thickness audit was not executed');
        if(contract.outlinePolicy.layout==='joint-source-band'){
          const audit=require('./raster-owned-stroke-bands.cjs').auditRenderedStrokeBands(native,rebuilt.outlineReport);
          if(audit.renderedStrokeChecked!==true||audit.status!=='PASS')add('shape',audit.status==='UNVERIFIED'?'UNVERIFIED':'FAIL','Saved PNG stroke width/continuity: '+JSON.stringify(audit));
          if(material){
            const allocations=new Map([...rebuilt.outlineReport.expectedColors,...rebuilt.outlineReport.expectedFillColors]);
            const colors=require('./material-assignment.cjs').audit(native,material,allocations);
            if(colors.violations)add('shape','FAIL','Stored material assignment violated: '+colors.violations);
          }
        }
        if(!rebuilt.image.data.equals(native.data))add('shape','FAIL','Stored image differs from complete source material/eye/outline placement');
      }else{
      const {allocateOnePixelOutline,protectOutlineFeatures}=require('./raster-outline-contour.cjs');
      const outline=allocateOnePixelOutline(PNG,source,native,palette,eyeGrid,protectOutlineFeatures(contract.outlinePolicy,contract.eyePolicy,contract.formPolicy),material?.interior,material);
      if(outline.report?.savedWidth?.renderedStrokeChecked!==true)add('shape','UNVERIFIED','Required actual rendered-stroke thickness audit was not executed');
      if(!outline.image.data.equals(native.data))add('shape','FAIL','Stored outline differs from the declared one-pixel source path allocation');
      }
    }catch(error){add('shape','FAIL','Stored one-pixel outline: '+error.message);}
  }
  if(contract.formPolicy){
    const forms=require('./raster-observed-details.cjs').allocateRequiredForms(PNG,source,native,eyeGrid,palette,contract.formPolicy,material);
    if(forms.report.unresolved.length)add('shape','FAIL','Required forms cannot fit: '+forms.report.unresolved.join(', '));
    if(!forms.image.data.equals(native.data))add('shape','FAIL','Stored pixels do not retain the declared required forms and simplification');
  }
  // A partial edit may preserve a bad feature. This check is never shape approval.
  let preservation = null;
  if (contract.baseline) {
    const base = PNG.sync.read(readArtifact(contract.baseline, contractDir, 'baseline'));
    const allowed = contract.allowedRects;
    const protectedRects = contract.protectedRects || [];
    requireValue(Array.isArray(allowed) && allowed.length > 0 && Array.isArray(protectedRects), 'Partial edit requires allowedRects');
    for (const rect of [...allowed, ...protectedRects]) {
      requireValue(Array.isArray(rect) && rect.length === 4 && rect.every(Number.isSafeInteger) &&
        rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0 &&
        rect[0] + rect[2] <= contract.width && rect[1] + rect[3] <= contract.height, 'Invalid preservation rectangle');
    }
    if (base.width !== native.width || base.height !== native.height) add('preservation', 'FAIL', 'Baseline size mismatch');
    else {
      const inside = (rect, x, y) => x >= rect[0] && y >= rect[1] && x < rect[0]+rect[2] && y < rect[1]+rect[3];
      preservation = { changed: 0, outsideAllowed: 0, insideProtected: 0 };
      for (let y = 0; y < native.height; y++) for (let x = 0; x < native.width; x++) {
        const i = (y * native.width + x) * 4;
        if (native.data.subarray(i, i+4).equals(base.data.subarray(i, i+4))) continue;
        preservation.changed++;
        if (!allowed.some(rect => inside(rect, x, y))) preservation.outsideAllowed++;
        if (protectedRects.some(rect => inside(rect, x, y))) preservation.insideProtected++;
      }
      if (preservation.outsideAllowed || preservation.insideProtected) add('preservation', 'FAIL', 'Change outside authorized region or inside protected region');
    }
  } else requireValue(!contract.allowedRects && !contract.protectedRects, 'Preservation rectangles need a baseline');

  if (review.contractSha256 !== sha(contractBytes)) add('evidence', 'UNVERIFIED', 'Review belongs to a different contract');
  if (!nonempty(review.reviewer)) add('evidence', 'UNVERIFIED', 'Missing reviewer');
  requireValue(Array.isArray(review.evidence), 'Evidence list required (may be empty for incomplete review)');
  const evidenceIds = new Set();
  for (const entry of review.evidence) {
    requireValue(nonempty(entry.id) && !evidenceIds.has(entry.id), 'Duplicate or empty evidence id');
    evidenceIds.add(entry.id);
    PNG.sync.read(readArtifact(entry, reviewDir, 'evidence:' + entry.id));
    if (!entry.bindings || entry.bindings.source !== hashes.source || entry.bindings.native !== hashes.native ||
      (contract.baseline && entry.bindings.baseline !== hashes.baseline)) {
      add('evidence', 'UNVERIFIED', entry.id + ': source/output/baseline binding missing or stale');
    }
  }
  const comparisons=new Set();
  function observation(item, label, gate) {
    if (!item || !['PASS', 'FAIL', 'UNVERIFIED'].includes(item.status) || !nonempty(item.observation) ||
      !Array.isArray(item.evidence) || !item.evidence.length || !item.evidence.every(id => evidenceIds.has(id))) {
      add(gate, 'UNVERIFIED', label + ': observation and valid evidence required');
      return;
    }
    const c=item.comparison,r=c?.sourceRegion;
    if(!c||!['difference','criterion','reason'].every(k=>nonempty(c[k]))||
      !Array.isArray(r)||r.length!==4||!r.every(Number.isInteger)||r[0]<0||r[1]<0||r[2]<=0||r[3]<=0||r[0]+r[2]>source.width||r[1]+r[3]>source.height){
      add(gate,'UNVERIFIED',label+': separate source region, observed difference, criterion and verdict reason required');return;
    }
    const key=JSON.stringify([r,c.difference.trim(),c.criterion.trim(),c.reason.trim()]);
    if(comparisons.has(key))add(gate,'UNVERIFIED',label+': duplicated comparison is not an independent review');
    comparisons.add(key);
    if (item.status !== 'PASS') add(gate, item.status, label + ': ' + item.observation);
  }
  // Review extraction/mapping first; converter diagnostics cannot certify their own input.
  observation(review.sourceReview, 'Source feature identification and mapping', 'shape');
  // The generated design is not the raster draft. Both its conversion losses
  // and the actual fixed-grid image must be reviewed before the raster is locked.
  observation(review.gridDraft?.sourceComparison,'Generated design to grid draft changes','shape');
  observation(review.gridDraft?.visual,'Actual fixed-grid draft appearance','shape');
  if(contract.eyePolicy.visibility==='visible')for(const key of ['flatColors','shape','reflection'])
    observation(review.eyeReview?.[key],'eyes/'+key,'shape');
  requireValue(Array.isArray(review.features), 'Feature reviews required (may be empty)');
  const rows = new Map();
  for (const row of review.features) {
    requireValue([...ids, '$whole'].includes(row.id) && !rows.has(row.id), 'Unknown or duplicate review feature');
    rows.set(row.id, row);
  }
  for (const id of ['$whole', ...ids]) {
    observation(rows.get(id)?.clarity, id + '/clarity', 'shape');
    observation(rows.get(id)?.fidelity, id + '/fidelity', 'shape');
  }
  if(contract.outlineDecision?.width===1)for(const id of ['outline'])
    for(const aspect of ['continuity','thickness','staircase','colorSeparation'])
      observation(rows.get(id)?.boundary?.[aspect],id+'/'+aspect,'shape');
  for (const mode of ['native', 'zoom', 'display']) observation(review.views?.[mode], mode + ' view', 'shape');
  requireValue(Array.isArray(review.findings), 'Explicit findings list required');
  const findingIds = new Set();
  for (const finding of review.findings) {
    requireValue(nonempty(finding.id) && nonempty(finding.description) && !findingIds.has(finding.id), 'Unique finding id and description required');
    findingIds.add(finding.id);
    if (finding.status === 'RESOLVED') observation(finding.verification, finding.id + '/resolution', 'shape');
    else add('shape', finding.status === 'OPEN' ? 'FAIL' : 'UNVERIFIED', finding.id + ': ' + finding.description);
  }
  for (const id of requiredFindings) if (!findingIds.has(id)) add('shape', 'UNVERIFIED', id + ': known finding omitted');
  const status = issues.some(issue => issue.status === 'FAIL') ? 'NEEDS_REWORK' :
    issues.length ? 'UNVERIFIED' : 'READY_FOR_USER_REVIEW';
  const gateStatus = gate => issues.some(issue => issue.gate === gate && issue.status === 'FAIL') ? 'FAIL' :
    issues.some(issue => issue.gate === gate) ? 'UNVERIFIED' : 'PASS';
  return { version: 1, status, technical: gateStatus('technical'), evidence: gateStatus('evidence'),
    preservation: contract.baseline ? gateStatus('preservation') : 'NOT_APPLICABLE',
    shapeReview: gateStatus('shape'), userAcceptance: 'NOT_ASSESSED',
    limitation: 'Shape states validate distinct, source-bound review records, not visual truth or automatic feature recognition.',
    contractSha256: sha(contractBytes), reviewSha256: sha(fs.readFileSync(reviewPath)), hashes,
    sourceSize: [source.width, source.height], native: stats, changes: preservation, savedEyeAudit, issues };
}

module.exports = { checkDelivery };
if (require.main === module) {
  try {
    requireValue(process.argv.length === 4, 'Usage: node check-delivery.cjs contract.json review.json');
    const { PNG } = require(require.resolve('pngjs', { paths: [__dirname, process.cwd()] }));
    const report = checkDelivery(process.argv[2], process.argv[3], PNG);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'READY_FOR_USER_REVIEW' ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ status: 'UNVERIFIED', error: error.message }));
    process.exitCode = 2;
  }
}
