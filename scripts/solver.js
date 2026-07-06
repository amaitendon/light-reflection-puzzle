/* ================= solver =================
   ステージ内の「動かせる要素」（回転できるミラー／回転できる光源／
   ON-OFF切り替えできる色変換パネル）の組み合わせを探索し、
   全ゴールを一致させる状態を見つける。

   - 組み合わせ数が少ないステージ  → 全探索（DFS）で確実に解を発見
   - 組み合わせ数が多いステージ    → min-conflicts に近い山登り法＋ランダム再スタートで探索
     （制限時間内に見つからない場合は、そこまでで一番惜しかった状態を返す）
*/

const SOLVER_SOURCE_DIRS = ['right', 'down', 'left', 'up'];
const SOLVER_BRUTE_FORCE_LIMIT = 300000; // これ以下の組み合わせ数なら全探索する
const SOLVER_DEFAULT_TIME_LIMIT_MS = 4500;

function collectSolverVariables(level) {
  const mirrorVars = [];
  const converterVars = [];
  const sourceVars = [];
  level.elements.forEach(e => {
    if (e.kind === 'mirror' && e.rotatable) mirrorVars.push(e.id);
    if (e.kind === 'converter' && e.interactive) converterVars.push(e.id);
  });
  level.sources.forEach(s => {
    if (s.rotatable) sourceVars.push(s.id);
  });
  return { mirrorVars, converterVars, sourceVars };
}

function popcount3(n) {
  return (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1);
}

// 実際に届いた色と目標色の差（ビットのずれの数の合計）を「惜しさ」として返す。0なら完全一致。
// 色のズレが最優先の指標だが、一方向ミラー（doubleSided:false）の迷路のように
// 「色が変わるまで手がかりが無い」ステージ向けに、光線が実際に進んだ距離の合計も
// 副次的なヒントとして加点し、山登り法の勾配を作る。
function evaluateLevel(level, state) {
  const result = traceAll(level, state.mirrorStates, state.converterStates, state.sourceStates);
  let colorPenalty = 0;
  result.goalStates.forEach(({ g }) => {
    const actual = result.goalHits[g.x + ',' + g.y] || 0;
    colorPenalty += popcount3((g.color ^ actual) & 7);
  });
  let totalSteps = 0;
  result.segments.forEach(seg => { totalSteps += seg.pts.length - 1; });
  const penalty = colorPenalty * 1000 - totalSteps;
  return { penalty, allGoalsMet: result.allGoalsMet };
}

