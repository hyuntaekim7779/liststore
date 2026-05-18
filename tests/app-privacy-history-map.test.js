const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const mapsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'maps.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('vote results stay secret and summarize voters by role only', () => {
  assert.match(appSource, /function\s+formatVoteRoleSummary\(voters\)/);
  assert.match(appSource, /vote-role-summary/);
  assert.doesNotMatch(appSource, /voters\.map\(escapeHtml\)\.join\(', '\)/);
});

test('vote setup hint does not say names are hidden before creation', () => {
  assert.match(htmlSource, /투표 대상자 선택 목록은 투표 생성 후 표시됩니다\./);
  assert.doesNotMatch(htmlSource, /생성 전에는 이름이 표시되지 않습니다/);
});

test('random history clear all uses custom admin modal title instead of browser prompt', () => {
  assert.match(appSource, /await\s+verifyHistoryAdminPassword\('랜덤 \/ 후보 기록 전체 기록 삭제'\)/);
  assert.match(appSource, /confirmAppDialog\(\s*'랜덤 \/ 후보 기록 전체 기록 삭제'/);
  assert.doesNotMatch(appSource, /prompt\('기록 삭제 비밀번호를 입력하세요\.'\)/);
  assert.doesNotMatch(appSource, /confirm\(`\$\{targetMeal === 'all'/);
});

test('vote delete admin confirmation has a dedicated cute modal variant', () => {
  assert.match(appSource, /vote-delete-confirm-modal/);
  assert.match(appSource, /투표를 정리할 수 있어요/);
  assert.match(appSource, /confirmAppDialog\(\s*'🧺 투표 종료\/삭제'/);
});

test('map location button reloads only the map module before moving to fixed location', () => {
  assert.match(appSource, /await\s+Maps\.reload\('map'\)/);
  assert.match(mapsSource, /async\s+reload\(containerId\)/);
  assert.match(mapsSource, /reloadNaverMapScript\(\)/);
});
