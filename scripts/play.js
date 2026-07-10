/* ================================================================
   PLAY
   ================================================================ */
const gridP = $('#grid');
const boardP = $('#board');
const svgEl = $('#beamSvg');
const statusEl = $('#statusMsg');
const playTitle = $('#playTitle');
const rulerTop = $('#rulerTop');
const rulerLeft = $('#rulerLeft');
const clearBanner = $('#clearBanner');
const playListView = $('#playListView');
const playBoardView = $('#playBoardView');
const stageList = $('#stageList');

let currentLevel = null;
let currentMeta = { name:'', savedId:null, isTest:false };
let mirrorStates = {};
let converterStates = {};
let sourceStates = {};
let cellPxP = 56;
let cellMapP = {};

// ---- 経路確認モード（最後にクリックした光源の光線だけをアニメーション表示）----
const traceModeBtn = $('#traceModeBtn');
const traceHint = $('#traceHint');
let traceMode = false;
let tracedSourceId = null;
const BEAM_STEP_MS = 130; // 1マス進むのにかかる時間

function setTraceMode(on){
  traceMode = on;
  traceModeBtn.classList.toggle('active', traceMode);
  if (!traceMode){ tracedSourceId = null; }
  updateTraceHint();
  if (currentLevel){ buildPlayBoard(currentLevel); recompute(); }
}
function updateTraceHint(){
  traceHint.style.display = (traceMode && !tracedSourceId) ? '' : 'none';
}
traceModeBtn.addEventListener('click', () => setTraceMode(!traceMode));

function selectTraceSource(id){
  tracedSourceId = id;
  updateTraceHint();
  buildPlayBoard(currentLevel);
  recompute();
}

// ---- 表示サイズ（セルのピクセルサイズの倍率）----
// エディターと同様、盤面のマス数によらずプレイ時のセルサイズを調整できるようにする。
const PLAY_ZOOM_MIN = 0.5;
const PLAY_ZOOM_MAX = 2.0;
const PLAY_ZOOM_STEP = 0.1;
let playZoom = parseFloat(localStorage.getItem('lightPuzzle.playZoom'));
if (!isFinite(playZoom)) playZoom = 1;
playZoom = Math.max(PLAY_ZOOM_MIN, Math.min(PLAY_ZOOM_MAX, playZoom));

const playZoomVal = $('#playZoomVal');
function setPlayZoom(z){
  playZoom = Math.max(PLAY_ZOOM_MIN, Math.min(PLAY_ZOOM_MAX, Math.round(z * 100) / 100));
  localStorage.setItem('lightPuzzle.playZoom', playZoom);
  playZoomVal.textContent = Math.round(playZoom * 100) + '%';
  if (currentLevel){ buildPlayBoard(currentLevel); recompute(); }
}
$('#playZoomUp').addEventListener('click', () => setPlayZoom(playZoom + PLAY_ZOOM_STEP));
$('#playZoomDown').addEventListener('click', () => setPlayZoom(playZoom - PLAY_ZOOM_STEP));
playZoomVal.textContent = Math.round(playZoom * 100) + '%';

function showPlayList(){ playListView.style.display=''; playBoardView.style.display='none'; renderStageList(); }
function showPlayBoard(){ playListView.style.display='none'; playBoardView.style.display=''; }
$('#backToListBtn').addEventListener('click', showPlayList);

async function renderStageList(){
  stageList.innerHTML = '<div class="empty-state">読み込み中...</div>';
  const stages = await loadOfficialStages();
  stageList.innerHTML = '';
  if (stages.length===0){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '公式ステージがありません。<br>「つくる」タブでステージを作成できます。';
    stageList.appendChild(empty);
    return;
  }
  stages.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'stage-item';
    item.innerHTML = `
      <div class="thumb"></div>
      <div class="meta"><div class="name"></div><div class="sub"></div></div>
      <div class="actions">
        <button class="btn btn-primary" data-act="play">遊ぶ</button>
      </div>`;
    const name = entry.name || entry.title || entry.id;
    item.querySelector('.name').textContent = name;
    item.querySelector('.sub').textContent = `${entry.level.size}×${entry.level.size} ・ 光源${entry.level.sources.length} ・ ゴール${entry.level.goals.length}`;
    item.querySelector('[data-act="play"]').addEventListener('click', () => {
      loadLevel(entry.level, name, entry.id, false);
    });
    stageList.appendChild(item);
  });
}

