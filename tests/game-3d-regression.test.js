const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'gong-daeri-adventure-3d.html'), 'utf8');

function expectPattern(pattern, message = String(pattern)) {
  assert.ok(pattern.test(html), message);
}

test('only F company uses broken elevators and opposite up/down stairs for adjacent-floor movement', () => {
  expectPattern(/const UP_STAIRS_POS\s*=/);
  expectPattern(/const DOWN_STAIRS_POS\s*=/);
  expectPattern(/type:\s*'broken-elevator'/);
  expectPattern(/function showBrokenElevatorModal\(\)/);
  expectPattern(/function showBldBrokenElevator\(\)/);
  expectPattern(/type:\s*'stairs-up'/);
  expectPattern(/type:\s*'stairs-down'/);
  expectPattern(/function landingPosForStairs\(dir\)/);
  expectPattern(/stairsGo\('up'\)/);
  expectPattern(/stairsGo\('down'\)/);
  expectPattern(/function mkElevator\(parent,\s*broken=false\)/);
  expectPattern(/mkElevator\(fg,\s*true\)/);
  expectPattern(/mkElevator\(g\)/);
  expectPattern(/cands\.push\(\{ type:\s*'elevator'/);
  expectPattern(/if \(it\.type === 'elevator'\) showBldElevator\(\)/);
  expectPattern(/function bldElevGo\(n\) \{ hideModal\(\); state\.mode = 'building'; setBldFloor\(n,/);
});

test('F company offices keep desks, computers, and monitor-facing chairs aligned', () => {
  expectPattern(/function mkDeskStation\(parent,\s*x,\s*z,\s*rot/);
  expectPattern(/function chairRotationForDesk\(rot\)/);
  expectPattern(/mkDenseDeskRows\(fg\)/);
  expectPattern(/mkChair\(chairX,\s*chairZ,\s*chairRot\)/);
  expectPattern(/function addOfficeBlocker\(parent,\s*x,\s*z,\s*rot/);
  expectPattern(/function isBlockedByOfficeFurniture\(group,\s*x,\s*z/);
  expectPattern(/5층 · AI 사업부/);
});

test('down stairs use a descending step profile instead of mirroring the up stairs', () => {
  expectPattern(/function stairStepHeight\(i,\s*isUp\)/);
  expectPattern(/isUp \? 0\.4 \+ i \* 0\.4 : 2\.0 - i \* 0\.4/);
  expectPattern(/step\.position\.set\(0,\s*h \/ 2,\s*isUp \? -i \* 1 : i \* 1\)/);
});

test('5F AI division contains named desks plus five extra desks', () => {
  expectPattern(/function mkAiBusinessDivision\(parent\)/);
  for (const name of ['성수석', '채정영책임', '박찌오전임']) {
    expectPattern(new RegExp(name));
  }
  const layout = html.match(/const AI_DIVISION_DESKS = \[([\s\S]*?)\];/);
  assert.ok(layout, 'AI_DIVISION_DESKS layout should be declared');
  const deskCount = (layout[1].match(/\{ x:/g) || []).length;
  assert.equal(deskCount, 8);
});

test('reentry seats Gong and Yong at computer desks facing the monitors', () => {
  expectPattern(/const FSA_REENTRY_DESKS\s*=/);
  expectPattern(/function poseAtDeskSeat\(mesh,\s*station\)/);
  expectPattern(/function resetDeskPose\(mesh\)/);
  expectPattern(/poseAtDeskSeat\(player,\s*FSA_REENTRY_DESKS\.gong\)/);
  expectPattern(/poseAtDeskSeat\(zombieYong,\s*FSA_REENTRY_DESKS\.yong\)/);
  expectPattern(/resetDeskPose\(player\)/);
  expectPattern(/resetDeskPose\(zombieYong\)/);
});

test('B key phone animation brings the phone hand toward the face, not just straight upward', () => {
  expectPattern(/function animatePhoneHandToFace\(progress\)/);
  expectPattern(/arm\.position\.z\s*=/);
  expectPattern(/arm\.position\.y\s*=/);
  expectPattern(/arm\.rotation\.z\s*=/);
  expectPattern(/arm\.userData\.phoneRaiseStart/);
});

test('battle keyboard highlight follows the selected action instead of staying on the first skill', () => {
  expectPattern(/function battleBtnClass\(base,\s*index\)/);
  expectPattern(/b\.menuIndex === index \? `\$\{base\} sel kbd-active` : base/);
  expectPattern(/Object\.entries\(state\.player\.skills\)\.map\(\(\[s,lvl\],\s*i\)/);
  expectPattern(/battleBtnClass\('btn attack full-width',\s*i\)/);
});

test('leaving a building clears the stale building-exit hint', () => {
  expectPattern(/function clearHudHint\(\)/);
  expectPattern(/function finishBuilding\(\)[\s\S]*clearHudHint\(\);/);
  expectPattern(/state\.currentBuilding = null; clearHudHint\(\); updateHint\(\); updateStatsHUD\(\); updateInfoHUD\(\);/);
});
