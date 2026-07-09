/* ================= solver =================
   ステージ内の「動かせる要素」（回転できるミラー／回転できる光源／
   ON-OFF切り替えできる色変換パネル）の組み合わせを探索し、
   全ゴールを一致させる状態を見つける。

   - 組み合わせ数が少ないステージ  → 全探索（DFS）で確実に解を発見
   - 組み合わせ数が多いステージ    → min-conflicts に近い山登り法＋ランダム再スタートで探索
   - 色フィルターミラー（RYM/GYC/BCM）が絡む密結合ステージ
                                   → 下記の「色チャンネル分解探索」を追加で試す
                                     （色変換パネルなどでこの前提が崩れているステージでは、
                                      ごく短時間で「使えない」と判断して通常探索に時間を譲る）
*/

const SOLVER_SOURCE_DIRS = ['right', 'down', 'left', 'up'];
const SOLVER_BRUTE_FORCE_LIMIT = 10000000; // これ以下の組み合わせ数なら全探索する
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
// 色のズレが最優先の指標だが、副次的に光線が実際に進んだ距離の合計を加点し、
// 山登り法が勾配を掴めるようにしている。
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
      if ((idx & 0x3ff) === 0 && Date.now() > deadline) { timedOut = true; return; }
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

/* ================= 色チャンネル分解探索（R探索/R固定 → G探索/G固定 → B探索/B固定）=================

   色問題（RYM/GYC/BCM のような色フィルターミラー）が絡むステージは、変数（ミラー）の数こそ多いが、
   実は「Rビットの光の経路に影響するのは、フィルター無しの全反射ミラーと、フィルターにRを含む
   ミラー（R自身・Y・M）だけ」という構造を持つ。G・Bだけに関係するミラーはRの光をただ素通りさせる
   だけなので、Rを解くという目的においては「どんな向きでもよい変数＝実質存在しない変数」になる。

   さらに「単色（1ビットだけ）のビームは分裂しない」という性質を利用し、実際にその色のビームが
   当たった未確定ミラーでだけ分岐するバックトラッキングを行う（関係のないミラー・まだビームが
   到達していないミラーは一切分岐に数えない）。

   R→G→Bの3チャンネルを1本の再帰として連結してあるため、Bで手詰まりになったら自動的にGの
   「次の候補」に戻り、Gも尽きたらRの「次の候補」に戻る、という本来のCSPバックトラッキングと
   同じ動きになる（単純に毎回最初からやり直すよりはるかに効率が良い）。

   色変換パネル（converter）が「入ってきた色に関係なく固定の色に変換する」場合、
   例えば本来Gを持たない光からGを新しく作り出すことがあり、この前提（Rだけ・Gだけを追えばよい）
   が崩れることがある。このモジュールは常に本物のビーム追跡（evaluateLevel）で最終検算するため、
   前提が崩れていても「間違った成功」を報告することはない。前提が崩れて本当に解けない場合は、
   ごく短時間で「このモデルでは解なし」と判定して抜けるので、その分の時間は通常のローカルサーチに
   回される（solveLevel 側で実施）。
*/
const CHANNEL_BIT = { R: 1, G: 2, B: 4 };

