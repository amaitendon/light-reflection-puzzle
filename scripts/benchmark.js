#!/usr/bin/env node
'use strict';
/* ================= solver benchmark =================
   scripts/solver.js（および依存する beam-engine.js / color-system.js）を
   Node.js の vm 上に読み込み、stages/ 以下の全ステージに対して solveLevel を
   実行し、モードごとの成功率・所要時間を集計してレポート（Markdown + JSON）を
   出力するツール。

   ブラウザ専用の書き方（window 参照など）を一切していない前提のスクリプトを
   そのまま読み込むだけで動くよう vm.runInContext を使っている。
   そのため solver.js 側に Node 用の module.exports を足す必要はない。

   使い方:
     node benchmark.js [オプション]

   主なオプション:
     --project=<dir>   プロジェクトルート（scripts/ と stages/ を含む）。既定 ./
     --solver=<file>   solver.js の差し替えパス（既定 <project>/scripts/solver.js）
     --modes=<list>    計測するモードをカンマ区切りで指定。既定 auto,backtrack,local
     --trials=<n>      各ステージ×モードの試行回数（乱数を使う探索があるためブレを均す）。既定 5
     --timeLimit=<ms>  1試行あたりの探索タイムリミット。既定 5000
     --stage=<name>    指定した場合、そのステージ（ファイル名の部分一致）だけを対象にする
     --out=<file>      Markdown レポートの出力先。既定 ./benchmark-report.md
     --json=<file>     生データ（JSON）の出力先。指定時のみ出力
     --compare=<file>  もう1つの solver.js を指定し、--solver との2本を並べて比較する
     --compareLabel=<label>  --compare 側の表示名（既定 compare）
     --label=<label>   --solver 側の表示名（既定 solver.jsのファイル名）
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function parseArgs(argv) {
  const args = {};
  argv.forEach(arg => {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) args[m[1]] = m[2];
    else if (/^--/.test(arg)) args[arg.slice(2)] = true;
  });
  return args;
}

function loadSolverEnv(scriptsDir, solverPath) {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);
  const files = [
    ['color-system.js', path.join(scriptsDir, 'color-system.js')],
    ['beam-engine.js', path.join(scriptsDir, 'beam-engine.js')],
    ['solver.js', solverPath || path.join(scriptsDir, 'solver.js')],
  ];
  files.forEach(([name, filePath]) => {
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(code, sandbox, { filename: name });
  });
  if (typeof sandbox.solveLevel !== 'function') {
    throw new Error(`solveLevel が見つかりません: ${solverPath}`);
  }
  return sandbox;
}

function loadStages(stagesDir, filterSubstr) {
  return fs.readdirSync(stagesDir)
    .filter(f => f.endsWith('.json') && f !== 'index.json')
    .filter(f => !filterSubstr || f.includes(filterSubstr))
    .sort()
    .map(f => {
      const raw = JSON.parse(fs.readFileSync(path.join(stagesDir, f), 'utf8'));
      return { file: f, title: raw.title || f, level: raw.level };
    });
}

// 1ステージ×1モードにつき trials 回計測する。
// solveLevel はランダム性のあるローカルサーチにフォールバックすることがあるため、
// 単発計測ではブレが大きく、複数回の平均・中央値・成功率で評価する必要がある。
function benchmarkOne(sandbox, stage, mode, trials, timeLimitMs) {
  const runs = [];
  for (let i = 0; i < trials; i++) {
    const levelCopy = JSON.parse(JSON.stringify(stage.level));
    const t0 = process.hrtime.bigint();
    let result;
    try {
      result = sandbox.solveLevel(levelCopy, { mode, timeLimitMs });
    } catch (err) {
      result = { solved: false, strategyUsed: 'error:' + err.message };
    }
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    runs.push({ solved: !!(result && result.solved), ms, strategyUsed: result && result.strategyUsed });
  }
  const solvedRuns = runs.filter(r => r.solved);
  const times = solvedRuns.map(r => r.ms).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  return {
    stage: stage.title,
    file: stage.file,
    mode,
    trials,
    solvedCount: solvedRuns.length,
    solveRate: solvedRuns.length / trials,
    avgMs: avg,
    medianMs: median,
    maxMs: times.length ? times[times.length - 1] : null,
    strategyUsed: solvedRuns.length ? mostCommon(solvedRuns.map(r => r.strategyUsed)) : null,
  };
}

function mostCommon(arr) {
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function runSuite(sandbox, stages, modes, trials, timeLimitMs) {
  const rows = [];
  stages.forEach(stage => {
    modes.forEach(mode => {
      rows.push(benchmarkOne(sandbox, stage, mode, trials, timeLimitMs));
    });
  });
  return rows;
}

function summarizeByMode(rows) {
  const byMode = {};
  rows.forEach(r => {
    if (!byMode[r.mode]) byMode[r.mode] = { mode: r.mode, stages: 0, fullySolved: 0, sumSolveRate: 0, solvedTimes: [] };
    const b = byMode[r.mode];
    b.stages++;
    b.sumSolveRate += r.solveRate;
    if (r.solveRate === 1) b.fullySolved++;
    if (r.avgMs != null) b.solvedTimes.push(r.avgMs);
  });
  return Object.values(byMode).map(b => ({
    mode: b.mode,
    stages: b.stages,
    fullySolvedStages: b.fullySolved,
    avgSolveRate: b.sumSolveRate / b.stages,
    avgTimeMs: b.solvedTimes.length ? b.solvedTimes.reduce((a, c) => a + c, 0) / b.solvedTimes.length : null,
    medianTimeMs: b.solvedTimes.length ? b.solvedTimes.slice().sort((a, c) => a - c)[Math.floor(b.solvedTimes.length / 2)] : null,
  }));
}

function fmtMs(ms) { return ms == null ? '-' : ms.toFixed(1) + 'ms'; }
function fmtRate(r) { return r == null ? '-' : (r * 100).toFixed(0) + '%'; }

function buildMarkdown({ label, compareLabel, rows, compareRows, modes, trials, timeLimitMs, stageCount }) {
  const lines = [];
  lines.push('# solver.js 性能ベンチマークレポート');
  lines.push('');
  lines.push(`- 実行日時: ${new Date().toISOString()}`);
  lines.push(`- 対象ステージ数: ${stageCount}`);
  lines.push(`- モード: ${modes.join(', ')}`);
  lines.push(`- 試行回数（各ステージ×モード）: ${trials}`);
  lines.push(`- タイムリミット: ${timeLimitMs}ms`);
  lines.push('');

  function summarySection(title, theRows) {
    lines.push(`## ${title}: モード別サマリー`);
    lines.push('');
    lines.push('| mode | 平均達成率 | 完全解決ステージ数 | 平均求解時間 | 中央値 |');
    lines.push('|---|---|---|---|---|');
    summarizeByMode(theRows).forEach(s => {
      lines.push(`| ${s.mode} | ${fmtRate(s.avgSolveRate)} | ${s.fullySolvedStages}/${s.stages} | ${fmtMs(s.avgTimeMs)} | ${fmtMs(s.medianTimeMs)} |`);
    });
    lines.push('');
  }

  summarySection(label, rows);
  if (compareRows) summarySection(compareLabel, compareRows);

  lines.push('## ステージ別詳細');
  lines.push('');
  if (compareRows) {
    lines.push(`| ステージ | mode | ${label} 成功率 | ${label} 平均時間 | ${compareLabel} 成功率 | ${compareLabel} 平均時間 |`);
    lines.push('|---|---|---|---|---|---|');
    rows.forEach(r => {
      const cr = compareRows.find(x => x.file === r.file && x.mode === r.mode);
      lines.push(`| ${r.stage} | ${r.mode} | ${fmtRate(r.solveRate)} | ${fmtMs(r.avgMs)} | ${cr ? fmtRate(cr.solveRate) : '-'} | ${cr ? fmtMs(cr.avgMs) : '-'} |`);
    });
  } else {
    lines.push('| ステージ | mode | 成功率 | 平均時間 | 中央値 | 最大時間 | 使われた戦略 |');
    lines.push('|---|---|---|---|---|---|---|');
    rows.forEach(r => {
      lines.push(`| ${r.stage} | ${r.mode} | ${fmtRate(r.solveRate)} | ${fmtMs(r.avgMs)} | ${fmtMs(r.medianMs)} | ${fmtMs(r.maxMs)} | ${r.strategyUsed || '-'} |`);
    });
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = path.resolve(args.project || './');
  const scriptsDir = path.join(projectDir, 'scripts');
  const stagesDir = path.join(projectDir, 'stages');
  const solverPath = args.solver ? path.resolve(args.solver) : path.join(scriptsDir, 'solver.js');
  const modes = (args.modes || 'auto,backtrack,local').split(',').map(s => s.trim()).filter(Boolean);
  const trials = parseInt(args.trials || '5', 10);
  const timeLimitMs = parseInt(args.timeLimit || '5000', 10);
  const outPath = path.resolve(args.out || './benchmark-report.md');
  const label = args.label || path.basename(solverPath);

  const stages = loadStages(stagesDir, args.stage);
  if (stages.length === 0) {
    console.error('対象ステージが見つかりませんでした:', stagesDir);
    process.exit(1);
  }

  console.log(`[benchmark] stages=${stages.length} modes=${modes.join(',')} trials=${trials} timeLimit=${timeLimitMs}ms`);
  console.log(`[benchmark] solver: ${solverPath}`);

  const sandbox = loadSolverEnv(scriptsDir, solverPath);
  const t0 = Date.now();
  const rows = runSuite(sandbox, stages, modes, trials, timeLimitMs);
  console.log(`[benchmark] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let compareRows = null;
  let compareLabel = args.compareLabel || 'compare';
  if (args.compare) {
    const comparePath = path.resolve(args.compare);
    console.log(`[benchmark] compare solver: ${comparePath}`);
    const compareSandbox = loadSolverEnv(scriptsDir, comparePath);
    const t1 = Date.now();
    compareRows = runSuite(compareSandbox, stages, modes, trials, timeLimitMs);
    console.log(`[benchmark] compare done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }

  const md = buildMarkdown({ label, compareLabel, rows, compareRows, modes, trials, timeLimitMs, stageCount: stages.length });
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`[benchmark] report written: ${outPath}`);

  if (args.json) {
    const jsonPath = path.resolve(args.json);
    fs.writeFileSync(jsonPath, JSON.stringify({ rows, compareRows }, null, 2), 'utf8');
    console.log(`[benchmark] raw json written: ${jsonPath}`);
  }

  console.log('\n=== summary:', label, '===');
  console.table(summarizeByMode(rows).map(s => ({
    mode: s.mode, avgSolveRate: fmtRate(s.avgSolveRate), fullySolved: `${s.fullySolvedStages}/${s.stages}`,
    avgTimeMs: fmtMs(s.avgTimeMs), medianTimeMs: fmtMs(s.medianTimeMs),
  })));
  if (compareRows) {
    console.log(`=== summary: ${compareLabel} ===`);
    console.table(summarizeByMode(compareRows).map(s => ({
      mode: s.mode, avgSolveRate: fmtRate(s.avgSolveRate), fullySolved: `${s.fullySolvedStages}/${s.stages}`,
      avgTimeMs: fmtMs(s.avgTimeMs), medianTimeMs: fmtMs(s.medianTimeMs),
    })));
  }
}

main();
