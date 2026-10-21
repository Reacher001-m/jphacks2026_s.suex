import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  validateStage,
  validateStageCollection,
} from '@shortcut-dungeon/stage-schema';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageDirectory = join(root, 'src', 'data', 'stages');

function readStage(fileName) {
  return JSON.parse(readFileSync(join(stageDirectory, fileName), 'utf8'));
}

function validEntries() {
  return [
    { file: 'crate-intro.json', stage: readStage('crate-intro.json') },
    { file: 'copy-gate-maze.json', stage: readStage('copy-gate-maze.json') },
  ];
}

function codes(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

test('既存ステージは単体・コレクションともエラーにならない', () => {
  for (const { stage } of validEntries()) {
    const result = validateStage(stage);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }

  const collection = validateStageCollection(validEntries());
  assert.equal(collection.ok, true, JSON.stringify(collection.errors));
});

test('idの重複とファイル名不一致を検出する', () => {
  const entries = validEntries();
  entries[1].stage.id = 'crate-intro';
  entries[1].file = 'copy-gate-maze.json';

  const result = validateStageCollection(entries);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E004'));
});

test('numberの重複を検出する', () => {
  const entries = validEntries();
  entries[1].stage.number = 1;
  entries[1].stage.id = 'another-stage';
  entries[1].file = 'another-stage.json';

  const result = validateStageCollection(entries);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E005'));
});

test('同一マスへの配置を検出する', () => {
  const stage = readStage('crate-intro.json');
  stage.items[0].x = stage.start.x;
  stage.items[0].y = stage.start.y;

  const result = validateStage(stage);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E008'));
});

test('未知フィールドを検出する', () => {
  const stage = readStage('crate-intro.json');
  stage.unexpected = true;

  const result = validateStage(stage);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E014'));
});

test('範囲外の壁を検出する', () => {
  const stage = readStage('crate-intro.json');
  stage.obstacles[0].x = 23;

  const result = validateStage(stage);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E007'));
});

test('必須フィールド欠落を検出する', () => {
  const stage = readStage('crate-intro.json');
  delete stage.goal;

  const result = validateStage(stage);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E001'));
});

test('閉じたゲートと壁の重複をE009で検出する', () => {
  const stage = readStage('crate-intro.json');
  stage.shortcutGate = { x: 8, y: 1 };

  const result = validateStage(stage);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E009'));
});

test('ステージ0件を検出する', () => {
  const result = validateStageCollection([]);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes('E016'));
});