function backtrackSolveAllChannels(baseCtx, order, timeLimitMs, alwaysShuffle) {
  const { level, setVar, domains } = baseCtx;
  const elementAt = (x, y) => level.elements.find(e => e.x === x && e.y === y);
  const goalAt = (x, y) => level.goals.find(g => g.x === x && g.y === y);
  const isWall = (x, y) => level.walls.some(w => w[0] === x && w[1] === y);
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
 * @returns {{solved:boolean, mirrorStates:object, converterStates:object, sourceStates:object, penalty:number}}
 */
function solveLevel(level, options) {
  options = options || {};
  const totalTimeLimitMs = options.timeLimitMs || SOLVER_DEFAULT_TIME_LIMIT_MS;
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
    return Object.assign({ solved: allGoalsMet, penalty }, state);
  }

  const baseCtx = { level, varKind, domains, setVar, getVar, allVarIds };

  // 色フィルターミラー（R/G/B単色やY/M/Cの複合色など、filterColorがnullでも7でもないもの）が
  // 存在する場合だけ、色チャンネル分解探索を試す価値がある
  const hasColorSplitMirror = mirrorVars.some(id => {
    const fc = elementById[id].filterColor;
    return fc != null && (fc & 7) !== 7 && fc !== 0;
  });

  let overallBest = null;
  let overallBestPenalty = Infinity;
  function considerResult(res) {
    if (!res || !res.state) return false;
    if (res.solved) return true;
    if (res.penalty < overallBestPenalty) { overallBestPenalty = res.penalty; overallBest = res.state; }
    return false;
  }

  // ---- 戦略1：通常の全変数探索（従来通り。組み合わせ数が少ないステージはこれで一発）----
  const genericTimeShare = hasColorSplitMirror
    ? Math.min(Math.floor(totalTimeLimitMs * 0.2), 1000)
    : totalTimeLimitMs;
  const genericRes = searchAssignment({
    domains, setVar, getVar,
    freeVarIds: allVarIds,
    state: freshState(),
    evaluate: s => {
      const r = evaluateLevel(level, s);
      return { penalty: r.penalty, solved: r.allGoalsMet };
    },
    timeLimitMs: Math.max(200, Math.min(genericTimeShare, overallDeadline - Date.now())),
    bruteForceLimit: SOLVER_BRUTE_FORCE_LIMIT,
  });
  if (considerResult(genericRes)) {
    return Object.assign({ solved: true, penalty: 0 }, genericRes.state);
  }

  // ---- 戦略2：色チャンネル分解探索（R→G→B のように1色ずつ確定させ、変数を段階的に絞り込む）----
  if (hasColorSplitMirror && Date.now() < overallDeadline) {
    const channelOrders = [
      ['R', 'G', 'B'], ['G', 'B', 'R'], ['B', 'R', 'G'],
      ['R', 'B', 'G'], ['G', 'R', 'B'], ['B', 'G', 'R'],
    ];
    // 色変換パネルなどで分解の前提が崩れているステージでは、決定的な最初の1回でほぼ即座に
    // 「使えない」と判定できるので、多くの時間を消費しない設計になっている
    const decompDeadline = Math.min(overallDeadline, Date.now() + Math.floor(totalTimeLimitMs * 0.5));
    for (const order of channelOrders) {
      if (Date.now() >= decompDeadline) break;
      const remaining = decompDeadline - Date.now();
      const share = Math.max(150, Math.floor(remaining / (channelOrders.length - channelOrders.indexOf(order))));
      const res = backtrackSolveAllChannels(baseCtx, order, share, false);
      if (res.solved) {
        return Object.assign({ solved: true, penalty: 0 }, res.state);
      }
      // exhausted（このモデルでは解なし）の場合は他の順序を試しても無駄なので、
      // 残り時間をすぐ通常探索に譲る
      if (res.exhausted && order === channelOrders[0]) {
        // 最初の順序ですら前提が崩れている＝色変換等でこのステージには使えないと判断し、
        // 残りの順序は試さずに抜ける
        break;
      }
    }
  }

  // ---- 戦略3：残り時間を通常のローカルサーチに使う（保険。戦略1の結果から再開）----
  if (Date.now() < overallDeadline) {
    const fallbackState = overallBest ? cloneState(overallBest) : freshState();
    const res = searchAssignment({
      domains, setVar, getVar,
      freeVarIds: allVarIds,
      state: fallbackState,
      evaluate: s => {
        const r = evaluateLevel(level, s);
        return { penalty: r.penalty, solved: r.allGoalsMet };
      },
      timeLimitMs: overallDeadline - Date.now(),
      bruteForceLimit: 0,
    });
    if (considerResult(res)) {
      return Object.assign({ solved: true, penalty: 0 }, res.state);
    }
  }

  return Object.assign({ solved: false, penalty: overallBestPenalty }, overallBest || freshState());
}