function migrateLegacyData(level){
  level.elements = level.elements.map(e => {
    if (e.kind==='mirror'){
      if (e.type==='M'){
        return { ...e, rotatable: true, doubleSided: true, filterColor: null };
      } else if (e.type==='F'){
        return { ...e, rotatable: false, doubleSided: true, filterColor: null };
      }
    }
    if (e.kind==='halfmirror'){
      return { ...e, kind: 'mirror', rotatable: true, doubleSided: true, filterColor: e.color };
    }
    return e;
  });
  if (level.sources) {
    level.sources = level.sources.map(s => {
      if (s.rotatable === undefined) {
        return { ...s, rotatable: false };
      }
      return s;
    });
  }
}

function loadLevel(level, name, savedId, isTest){
  const levelCopy = JSON.parse(JSON.stringify(level));
  migrateLegacyData(levelCopy);
  currentLevel = levelCopy;
  currentMeta = { name, savedId, isTest };
  mirrorStates = {};
  converterStates = {};
  sourceStates = {};
  traceMode = false;
  tracedSourceId = null;
  traceModeBtn.classList.remove('active');
  updateTraceHint();
  levelCopy.elements.forEach(e => {
    if (e.kind==='mirror' && e.rotatable) {
      mirrorStates[e.id] = normalizeMirrorAngle(e.orient);
    }
    if (e.kind==='converter') converterStates[e.id] = (e.enabled !== false);
  });
  levelCopy.sources.forEach(s => {
    if (s.rotatable) sourceStates[s.id] = s.dir;
  });
  playTitle.textContent = (isTest ? '🧪 テスト：' : '') + name;
  // 盤面のサイズ計算は board-wrap が実際に表示された(display:none が解除された)後に行う必要がある
  showPlayBoard();
  buildPlayBoard(levelCopy);
  recompute();
}

function buildPlayBoard(level){
  const size = level.size;
  const { cellPx } = layoutBoard({
    wrapEl: boardP.closest('.board-wrap'),
    gridEl: gridP,
    boardEl: boardP,
    rulerTopEl: rulerTop,
    rulerLeftEl: rulerLeft,
    svgEl: svgEl,
    size,
    maxCellPx: 84,
    zoom: playZoom,
  });
  cellPxP = cellPx;

  gridP.innerHTML = '';
  cellMapP = {};
  for (let yy=0; yy<size; yy++){
    for (let xx=0; xx<size; xx++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cellMapP[xx+','+yy] = cell;
      gridP.appendChild(cell);
    }
  }

  level.walls.forEach(([x,y]) => cellMapP[x+','+y].classList.add('wall'));

  level.elements.forEach(e => {
    const cell = cellMapP[e.x+','+e.y];
    const orient = e.kind==='mirror' && e.rotatable ? mirrorStates[e.id] : e.orient;
    const enabled = e.kind==='converter' ? converterStates[e.id] : e.enabled;
    const opts = Object.assign({}, e, orient!==undefined?{orient}:{}, enabled!==undefined?{enabled}:{});
    const visual = renderElementVisual(cell, e.kind, opts);
    if (visual && e.kind==='mirror' && e.rotatable){
      cell.addEventListener('click', () => rotateMirror(e.id, visual));
    }
    if (visual && e.kind==='converter' && e.interactive){
      cell.addEventListener('click', () => toggleConverter(e.id, cell, visual));
    }
  });

  level.sources.forEach(s => {
    const dir = (s.rotatable && sourceStates[s.id]) ? sourceStates[s.id] : s.dir;
    const opts = Object.assign({}, s, {dir});
    const cell = cellMapP[s.x+','+s.y];
    const visual = renderSourceVisual(cell, opts);
    if (traceMode && tracedSourceId === s.id){ cell.classList.add('traced'); }
    if (visual){
      if (traceMode){ cell.classList.add('movable'); }
      cell.addEventListener('click', () => {
        if (traceMode){ selectTraceSource(s.id); }
        else if (s.rotatable){ rotateSource(s.id, visual); }
      });
    }
  });
  level.goals.forEach(g => renderGoalVisual(cellMapP[g.x+','+g.y], g, false));
}

function rotateMirror(id, lineEl){
  const cur = normalizeMirrorAngle(mirrorStates[id]);
  const idx = MIRROR_ROTATION_STEPS.indexOf(cur);
  const next = MIRROR_ROTATION_STEPS[(idx + 1) % MIRROR_ROTATION_STEPS.length];
  mirrorStates[id] = next;
  buildPlayBoard(currentLevel);
  recompute();
}

