/* ================= solver v2 =================
   ステージ内の「動かせる要素」（回転できるミラー／回転できる光源／
   ON-OFF切り替えできる色変換パネル）の組み合わせを探索し、
   全ゴールを一致させる状態を見つける。

   既定の 'auto' モードは以下の順に3つの戦略を試す。
   - 戦略1：光線追跡バックトラッキング探索
            （遭遇したミラーだけを分岐する。迷路系ステージに強く、
            大半のステージはこれで解ける。ベンチマークにより、他の2戦略より
            先に試すのが最も効率的と確認済み）
   - 戦略2：軽い全変数探索（組み合わせ数が少ない場合の確定的DFS）
            （色変換パネルが密結合していて戦略1の前提（チャンネルごとの独立性）が
            崩れているステージなど、戦略1が不得意なケースを短時間で拾う保険）
   - 戦略3：min-conflicts に近い山登り法＋ランダム再スタート
            （戦略1・2のどちらも解けなかった場合の最終手段）
   - options.mode で戦略を明示指定することも可能（既定は 'auto'）

   1. 山登り法の評価関数は「未達成ゴールへの最短距離」を主な副次指標にし、
      総距離指標はごく小さい重みの補助勾配として利用する。（囮ルートでの探索時間を浪費対策）
   2. options.mode で探索モードを明示指定可能（'auto' / 'backtrack' / 'local'）。
      ステージの性質によって得意な戦略が異なるため（例：迷路系は backtrack、色変換パネルが
      密結合したステージは local が安定することがある）、エディター側でステージ作成者が
      使い分けたり、比較検証したりできるようにした。

   コメントルール
   ・変更履歴やバグ修正内容、それにより改善した内容などは記載しない。
   （例えばバグ修正履歴は未来の変更に対し、有益な情報を与えないため記載しない）
   ・処理の目的やプログラムからは読み取れない内容（設計意図など）などはコメントしてよい。
   （例えば、アルゴリズムの採用理由や、廃止した戦略の廃止理由などは記載して良い）
   ・変更により不要になった処理やコメントは随時削除すること
*/

const SOLVER_SOURCE_DIRS = ['right', 'down', 'left', 'up'];
const SOLVER_BRUTE_FORCE_LIMIT = 600000; // これ以下の組み合わせ数なら全探索する
const SOLVER_DEFAULT_TIME_LIMIT_MS = 5000;

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
//
// 副次指標の「光線が実際に進んだ距離の合計（totalSteps）」は
// ゴールに全く関係ない方向へ長く迷い込む“おとり経路（デコイ）”のほうが、
// 正しく進んだ短い経路よりスコアが良くなってしまう欠陥があるため、
// 「未達成の各ゴールについて、光線上のどこかの点からそのゴールまでの最短距離」を副次指標にする。
function nearestGoalDistance(segments, gx, gy) {
  let best = Infinity;
  for (const seg of segments) {
    for (const [px, py] of seg.pts) {
      const d = Math.abs(px - gx) + Math.abs(py - gy); // マンハッタン距離
      if (d < best) best = d;
    }
  }
  return best === Infinity ? 0 : best;
}

