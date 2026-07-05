/* ================= beam engine ================= */
const DIRS = { right:[1,0], left:[-1,0], down:[0,1], up:[0,-1] };
const DIR_ANGLE = { right:0, down:90, left:180, up:270 };

// orient: 0=透過, 45=\相当(90度曲げ), 90=Uターン, 135=/相当(90度曲げ)
function reflect(dx, dy, orient){
  const a = (orient === undefined || orient === null) ? 45 : orient;
  if (a === 0)   return [dx, dy];       // 0度: 素通り
  if (a === 90)  return [-dx, -dy];     // 90度: Uターン反射
  if (a === 45)  return [dy, dx];       // 45度: \型 90度曲げ
  if (a === 135) return [-dy, -dx];     // 135度: /型 90度曲げ
  return [dx, dy]; // fallback
}
function rotateCCW(dx,dy){ return [dy,-dx]; }
function rotateCW(dx,dy){ return [-dy,dx]; }

function traceAll(level, mirrorStates, converterStates, sourceStates){
  const goalHits = {};
  const visited = new Set();
  const segments = [];
  let totalSteps = 0;
  const LIMIT = 4000;

  const isWall = (x,y) => level.walls.some(w=>w[0]===x&&w[1]===y);
  const elementAt = (x,y) => level.elements.find(e=>e.x===x&&e.y===y);
  const goalAt = (x,y) => level.goals.find(g=>g.x===x&&g.y===y);

  function walk(x0,y0,dx,dy,color){
    let cx=x0, cy=y0;
    let pts=[[cx,cy]];
    while(true){
      if (totalSteps++ > LIMIT){ segments.push({pts,color,terminal:'LOOP'}); return; }
      cx+=dx; cy+=dy;
      if (cx<0||cy<0||cx>=level.size||cy>=level.size){ pts.push([cx,cy]); segments.push({pts,color,terminal:'OUT'}); return; }
      pts.push([cx,cy]);
      if (isWall(cx,cy)){ segments.push({pts,color,terminal:'WALL'}); return; }
      const g = goalAt(cx,cy);
      if (g){
        const key = cx+','+cy;
        goalHits[key] = (goalHits[key]||0) | color;
        segments.push({pts,color,terminal:'GOAL'});
        return;
      }
      const stateKey = cx+','+cy+','+dx+','+dy+','+color;
      if (visited.has(stateKey)){ segments.push({pts,color,terminal:'LOOP'}); return; }
      visited.add(stateKey);

      const el = elementAt(cx,cy);
      if (!el) continue;

      if (el.kind==='mirror'){
        const orient = el.rotatable ? mirrorStates[el.id] : el.orient;
        // orient=0: 全色素通り（filterColor関係なく透過）
        if (orient === 0){
          continue; // dx,dy変わらず素通り
        }
        // orient=90: 全色Uターン反射（filterColor関係なく反射）
        if (orient === 90){
          dx = -dx; dy = -dy;
          continue;
        }
        if (el.filterColor){
          const reflectColor = color & el.filterColor;
          const transmitColor = color & (~el.filterColor) & 7;
          segments.push({pts,color,terminal:'SPLIT'});
          if (reflectColor){ const [rdx,rdy]=reflect(dx,dy,orient); walk(cx,cy,rdx,rdy,reflectColor); }
          if (transmitColor){ walk(cx,cy,dx,dy,transmitColor); }
          return;
        } else {
          const [ndx,ndy] = reflect(dx,dy,orient);
          dx = ndx; dy = ndy;
          continue;
        }
      }
      if (el.kind==='converter'){
        const isEnabled = (converterStates && el.id in converterStates) ? converterStates[el.id] : (el.enabled !== false);
        if (isEnabled) {
          const type = el.type || 'replace';
          if (type === 'add') {
            color = color | el.color;
          } else if (type === 'remove') {
            color = color & (~el.color) & 7;
          } else {
            color = el.color;
          }
          if (color === 0) {
            segments.push({pts, color: 0, terminal: 'ABSORBED'});
            return;
          }
        }
        continue;
      }
    }
  }

  level.sources.forEach(s => {
    const dir = (s.rotatable && sourceStates && sourceStates[s.id]) ? sourceStates[s.id] : s.dir;
    walk(s.x, s.y, DIRS[dir][0], DIRS[dir][1], s.color);
  });
  const goalStates = level.goals.map(g => ({ g, got: goalHits[g.x+','+g.y]||0, ok: (goalHits[g.x+','+g.y]||0)===g.color }));
  const allGoalsMet = goalStates.length>0 && goalStates.every(s=>s.ok);
  return { goalHits, segments, allGoalsMet, goalStates };
}
