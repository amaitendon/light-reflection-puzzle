#!/usr/bin/env node
/* 公式ステージパッケージを stages/ に永続登録する CLI
   使い方: node scripts/publish-stage.js path/to/stage-004-official.json */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const stagesDir = path.join(root, 'stages');
const indexPath = path.join(stagesDir, 'index.json');

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function stageIdToNumber(id) {
  const m = String(id).match(/stage-(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function nextStageId(manifest) {
  const nums = (manifest.stages || []).map(s => stageIdToNumber(s.id));
  const max = nums.length ? Math.max(...nums) : 0;
  return `stage-${String(max + 1).padStart(3, '0')}`;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('使い方: node scripts/publish-stage.js <official-stage.json>');
    process.exit(1);
  }

  const absInput = path.resolve(inputPath);
  if (!fs.existsSync(absInput)) {
    console.error('ファイルが見つかりません:', absInput);
    process.exit(1);
  }

  const pkg = readJSON(absInput);
  if (!pkg.level || !pkg.level.sources || !pkg.level.goals) {
    console.error('無効なステージデータです（level.sources / level.goals が必要）');
    process.exit(1);
  }

  const manifest = readJSON(indexPath);
  const id = pkg.id && !manifest.stages.some(s => s.id === pkg.id)
    ? pkg.id
    : nextStageId(manifest);

  const stageFileName = `${id}.json`;
  const stageFilePath = path.join(stagesDir, stageFileName);
  const stageData = {
    name: pkg.name || pkg.title || '無題のステージ',
    level: pkg.level,
  };

  const entry = {
    id,
    file: `stages/${stageFileName}`,
    title: pkg.title || pkg.name || stageData.name,
    difficulty: pkg.difficulty || 1,
    tags: pkg.tags || [],
    description: pkg.description || '',
  };

  const existingIdx = manifest.stages.findIndex(s => s.id === id);
  if (existingIdx >= 0) {
    manifest.stages[existingIdx] = entry;
    console.log('更新:', id);
  } else {
    manifest.stages.push(entry);
    console.log('追加:', id);
  }

  writeJSON(stageFilePath, stageData);
  writeJSON(indexPath, manifest);

  console.log('  ステージファイル:', path.relative(root, stageFilePath));
  console.log('  マニフェスト更新:', path.relative(root, indexPath));
  console.log('  プレイURL: light-reflection-puzzle.html?stage=' + id);
}

main();
