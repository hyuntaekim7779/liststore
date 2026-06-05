const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'gong-daeri-adventure-3d.html'), 'utf8');

function expectPattern(pattern, message = String(pattern)) {
  assert.ok(pattern.test(html), message);
}

test('F company uses broken elevators and opposite up/down stairs for adjacent-floor movement', () => {
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
});

test('F company offices keep desks, computers, and monitor-facing chairs aligned', () => {
  expectPattern(/function mkDeskStation\(parent,\s*x,\s*z,\s*rot/);
  expectPattern(/function chairRotationForDesk\(rot\)/);
  expectPattern(/mkDenseDeskRows\(fg\)/);
  expectPattern(/mkChair\(chairX,\s*chairZ,\s*chairRot\)/);
  expectPattern(/5층 · AI 사업부/);
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
