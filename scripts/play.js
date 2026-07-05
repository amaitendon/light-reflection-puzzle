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
    if (visual && s.rotatable){
      cell.addEventListener('click', () => rotateSource(s.id, visual));
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
  const dirOrder = ['right', 'down', 'left', 'up'];
  const curDir = sourceStates[id];
  const curIdx = dirOrder.indexOf(curDir);
  const nextDir = dirOrder[(curIdx + 1) % 4];
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

function recompute(){
  const level = currentLevel;
  const { segments, allGoalsMet, goalStates } = traceAll(level, mirrorStates, converterStates, sourceStates);

  let svgParts = '';
  segments.forEach(seg => {
    let d = '';
    seg.pts.forEach(([x,y],i) => { const [px,py]=cellCenter(x,y); d += (i===0?'M ':'L ')+px+' '+py+' '; });
    const hex = COLOR_HEX[seg.color] || '#ffffff';
    svgParts += `<path class="beam-glow" style="stroke:${hex}" d="${d}"></path>`;
    svgParts += `<path class="beam-core" style="stroke:${hex}; filter:drop-shadow(0 0 4px ${hex})" d="${d}"></path>`;
    if (['WALL','OUT','ABSORB','LOOP'].includes(seg.terminal)){
      const last = seg.pts[seg.pts.length-1];
      const [ex,ey] = cellCenter(last[0], last[1]);
      svgParts += `<circle class="impact-mark" cx="${ex}" cy="${ey}" r="5"></circle>`;
    }
  });
  svgEl.innerHTML = svgParts;

  goalStates.forEach(({g, ok}) => {
    const cell = cellMapP[g.x+','+g.y];
    cell.classList.toggle('hit', ok);
    const target = cell.querySelector('.target');
    if (target) target.style.boxShadow = `0 0 ${ok?18:10}px ${COLOR_HEX[g.color]}`;
  });

  const satisfied = goalStates.filter(s=>s.ok).length;
  const total = goalStates.length;

  if (allGoalsMet){
    statusEl.textContent = `すべてのゴール(${total})に到達！クリア！`;
    statusEl.className = 'hud-msg ok';
    setTimeout(showClearBanner, 450);
  } else if (satisfied > 0){
    statusEl.textContent = `ゴール ${satisfied}/${total} 達成 — まだ色が合っていない場所がある`;
    statusEl.className = 'hud-msg mid';
  } else {
    statusEl.textContent = `ゴール 0/${total} 達成 — 光を届けよう`;
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