function rotateSource(id, arrowEl){
  const cur = parseFloat(arrowEl.dataset.deg) || 0;
  const next = cur + 90;
  arrowEl.style.transform = `translate(-30%,-50%) rotate(${next}deg)`;
  arrowEl.dataset.deg = next;
  const curDir = sourceStates[id];
  const curIdx = SOURCE_DIR_ORDER.indexOf(curDir);
  const nextDir = SOURCE_DIR_ORDER[(curIdx + 1) % SOURCE_DIR_ORDER.length];
  sourceStates[id] = nextDir;
  recompute();
}

function toggleConverter(id, cellEl, panelEl){
  converterStates[id] = !converterStates[id];
  const enabled = converterStates[id];
  panelEl.classList.toggle('disabled', !enabled);
  const badge = cellEl.querySelector('.converter-badge');
  if (badge) {
    badge.textContent = enabled ? 'ON' : 'OFF';
  }
  recompute();
}

function cellCenter(x,y){ return [ x*cellPxP + cellPxP/2, y*cellPxP + cellPxP/2 ]; }

function edgeKeyOf(a, b){
  // 向きに依存しないキーにする（A→B も B→A も同じ物理経路として扱う）
  return (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]))
    ? `${a[0]},${a[1]}|${b[0]},${b[1]}`
    : `${b[0]},${b[1]}|${a[0]},${a[1]}`;
}

function renderBeamsNormal(segments){
  // 同じ経路（マス目間の同じ辺）を複数の光線が通る場合、色をビットOR合成して混色表示する
  const edgeColor = new Map();
  segments.forEach(seg => {
    for (let i = 0; i < seg.pts.length - 1; i++){
      const key = edgeKeyOf(seg.pts[i], seg.pts[i+1]);
      edgeColor.set(key, (edgeColor.get(key) || 0) | seg.color);
    }
  });

  let svgParts = '';
  const drawnEdges = new Set();
  segments.forEach(seg => {
    for (let i = 0; i < seg.pts.length - 1; i++){
      const a = seg.pts[i], b = seg.pts[i+1];
      const key = edgeKeyOf(a, b);
      if (drawnEdges.has(key)) continue;
      drawnEdges.add(key);
      const color = edgeColor.get(key);
      const hex = COLOR_HEX[color] || '#ffffff';
      const [ax, ay] = cellCenter(a[0], a[1]);
      const [bx, by] = cellCenter(b[0], b[1]);
      const d = `M ${ax} ${ay} L ${bx} ${by}`;
      svgParts += `<path class="beam-glow" style="stroke:${hex}" d="${d}"></path>`;
      svgParts += `<path class="beam-core" style="stroke:${hex}; filter:drop-shadow(0 0 4px ${hex})" d="${d}"></path>`;
    }
  });
  segments.forEach(seg => {
    if (['WALL','OUT','ABSORBED','LOOP'].includes(seg.terminal)){
      const last = seg.pts[seg.pts.length-1];
      const [ex,ey] = cellCenter(last[0], last[1]);
      svgParts += `<circle class="impact-mark" cx="${ex}" cy="${ey}" r="5"></circle>`;
    }
  });
  svgEl.innerHTML = svgParts;
}

// ---- 経路確認モード：選択した光源の光線だけを、光源から順番にアニメーションで描画する ----
function renderBeamsTraced(allSegments){
  svgEl.innerHTML = '';
  if (!tracedSourceId) return;
  const segs = allSegments.filter(seg => seg.sourceId === tracedSourceId);
  if (segs.length === 0) return;

  const svgNS = 'http://www.w3.org/2000/svg';
  const edges = [];
  segs.forEach(seg => {
    for (let i = 0; i < seg.pts.length - 1; i++){
      edges.push({ a: seg.pts[i], b: seg.pts[i+1], color: seg.color, offset: (seg.startDist||0) + i });
    }
  });

  const animatedPaths = [];
  edges.forEach(edge => {
    const hex = COLOR_HEX[edge.color] || '#ffffff';
    const [ax, ay] = cellCenter(edge.a[0], edge.a[1]);
    const [bx, by] = cellCenter(edge.b[0], edge.b[1]);
    const d = `M ${ax} ${ay} L ${bx} ${by}`;

    const glow = document.createElementNS(svgNS, 'path');
    glow.setAttribute('class', 'beam-glow');
    glow.setAttribute('d', d);
    glow.style.stroke = hex;
    const core = document.createElementNS(svgNS, 'path');
    core.setAttribute('class', 'beam-core');
    core.setAttribute('d', d);
    core.style.stroke = hex;
    core.style.filter = `drop-shadow(0 0 4px ${hex})`;

    svgEl.appendChild(glow);
    svgEl.appendChild(core);
    animatedPaths.push({ glow, core, offset: edge.offset });
  });

  animatedPaths.forEach(({ glow, core, offset }) => {
    [glow, core].forEach(p => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      p.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: BEAM_STEP_MS, delay: offset * BEAM_STEP_MS, fill: 'forwards', easing: 'linear' }
      );
    });
  });

  const maxOffset = edges.reduce((m, e) => Math.max(m, e.offset), 0) + 1;
  setTimeout(() => {
    segs.forEach(seg => {
      if (['WALL','OUT','ABSORBED','LOOP'].includes(seg.terminal)){
        const last = seg.pts[seg.pts.length-1];
        const [ex,ey] = cellCenter(last[0], last[1]);
        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('class', 'impact-mark');
        circle.setAttribute('cx', ex);
        circle.setAttribute('cy', ey);
        circle.setAttribute('r', 5);
        circle.style.opacity = '0';
        svgEl.appendChild(circle);
        circle.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
      }
    });
  }, maxOffset * BEAM_STEP_MS);
}