function evaluateLevel(level, state) {
  const result = traceAll(level, state.mirrorStates, state.converterStates, state.sourceStates);
  let colorPenalty = 0;
  let distancePenalty = 0;
  result.goalStates.forEach(({ g }) => {
    const actual = result.goalHits[g.x + ',' + g.y] || 0;
    const mismatch = popcount3((g.color ^ actual) & 7);
    colorPenalty += mismatch;
    if (mismatch > 0) {
      distancePenalty += nearestGoalDistance(result.segments, g.x, g.y);
    }
  });
  let totalSteps = 0;
  result.segments.forEach(seg => { totalSteps += seg.pts.length - 1; });
  // colorPenalty（達成ビット数）が最優先、
  // distancePenalty（未達成ゴールへの近さ）はそのタイブレーク。
  // totalSteps はステージによっては
  // （分岐が多くdistancePenaltyだけでは方向が定まりにくい場合など）
  // 依然として有用な補助勾配になるため、ごく小さい重みで残す。
  // 重みを十分小さくし、デコイ経路のようにゴールに無関係へ長く伸びるだけの経路が、
  // 正しい経路より有利にならないようにする
  // （distancePenalty 1マス分の差 ≒ totalSteps 100マス分の差に相当する重み付け）。
  const penalty = colorPenalty * 1000 + distancePenalty - totalSteps * 0.01;
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

// 両面ミラー（doubleSided !== false）は、線の角度が180度違うだけの向き（例:45度と225度）が
// 光学的に完全に同一（同じ直線）になる。実効的な選択肢は4方向で十分であり、
// 8方向すべてを domain に含めるのは探索空間を無駄に2倍へ広げるだけになる。
// （片面ミラーだけは表裏で挙動が変わるため8方向のまま）
function domainForMirror(el) {
  return el.doubleSided === false ? MIRROR_ROTATION_STEPS.slice() : [0, 45, 90, 135];
}

// ---- ミラーが特定の色ビットに関係するかどうか ----
// filterColor が無い（null）ミラーは常に全反射するので、どの色ビットにとっても「関係あり」。
// filterColor があるミラーは、そのビットを含む色（例: filterColor=3=黄 は R にも G にも関係あり）
// のときだけ反射方向が影響する。含まないビットの光は、向きに関係なく直進して素通りするだけなので
// 「関係なし」として扱ってよい（transmit時の方向はミラーの向きに一切依存しないため安全な性質）。
function isMirrorRelevantToBit(el, bit) {
  const fc = el.filterColor;
  return fc == null || (fc & bit) !== 0;
}

/**
 * 汎用の割り当て探索。
 * freeVarIds に含まれる変数だけを動かし、evaluate(state) が {penalty, solved} を
 * 返すという契約のもとで、solved になる割り当てを探す。
 * 組み合わせ数が十分小さければ確定的な全探索、大きければ山登り法＋ランダム再スタートに切り替える。
 * state は「探索対象外の変数も含めた完全な状態オブジェクト」を渡すこと（in-placeで書き換える）。
 */
function searchAssignment(ctx) {
  const { domains, setVar, getVar, freeVarIds, state, evaluate, timeLimitMs, bruteForceLimit } = ctx;
  const start = Date.now();
  const deadline = start + Math.max(0, timeLimitMs);

  if (freeVarIds.length === 0) {
    const { penalty, solved } = evaluate(state);
    return { solved, state: cloneState(state), penalty };
  }

  let combos = 1;
  for (const id of freeVarIds) {
    combos *= domains[id].length;
    if (combos > bruteForceLimit) { combos = Infinity; break; }
  }

  // ---- 全探索（組み合わせ数が少ない場合。確定的なので見つかれば確実に正解）----
  if (combos <= bruteForceLimit) {
    freeVarIds.forEach(id => setVar(state, id, domains[id][0]));
    let timedOut = false;
    let found = null;
    (function dfs(idx) {
      if (found || timedOut) return;
      if (Date.now() > deadline) { timedOut = true; return; }
      if (idx === freeVarIds.length) {
        const { solved } = evaluate(state);
        if (solved) found = cloneState(state);
        return;
      }
      const id = freeVarIds[idx];
      for (const v of domains[id]) {
        setVar(state, id, v);
        dfs(idx + 1);
        if (found || timedOut) return;
      }
    })(0);
    if (found) return { solved: true, state: found, penalty: 0 };
    if (!timedOut) return { solved: false, state: null, penalty: Infinity }; // 探索し尽くして解なしと確定
    // タイムアウトした場合はローカルサーチにフォールバック
  }

  // ---- ローカルサーチ（min-conflicts 風の山登り法＋反復摂動リスタート）----
  let best = null;
  let bestPenalty = Infinity;

  function randomizeFree() {
    freeVarIds.forEach(id => setVar(state, id, pickRandom(domains[id])));
  }
  function restoreBest() {
    Object.assign(state.mirrorStates, best.mirrorStates);
    Object.assign(state.converterStates, best.converterStates);
    Object.assign(state.sourceStates, best.sourceStates);
  }

  let round = 0;
  while (Date.now() < deadline) {
    round++;
    if (!best || round % 2 === 0) {
      randomizeFree();
    } else {
      restoreBest();
      const count = 1 + Math.floor(Math.random() * Math.min(5, freeVarIds.length));
      for (let i = 0; i < count; i++) {
        const id = pickRandom(freeVarIds);
        setVar(state, id, pickRandom(domains[id]));
      }
    }
    let { penalty, solved } = evaluate(state);
    if (solved) return { solved: true, state: cloneState(state), penalty: 0 };
    if (penalty < bestPenalty) { bestPenalty = penalty; best = cloneState(state); }

    let noImprove = 0;
    const STEP_LIMIT = 800;
    for (let step = 0; step < STEP_LIMIT; step++) {
      if (Date.now() > deadline) break;
      const id = pickRandom(freeVarIds);
      const originalValue = getVar(state, id);

      let bestVal = originalValue;
      let bestLocalPenalty = penalty;
      let solvedHere = false;
      for (const v of domains[id]) {
        setVar(state, id, v);
        const r = evaluate(state);
        if (r.solved) { bestVal = v; bestLocalPenalty = 0; solvedHere = true; break; }
        if (r.penalty < bestLocalPenalty) { bestLocalPenalty = r.penalty; bestVal = v; }
      }
      setVar(state, id, bestVal);

      if (solvedHere) return { solved: true, state: cloneState(state), penalty: 0 };

      if (bestLocalPenalty < penalty) { penalty = bestLocalPenalty; noImprove = 0; }
      else { noImprove++; }

      if (penalty < bestPenalty) { bestPenalty = penalty; best = cloneState(state); }
      if (noImprove > 80) break; // 局所解にはまったら再スタート
    }
  }

  return { solved: false, state: best ? cloneState(best) : cloneState(state), penalty: bestPenalty };
}

/* ================= 色チャンネル分解探索（R探索/R固定 → G探索/G固定 → B探索/B固定）================= */

const CHANNEL_BIT = { R: 1, G: 2, B: 4 };

function backtrackSolveAllChannels(baseCtx, order, timeLimitMs, alwaysShuffle) {
  const { level, setVar, domains } = baseCtx;
  const { isWall, elementAt, goalAt } = makeLevelLookup(level);
  const start = Date.now();
  const deadline = start + Math.max(0, timeLimitMs);

  let timedOut = false;

  function attempt(shuffled) {
    const assign = {}; // このアテンプト内で決めた全チャンネル分の値（id -> value）
    const knownOrNull = id => (id in assign ? assign[id] : null);

    function walk(bit, x, y, dx, dy, visited, goalHits, cont) {
      if (timedOut) return false;
      let cx = x, cy = y;
      while (true) {
        if (Date.now() > deadline) { timedOut = true; return false; }
        cx += dx; cy += dy;
        if (cx < 0 || cy < 0 || cx >= level.size || cy >= level.size) return cont();
        if (isWall(cx, cy)) return cont();
        const g = goalAt(cx, cy);
        if (g) {
          const key = cx + ',' + cy;
          const prev = goalHits[key] || 0;
          goalHits[key] = prev | bit;
          const ok = cont();
          if (!ok) goalHits[key] = prev;
          return ok;
        }
        const stateKey = cx + ',' + cy + ',' + dx + ',' + dy;
        if (visited.has(stateKey)) return cont(); // ループ検出
        visited.add(stateKey);

        const el = elementAt(cx, cy);
        if (!el) continue;

        if (el.kind === 'mirror') {
          if (!isMirrorRelevantToBit(el, bit)) continue; // 素通り（向きは無関係）
          const known = el.rotatable ? knownOrNull(el.id) : el.orient;
          if (known !== null && known !== undefined) {
            const orient = normalizeMirrorAngle(known);
            const frontSide = isFrontSide(dx, dy, orient);
            if (el.doubleSided === false && !frontSide) return cont();
            const [ndx, ndy] = reflectVector(dx, dy, orient);
            dx = ndx; dy = ndy; continue;
          }
          // 未確定 → ここで分岐（この鏡に実際にビームが当たったときだけ）
          let dom = domains[el.id].slice();
          if (shuffled) dom.sort(() => Math.random() - 0.5);
          for (const v of dom) {
            if (timedOut) return false;
            assign[el.id] = v;
            const orient = normalizeMirrorAngle(v);
            const frontSide = isFrontSide(dx, dy, orient);
            let ok;
            if (el.doubleSided === false && !frontSide) {
              ok = cont();
            } else {
              const [ndx, ndy] = reflectVector(dx, dy, orient);
              // 兄弟分岐が visited を汚染しないよう複製して渡す
              ok = walk(bit, cx, cy, ndx, ndy, new Set(visited), goalHits, cont);
            }
            if (ok) return true;
            delete assign[el.id];
          }
          return false;
        }

        if (el.kind === 'converter') {
          const converterStep = (isEnabled) => {
            if (!isEnabled) return walk(bit, cx, cy, dx, dy, new Set(visited), goalHits, cont);
            const type = el.type || 'replace';
            let survives;
            if (type === 'add') survives = true;
            else if (type === 'remove') survives = (el.color & bit) === 0;
            else survives = (el.color & bit) !== 0; // replace
            if (!survives) return cont();
            return walk(bit, cx, cy, dx, dy, new Set(visited), goalHits, cont);
          };
          let enabled = null;
          if (el.interactive) {
            const known = knownOrNull(el.id);
            if (known !== null && known !== undefined) enabled = known;
          } else {
            enabled = el.enabled !== false;
          }
          if (enabled === null) {
            let opts = [true, false];
            if (shuffled) opts.sort(() => Math.random() - 0.5);
            for (const v of opts) {
              if (timedOut) return false;
              assign[el.id] = v;
              const ok = converterStep(v);
              if (ok) return true;
              delete assign[el.id];
            }
            return false;
          }
          return converterStep(enabled);
        }
      }
    }

    function processSource(bit, idx, goalHits, cont) {
      if (timedOut) return false;
      if (idx === level.sources.length) {
        for (const g of level.goals) {
          const key = g.x + ',' + g.y;
          if (((goalHits[key] || 0) & bit) !== (g.color & bit)) return false;
        }
        return cont();
      }
      const s = level.sources[idx];
      if ((s.color & bit) === 0) {
        return processSource(bit, idx + 1, goalHits, cont);
      }
      let dir = s.dir;
      if (s.rotatable) {
        const known = knownOrNull(s.id);
        if (known !== null && known !== undefined) {
          dir = known;
        } else {
          let opts = SOLVER_SOURCE_DIRS.slice();
          if (shuffled) opts.sort(() => Math.random() - 0.5);
          for (const v of opts) {
            if (timedOut) return false;
            assign[s.id] = v;
            const ok = walk(bit, s.x, s.y, DIRS[v][0], DIRS[v][1], new Set(), goalHits,
              () => processSource(bit, idx + 1, goalHits, cont));
            if (ok) return true;
            delete assign[s.id];
          }
          return false;
        }
      }
      return walk(bit, s.x, s.y, DIRS[dir][0], DIRS[dir][1], new Set(), goalHits,
        () => processSource(bit, idx + 1, goalHits, cont));
    }

    function processChannel(orderIdx) {
      if (timedOut || Date.now() > deadline) { timedOut = true; return false; }
      if (orderIdx === order.length) {
        // 全チャンネル成功 → 本物のビーム追跡エンジンで最終検算
        const testState = { mirrorStates: {}, converterStates: {}, sourceStates: {} };
        baseCtx.allVarIds.forEach(id => setVar(testState, id, id in assign ? assign[id] : domains[id][0]));
        const full = evaluateLevel(level, testState);
        return full.allGoalsMet;
      }
      const bit = CHANNEL_BIT[order[orderIdx]];
      return processSource(bit, 0, {}, () => processChannel(orderIdx + 1));
    }

    const ok = processChannel(0);
    return ok ? assign : null;
  }

  let round = 0;
  while (Date.now() < deadline) {
    round++;
    const shuffled = alwaysShuffle || round > 1;
    timedOut = false;
    const assign = attempt(shuffled);
    if (assign) {
      const resultState = { mirrorStates: {}, converterStates: {}, sourceStates: {} };
      baseCtx.allVarIds.forEach(id => setVar(resultState, id, id in assign ? assign[id] : domains[id][0]));
      return { solved: true, state: resultState };
    }
    if (!timedOut && !shuffled) {
      // 決定的な順序で全探索し尽くして失敗＝このモデルの前提では解が無いと確定
      // （色変換パネル等で「1色だけ追えばよい」前提が崩れているケースを含む）。
      // ランダム順のときの「見つからなかった」は運が悪かっただけの可能性があるので信頼しない。
      return { solved: false, state: null, exhausted: true };
    }
  }
  return { solved: false, state: null };
}

/**
 * ステージを解く。
 * @param {object} level - beam-engine が扱う level オブジェクト（size, walls, elements, sources, goals）
 * @param {object} [options]
 * @param {number} [options.timeLimitMs] - 探索にかける時間の上限（ミリ秒）
 * @param {'auto'|'backtrack'|'local'} [options.mode] - 探索モード（既定 'auto'）。
 *   - 'auto'      : 下の3戦略を状況に応じて順に試す。基本的にはこれを使えばよい。
 *   - 'backtrack' : 光線追跡バックトラッキング探索のみを使う。壁やミラーで経路がほぼ
 *                   一本道に絞られる「迷路系」ステージ（おとり経路があるものを含む）に強い。
 *                   色フィルターミラーの有無は問わない。
 *   - 'local'     : min-conflicts風の山登り法のみを使う。色変換パネルが密結合していて
 *                   バックトラッキングの前提（チャンネルごとの独立性）が崩れているステージ
 *                   （変換パネルが多いステージ等）に強い。
 * @returns {{solved:boolean, mirrorStates:object, converterStates:object, sourceStates:object, penalty:number, strategyUsed:string}}
 */
function solveLevel(level, options) {
  options = options || {};
  const totalTimeLimitMs = options.timeLimitMs || SOLVER_DEFAULT_TIME_LIMIT_MS;
  const mode = options.mode || 'auto';
  const start = Date.now();
  const overallDeadline = start + totalTimeLimitMs;

  const { mirrorVars, converterVars, sourceVars } = collectSolverVariables(level);
  const varKind = {};
  mirrorVars.forEach(id => (varKind[id] = 'mirror'));
  converterVars.forEach(id => (varKind[id] = 'converter'));
  sourceVars.forEach(id => (varKind[id] = 'source'));
  const allVarIds = mirrorVars.concat(converterVars, sourceVars);

  const elementById = {};
  level.elements.forEach(e => { elementById[e.id] = e; });

  const domains = {};
  mirrorVars.forEach(id => (domains[id] = domainForMirror(elementById[id])));
  converterVars.forEach(id => (domains[id] = [true, false]));
  sourceVars.forEach(id => (domains[id] = SOLVER_SOURCE_DIRS.slice()));

  function setVar(state, id, value) {
    if (varKind[id] === 'mirror') state.mirrorStates[id] = value;
    else if (varKind[id] === 'converter') state.converterStates[id] = value;
    else state.sourceStates[id] = value;
  }
  function getVar(state, id) {
    return varKind[id] === 'mirror' ? state.mirrorStates[id]
      : varKind[id] === 'converter' ? state.converterStates[id]
      : state.sourceStates[id];
  }
  function freshState() {
    const s = { mirrorStates: {}, converterStates: {}, sourceStates: {} };
    allVarIds.forEach(id => setVar(s, id, domains[id][0]));
    return s;
  }

  // 変数が一つも無い（固定要素だけの）ステージは、そのまま判定するだけ
  if (allVarIds.length === 0) {
    const state = { mirrorStates: {}, converterStates: {}, sourceStates: {} };
    const { penalty, allGoalsMet } = evaluateLevel(level, state);
    return Object.assign({ solved: allGoalsMet, penalty, strategyUsed: 'trivial' }, state);
  }

  const baseCtx = { level, varKind, domains, setVar, getVar, allVarIds };
  const evalFn = s => {
    const r = evaluateLevel(level, s);
    return { penalty: r.penalty, solved: r.allGoalsMet };
  };

  let overallBest = null;
  let overallBestPenalty = Infinity;
  function considerResult(res) {
    if (!res || !res.state) return false;
    if (res.solved) return true;
    if (res.penalty < overallBestPenalty) { overallBestPenalty = res.penalty; overallBest = res.state; }
    return false;
  }

  const CHANNEL_ORDERS = [
    ['R', 'G', 'B'], ['G', 'B', 'R'], ['B', 'R', 'G'],
    ['R', 'B', 'G'], ['G', 'R', 'B'], ['B', 'G', 'R'],
  ];
  // 光線追跡バックトラッキング探索
  function runBacktrackPhase(deadline) {
    for (const order of CHANNEL_ORDERS) {
      if (Date.now() >= deadline) break;
      const remaining = deadline - Date.now();
      const share = Math.max(150, Math.floor(remaining / (CHANNEL_ORDERS.length - CHANNEL_ORDERS.indexOf(order))));
      const res = backtrackSolveAllChannels(baseCtx, order, share, false);
      if (res.solved) return res;
      // exhausted（このモデルでは解なし）の場合は他の順序を試しても無駄なので、
      // 残り時間をすぐ他の戦略に譲る
      if (res.exhausted && order === CHANNEL_ORDERS[0]) break;
    }
    return null;
  }

  if (mode === 'local') {
    const res = searchAssignment({
      domains, setVar, getVar, freeVarIds: allVarIds, state: freshState(),
      evaluate: evalFn, timeLimitMs: totalTimeLimitMs, bruteForceLimit: SOLVER_BRUTE_FORCE_LIMIT,
    });
    if (considerResult(res)) return Object.assign({ solved: true, penalty: 0, strategyUsed: 'local' }, res.state);
    return Object.assign({ solved: false, penalty: overallBestPenalty, strategyUsed: 'local' }, overallBest || freshState());
  }

  if (mode === 'backtrack') {
    const res = runBacktrackPhase(overallDeadline);
    if (res) return Object.assign({ solved: true, penalty: 0, strategyUsed: 'backtrack' }, res.state);
    return Object.assign({ solved: false, penalty: Infinity, strategyUsed: 'backtrack' }, freshState());
  }

  // ---- mode: 'auto'（既定）----

  // 戦略1：光線追跡バックトラッキング探索（ステージの種類を問わず常に試す）。
  // 大半のステージはこれだけで解け、かつ他の2戦略より高速に解けることをベンチマークで確認済みのため、
  // まずこれに時間予算の大半を割く。前提（チャンネルごとの独立性）が崩れているステージでは
  // 決定的な全探索が早期に「解なし」を確定させるため、割り当てた時間を無駄に使い切ることはない。
  const backtrackDeadline = Math.min(overallDeadline, Date.now() + Math.floor(totalTimeLimitMs * 0.7));
  const backtrackRes = runBacktrackPhase(backtrackDeadline);
  if (backtrackRes) {
    return Object.assign({ solved: true, penalty: 0, strategyUsed: 'backtrack' }, backtrackRes.state);
  }

  // 戦略2：軽い全変数探索をごく短時間だけ試す（色変換パネルが密結合していて戦略1の前提が
  // 崩れているステージなど、戦略1が不得意なケースを短時間で拾う保険）
  if (Date.now() < overallDeadline) {
    const quickShare = Math.min(Math.floor(totalTimeLimitMs * 0.2), 1000);
    const genericRes = searchAssignment({
      domains, setVar, getVar,
      freeVarIds: allVarIds,
      state: freshState(),
      evaluate: evalFn,
      timeLimitMs: Math.max(200, Math.min(quickShare, overallDeadline - Date.now())),
      bruteForceLimit: SOLVER_BRUTE_FORCE_LIMIT,
    });
    if (considerResult(genericRes)) {
      return Object.assign({ solved: true, penalty: 0, strategyUsed: 'generic' }, genericRes.state);
    }
  }

  // 戦略3：残り時間を通常のローカルサーチに使う（最終手段。ここまでの最良状態から再開）
  if (Date.now() < overallDeadline) {
    const fallbackState = overallBest ? cloneState(overallBest) : freshState();
    const res = searchAssignment({
      domains, setVar, getVar,
      freeVarIds: allVarIds,
      state: fallbackState,
      evaluate: evalFn,
      timeLimitMs: overallDeadline - Date.now(),
      bruteForceLimit: 0,
    });
    if (considerResult(res)) {
      return Object.assign({ solved: true, penalty: 0, strategyUsed: 'local-fallback' }, res.state);
    }
  }

  return Object.assign({ solved: false, penalty: overallBestPenalty, strategyUsed: 'none' }, overallBest || freshState());
}
