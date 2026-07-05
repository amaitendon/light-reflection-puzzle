/* ================= beam engine ================= */
const DIRS = { right:[1,0], left:[-1,0], down:[0,1], up:[0,-1] };
const DIR_ANGLE = { right:0, down:90, left:180, up:270 };

function reflect(dx, dy, orient){ return orient==='/' ? [-dy,-dx] : [dy,dx]; }
function rotateCCW(dx,dy){ return [dy,-dx]; }
function rotateCW(dx,dy){ return [-dy,dx]; }

function traceAll(level, mirrorStates, converterStates){
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
        if (el.filterColor){
          const reflectColor = color & el.filterColor;
          const transmitColor = color & (~el.filterColor) & 7;
          segments.push({pts,color,terminal:'SPLIT'});
          if (reflectColor){ const [rdx,rdy]=reflect(dx,dy,orient); walk(cx,cy,rdx,rdy,reflectColor); }
          if (transmitColor){ walk(cx,cy,dx,dy,transmitColor); }
          return;
        } else {
          [dx,dy] = reflect(dx,dy,orient);
          continue;
        }
      }
      if (el.kind==='converter'){
        const isEnabled = (converterStates && el.id in converterStates) ? converterStates[el.id] : (el.enabled !== false);
        if (isEnabled) {
          color = el.color;
        }
        continue;
      }
    }
  }

  level.sources.forEach(s => walk(s.x, s.y, DIRS[s.dir][0], DIRS[s.dir][1], s.color));
  const goalStates = level.goals.map(g => ({ g, got: goalHits[g.x+','+g.y]||0, ok: (goalHits[g.x+','+g.y]||0)===g.color }));
  const allGoalsMet = goalStates.length>0 && goalStates.every(s=>s.ok);
  return { goalHits, segments, allGoalsMet, goalStates };
}