function recompute(){
  const level = currentLevel;
  const { segments, allGoalsMet, goalStates } = traceAll(level, mirrorStates, converterStates, sourceStates);

  if (traceMode){
    renderBeamsTraced(segments);
  } else {
    renderBeamsNormal(segments);
  }

  goalStates.forEach(({g, ok}) => {
    const cell = cellMapP[g.x+','+g.y];
    cell.classList.toggle('hit', ok);
    const target = cell.querySelector('.target');
    if (target) target.style.boxShadow = `0 0 ${ok?18:10}px ${COLOR_HEX[g.color]}`;
  });

  const satisfied = goalStates.filter(s=>s.ok).length;
  const total = goalStates.length;

  if (allGoalsMet){
    statusEl.textContent = `ゴール ${satisfied}/${total}`;
    statusEl.className = 'hud-msg ok';
    if (!currentMeta.isTest) setTimeout(showClearBanner, 450);
  } else if (satisfied > 0){
    statusEl.textContent = `ゴール ${satisfied}/${total}`;
    statusEl.className = 'hud-msg mid';
  } else {
    statusEl.textContent = `ゴール ${satisfied}/${total}`;
    statusEl.className = 'hud-msg bad';
  }
}

function showClearBanner(){
  $('#clearTitle').textContent = 'CLEAR';
  $('#clearText').textContent = '「' + currentMeta.name + '」をクリアしました！';
  clearBanner.classList.add('show');
}
$('#clearReplay').addEventListener('click', () => {
  clearBanner.classList.remove('show');
  loadLevel(currentLevel, currentMeta.name, currentMeta.savedId, currentMeta.isTest);
});
$('#clearBack').addEventListener('click', () => {
  clearBanner.classList.remove('show');
  if (currentMeta.isTest) showTab('editor'); else showPlayList();
});
$('#resetBtn').addEventListener('click', () => {
  loadLevel(currentLevel, currentMeta.name, currentMeta.savedId, currentMeta.isTest);
});

const autoSolveBtn = $('#autoSolveBtn');
autoSolveBtn.addEventListener('click', () => runAutoSolve());

async function runAutoSolve(){
  if (!currentLevel) return;
  autoSolveBtn.disabled = true;
  const prevText = statusEl.textContent;
  const prevClass = statusEl.className;
  statusEl.textContent = '解を探索中…';
  statusEl.className = 'hud-msg mid';
  // 探索前にメッセージを画面へ反映させるため、1フレーム分待ってから重い処理を始める
  await new Promise(resolve => setTimeout(resolve, 30));

  let result;
  try {
    result = solveLevel(currentLevel, { timeLimitMs: 6000 });
  } catch (err) {
    console.error(err);
    result = null;
  }

  autoSolveBtn.disabled = false;

  if (result && result.solved){
    mirrorStates = result.mirrorStates;
    converterStates = result.converterStates;
    sourceStates = result.sourceStates;
    buildPlayBoard(currentLevel);
    recompute();
  } else {
    statusEl.textContent = '解が見つかりませんでした（もう一度試すと見つかることがあります）';
    statusEl.className = 'hud-msg bad';
    setTimeout(() => {
      if (statusEl.textContent === '解が見つかりませんでした（もう一度試すと見つかることがあります）'){
        statusEl.textContent = prevText;
        statusEl.className = prevClass;
      }
    }, 2800);
  }
}
