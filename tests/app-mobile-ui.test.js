const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('mobile assignment tags open a touch-only move menu', () => {
  assert.match(appSource, /function\s+isMobileAssignmentMode\(\)/);
  assert.match(appSource, /matchMedia\('\(max-width:\s*560px\)'\)/);
  assert.match(appSource, /function\s+showMobileAssignmentMenu\(name,\s*currentGroup\)/);
  assert.match(appSource, /assignment-move-modal/);
  assert.match(appSource, /movePersonToGroup\(name,\s*selectedGroup\)/);
  assert.match(appSource, /tag\.addEventListener\('click',\s*\(e\)\s*=>\s*{/);
});

test('mobile layout compresses hero images tabs and meal panels without changing desktop defaults', () => {
  assert.match(stylesSource, /\.tabs-side-img\s*{\s*width:\s*400px;\s*height:\s*200px;/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*560px\)\s*{[\s\S]*body\s*{[\s\S]*background:\s*#101116;/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*560px\)\s*{[\s\S]*\.tabs-side-img\s*{[\s\S]*width:\s*min\(80vw,\s*320px\);[\s\S]*height:\s*clamp\(112px,\s*32vw,\s*150px\);/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*560px\)\s*{[\s\S]*\.meal-tabs\s*{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*560px\)\s*{[\s\S]*\.roulette-stage\s*{[\s\S]*width:\s*min\(100%,\s*360px\);/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*560px\)\s*{[\s\S]*\.assignment-move-modal\s*{[\s\S]*background:\s*#1d1d22;/);
});
