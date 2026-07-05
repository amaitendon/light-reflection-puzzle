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

function toPosixPath(p) {
  return p.split(path.sep).join('/');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { inputPath: null, rebuildDir: null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--rebuild') {
      options.rebuildDir = args[++i];
      continue;
    }
    if (!options.inputPath) {
      options.inputPath = arg;
      continue;
    }
  }

  return options;
}

function validateStagePackage(pkg, filePath) {
  if (!pkg || !pkg.level || !pkg.level.sources || !pkg.level.goals) {
    throw new Error(`無効なステージデータです（level.sources / level.goals が必要）: ${filePath}`);
  }
}

function buildManifestEntryFromPackage(pkg, id, filePath) {
  return {
    id,
    file: toPosixPath(path.relative(root, filePath)),
    title: pkg.title || pkg.name || id,
    difficulty: pkg.difficulty || 1,
    tags: pkg.tags || [],
    description: pkg.description || '',
  };
}

function rebuildIndexFromDir(dirPath) {
  const absDir = path.resolve(dirPath);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error('フォルダが見つかりません: ' + absDir);
  }

  const manifest = { stages: [] };
  const files = fs.readdirSync(absDir)
    .filter(name => name.toLowerCase().endsWith('.json') && name.toLowerCase() !== 'index.json')
    .sort((a, b) => a.localeCompare(b, 'ja'));

  if (files.length === 0) {
    throw new Error('対象フォルダに JSON ファイルがありません: ' + absDir);
  }

  files.forEach((fileName, index) => {
    const filePath = path.join(absDir, fileName);
    const pkg = readJSON(filePath);
    validateStagePackage(pkg, filePath);

    const fallbackId = `stage-${String(index + 1).padStart(3, '0')}`;
    const id = pkg.id || path.basename(fileName, path.extname(fileName)) || fallbackId;
    manifest.stages.push(buildManifestEntryFromPackage(pkg, id, filePath));
  });

  writeJSON(indexPath, manifest);
  return { manifest, files, absDir };
}

function main() {
  const { inputPath, rebuildDir } = parseArgs(process.argv);

  if (rebuildDir) {
    try {
      const { manifest, files, absDir } = rebuildIndexFromDir(rebuildDir);
      console.log('再構築完了: ' + path.relative(root, absDir));
      console.log('  対象件数:', files.length);
      console.log('  マニフェスト更新:', path.relative(root, indexPath));
      console.log('  登録順:', manifest.stages.map(s => `${s.id} (${s.file})`).join(', '));
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    return;
  }

  if (!inputPath) {
    console.error('使い方: node scripts/publish-stage.js <official-stage.json>');
    console.error('または: node scripts/publish-stage.js --rebuild <stages-folder>');
    process.exit(1);
  }

  const absInput = path.resolve(inputPath);
  if (!fs.existsSync(absInput)) {
    console.error('ファイルが見つかりません:', absInput);
    process.exit(1);
  }

  const pkg = readJSON(absInput);
  try {
    validateStagePackage(pkg, absInput);
  } catch (err) {
    console.error(err.message);
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

  const entry = buildManifestEntryFromPackage(pkg, id, stageFilePath);

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