function cloneState(state) {
  return {
    mirrorStates: Object.assign({}, state.mirrorStates),
    converterStates: Object.assign({}, state.converterStates),
    sourceStates: Object.assign({}, state.sourceStates),
  };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * ステージを解く。
 * @param {object} level - beam-engine が扱う level オブジェクト（size, walls, elements, sources, goals）
 * @param {object} [options]
 * @param {number} [options.timeLimitMs] - 探索にかける時間の上限（ミリ秒）
 * @returns {{solved:boolean, mirrorStates:object, converterStates:object, sourceStates:object, penalty:number}}
 */
function solveLevel(level, options) {
  options = options || {};
  const timeLimitMs = options.timeLimitMs || SOLVER_DEFAULT_TIME_LIMIT_MS;
  const start = Date.now();

  const { mirrorVars, converterVars, sourceVars } = collectSolverVariables(level);
  const varKind = {};
  mirrorVars.forEach(id => (varKind[id] = 'mirror'));
  converterVars.forEach(id => (varKind[id] = 'converter'));
  sourceVars.forEach(id => (varKind[id] = 'source'));
  const allVarIds = mirrorVars.concat(converterVars, sourceVars);

  const domains = {};
  mirrorVars.forEach(id => (domains[id] = MIRROR_ROTATION_STEPS.slice()));
  converterVars.forEach(id => (domains[id] = [true, false]));
  sourceVars.forEach(id => (domains[id] = SOLVER_SOURCE_DIRS.slice()));

  function setVar(state, id, value) {
    if (varKind[id] === 'mirror') state.mirrorStates[id] = value;
    else if (varKind[id] === 'converter') state.converterStates[id] = value;
    else state.sourceStates[id] = value;
  }

  function randomState() {
    const state = { mirrorStates: {}, converterStates: {}, sourceStates: {} };
    allVarIds.forEach(id => setVar(state, id, pickRandom(domains[id])));
    return state;
  }

  // 変数が一つも無い（固定要素だけの）ステージは、そのまま判定するだけ
  if (allVarIds.length === 0) {
    const state = { mirrorStates: {}, converterStates: {}, sourceStates: {} };
    const { penalty, allGoalsMet } = evaluateLevel(level, state);
    return Object.assign({ solved: allGoalsMet, penalty }, state);
  }

  // ---- 組み合わせ数を見積もる（大きすぎたら Infinity 扱い）----
  let combos = 1;
  for (const id of allVarIds) {
    combos *= domains[id].length;
    if (combos > SOLVER_BRUTE_FORCE_LIMIT) { combos = Infinity; break; }
  }

  // ---- 全探索（組み合わせ数が少ない場合）----
  if (combos <= SOLVER_BRUTE_FORCE_LIMIT) {
    const state = { mirrorStates: {}, converterStates: {}, sourceStates: {} };
    allVarIds.forEach(id => setVar(state, id, domains[id][0]));

    let timedOut = false;
    function dfs(idx) {
      if ((idx & 0x3ff) === 0 && Date.now() - start > timeLimitMs) { timedOut = true; return null; }
      if (idx === allVarIds.length) {
        const { allGoalsMet } = evaluateLevel(level, state);
        return allGoalsMet ? cloneState(state) : null;
      }
      const id = allVarIds[idx];
      for (const v of domains[id]) {
        setVar(state, id, v);
        const found = dfs(idx + 1);
        if (found) return found;
        if (timedOut) return null;
      }
      return null;
    }
    const found = dfs(0);
    if (found) return Object.assign({ solved: true, penalty: 0 }, found);
    if (!timedOut) {
      // 全探索し尽くして解なし
      return Object.assign({ solved: false, penalty: null }, randomState());
    }
    // タイムアウトした場合はローカルサーチにフォールバック
  }

  // ---- ローカルサーチ（min-conflicts 風の山登り法＋反復摂動リスタート）----
  let best = null;
  let bestPenalty = Infinity;

  function perturb(state, count) {
    const s = cloneState(state);
    for (let i = 0; i < count; i++) {
      const id = pickRandom(allVarIds);
      setVar(s, id, pickRandom(domains[id]));
    }
    return s;
  }

  let round = 0;
  while (Date.now() - start < timeLimitMs) {
    round++;
    // 最初の数回とときどきは完全ランダム、それ以外は「これまでの最善」を少し乱して再開する
    // （あと1手で惜しいだけの局所解から、探索をゼロからやり直さずに抜け出すため）
    let state;
    if (!best || round % 2 === 0) {
      state = randomState();
    } else {
      state = perturb(best, 1 + Math.floor(Math.random() * 5));
    }
    let { penalty } = evaluateLevel(level, state);
    if (penalty < bestPenalty) { bestPenalty = penalty; best = cloneState(state); }

    let noImprove = 0;
    const STEP_LIMIT = 800;
    for (let step = 0; step < STEP_LIMIT; step++) {
      if (Date.now() - start > timeLimitMs) break;
      const id = pickRandom(allVarIds);
      const originalValue = varKind[id] === 'mirror' ? state.mirrorStates[id]
        : varKind[id] === 'converter' ? state.converterStates[id]
        : state.sourceStates[id];

      let bestVal = originalValue;
      let bestLocalPenalty = penalty;
      let solvedHere = false;
      for (const v of domains[id]) {
        setVar(state, id, v);
        const r = evaluateLevel(level, state);
        if (r.allGoalsMet) { bestVal = v; bestLocalPenalty = 0; solvedHere = true; break; }
        if (r.penalty < bestLocalPenalty) { bestLocalPenalty = r.penalty; bestVal = v; }
      }
      setVar(state, id, bestVal);

      if (solvedHere) return Object.assign({ solved: true, penalty: 0 }, cloneState(state));

      if (bestLocalPenalty < penalty) { penalty = bestLocalPenalty; noImprove = 0; }
      else { noImprove++; }

      if (penalty < bestPenalty) { bestPenalty = penalty; best = cloneState(state); }
      if (noImprove > 80) break; // 局所解にはまったら再スタート
    }
  }

  return Object.assign({ solved: false, penalty: bestPenalty }, best || randomState());
}
