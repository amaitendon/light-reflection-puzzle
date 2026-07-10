/* ================= beam engine ================= */
const DIRS = { right:[1,0], left:[-1,0], down:[0,1], up:[0,-1] };
const DIR_ANGLE = { right:0, down:90, left:180, up:270 };
// 光源の向きを時計回りに1段階ずつ進めるときに使う共通の並び順（エディター・プレイ両方で使用）
const SOURCE_DIR_ORDER = ['right', 'down', 'left', 'up'];
const MIRROR_ROTATION_STEPS = [0, 45, 90, 135, 180, 225, 270, 315];

function normalizeMirrorAngle(angle) {
  let raw = angle;
  if (raw === '/') raw = 135;
  else if (raw === '\\') raw = 45;
  const numeric = Number(raw);
  const base = Number.isFinite(numeric) ? numeric : 45;
  const snapped = Math.round(base / 45) * 45;
  const normalized = snapped % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function angleToVector(angle) {
  const rad = angle * Math.PI / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

function snapCardinal(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
    return [dx >= 0 ? 1 : -1, 0];
  }
  return [0, dy >= 0 ? 1 : -1];
}

function reflectVector(dx, dy, lineAngle) {
  const [ux, uy] = angleToVector(lineAngle);
  const dot = dx * ux + dy * uy;
  const rx = 2 * dot * ux - dx;
  const ry = 2 * dot * uy - dy;
  return snapCardinal(rx, ry);
}

function isFrontSide(dx, dy, lineAngle) {
  const [nx, ny] = angleToVector(lineAngle + 90);
  return dx * nx + dy * ny >= -1e-9;
}

// 座標→要素の参照を毎回 level.walls/elements/goals から線形探索する処理は、
// ビーム追跡（traceAll）とバックトラッキング探索（solver.js）の両方で必要になる。
// 探索ロジック自体は両者で異なるが、この参照処理だけは全く同一なので共通化する。
function makeLevelLookup(level) {
  return {
    isWall: (x, y) => level.walls.some(w => w[0] === x && w[1] === y),
    elementAt: (x, y) => level.elements.find(e => e.x === x && e.y === y),
    goalAt: (x, y) => level.goals.find(g => g.x === x && g.y === y),
  };
}

function traceAll(level, mirrorStates, converterStates, sourceStates){
  const goalHits = {};
  const visited = new Set();
  const segments = [];
  let totalSteps = 0;
  const LIMIT = 4000;

  const { isWall, elementAt, goalAt } = makeLevelLookup(level);

  function walk(x0,y0,dx,dy,color,sourceId,startDist){
    startDist = startDist || 0;
    let cx=x0, cy=y0;
    let pts=[[cx,cy]];
    while(true){
      if (totalSteps++ > LIMIT){ segments.push({pts,color,terminal:'LOOP',sourceId,startDist}); return; }
      cx+=dx; cy+=dy;
      if (cx<0||cy<0||cx>=level.size||cy>=level.size){ pts.push([cx,cy]); segments.push({pts,color,terminal:'OUT',sourceId,startDist}); return; }
      pts.push([cx,cy]);
      if (isWall(cx,cy)){ segments.push({pts,color,terminal:'WALL',sourceId,startDist}); return; }
      const g = goalAt(cx,cy);
      if (g){
        const key = cx+','+cy;
        goalHits[key] = (goalHits[key]||0) | color;
        segments.push({pts,color,terminal:'GOAL',sourceId,startDist});
        return;
      }
      const stateKey = cx+','+cy+','+dx+','+dy+','+color;
      if (visited.has(stateKey)){ segments.push({pts,color,terminal:'LOOP',sourceId,startDist}); return; }
      visited.add(stateKey);

      const el = elementAt(cx,cy);
      if (!el) continue;

      if (el.kind==='mirror'){
        const orient = normalizeMirrorAngle(el.rotatable ? mirrorStates[el.id] : el.orient);
        const frontSide = isFrontSide(dx, dy, orient);
        if (el.doubleSided === false && !frontSide){
          segments.push({pts,color,terminal:'ABSORBED',sourceId,startDist});
          return;
        }
        if (el.filterColor){
          const reflectColor = color & el.filterColor;
          const transmitColor = color & (~el.filterColor) & 7;
          segments.push({pts,color,terminal:'SPLIT',sourceId,startDist});
          const nextStart = startDist + (pts.length - 1);
          if (reflectColor){
            const [rdx,rdy]=reflectVector(dx,dy,orient);
            walk(cx,cy,rdx,rdy,reflectColor,sourceId,nextStart);
          }
          if (transmitColor){ walk(cx,cy,dx,dy,transmitColor,sourceId,nextStart); }
          return;
        } else {
          const [ndx,ndy] = reflectVector(dx,dy,orient);
          dx = ndx; dy = ndy;
          continue;
        }
      }
      if (el.kind==='converter'){
        const isEnabled = (converterStates && el.id in converterStates) ? converterStates[el.id] : (el.enabled !== false);
        if (isEnabled) {
          const type = el.type || 'replace';
          let newColor = color;
          if (type === 'add') {
            newColor = color | el.color;
          } else if (type === 'remove') {
            newColor = color & (~el.color) & 7;
          } else {
            newColor = el.color;
          }
          // パネルの位置で線分を区切る（パネル通過前後で色を変えて描画するため）
          segments.push({pts, color, terminal:'CONVERT', sourceId, startDist});
          const nextStart = startDist + (pts.length - 1);
          if (newColor === 0) {
            segments.push({pts:[[cx,cy]], color:0, terminal:'ABSORBED', sourceId, startDist: nextStart});
            return;
          }
          walk(cx, cy, dx, dy, newColor, sourceId, nextStart);
          return;
        }
        continue;
      }
    }
  }

  level.sources.forEach(s => {
    const dir = (s.rotatable && sourceStates && sourceStates[s.id]) ? sourceStates[s.id] : s.dir;
    walk(s.x, s.y, DIRS[dir][0], DIRS[dir][1], s.color, s.id, 0);
  });
  const goalStates = level.goals.map(g => ({ g, ok: (goalHits[g.x+','+g.y]||0)===g.color }));
  const allGoalsMet = goalStates.length>0 && goalStates.every(s=>s.ok);
  return { segments, allGoalsMet, goalStates, goalHits };
}
