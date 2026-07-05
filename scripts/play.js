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

function renderStageList(){
  stageList.innerHTML = '';
  if (customLevels.length===0){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = 'まだステージがありません。<br>「つくる」タブでステージを作って保存しよう。';
    stageList.appendChild(empty);
    return;
  }
  customLevels.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'stage-item';
    item.innerHTML = `
      <div class="thumb"></div>
      <div class="meta"><div class="name"></div><div class="sub"></div></div>
      <div class="actions">
        <button class="btn btn-primary" data-act="play">遊ぶ</button>
        <button class="btn" data-act="edit">編集</button>
        <button class="btn btn-danger" data-act="del">削除</button>
      </div>`;
    item.querySelector('.name').textContent = entry.name;
    item.querySelector('.sub').textContent = `${entry.level.size}×${entry.level.size} ・ 光源${entry.level.sources.length} ・ ゴール${entry.level.goals.length}`;
    item.querySelector('[data-act="play"]').addEventListener('click', () => loadLevel(entry.level, entry.name, entry.id, false));
    item.querySelector('[data-act="edit"]').addEventListener('click', () => {
      const level = JSON.parse(JSON.stringify(entry.level));
      migrateLegacyData(level);
      draft = {
        size: level.size,
        walls: level.walls.map(w=>w.slice()),
        elements: level.elements.map(e=>Object.assign({}, e)),
        sources: level.sources.map(s=>Object.assign({}, s)),
        goals: level.goals.map(g=>Object.assign({}, g)),
      };
      $('#nameInput').value = entry.name;
      sizeVal.textContent = draft.size + ' × ' + draft.size;
      renderEditor();
      showTab('editor');
    });
    item.querySelector('[data-act="del"]').addEventListener('click', async () => {
      customLevels = customLevels.filter(e => e.id !== entry.id);
      await persistCustomLevels();
      renderStageList();
      toast('削除しました');
    });
    stageList.appendChild(item);
  });
}

function migrateLegacyData(level){
  level.elements = level.elements.map(e => {
    if (e.kind==='mirror'){
      if (e.type==='M'){
        return { ...e, rotatable: true, filterColor: null };
      } else if (e.type==='F'){
        return { ...e, rotatable: false, filterColor: null };
      }
    }
    if (e.kind==='halfmirror'){
      return { ...e, kind: 'mirror', rotatable: true, filterColor: e.color };
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
      // /\を数値に変換、すでに数値ならそのまま使う
      let o = e.orient;
      if (o === '/') o = 135;
      else if (o === '\\') o = 45;
      else if (typeof o !== 'number') o = 45;
      mirrorStates[e.id] = o;
    }
    if (e.kind==='converter') converterStates[e.id] = (e.enabled !== false);
  });
  levelCopy.sources.forEach(s => {
    if (s.rotatable) sourceStates[s.id] = s.dir;
  });
  playTitle.textContent = (isTest ? '🧪 テスト：' : '') + name;
  buildPlayBoard(levelCopy);
  recompute();
  showPlayBoard();
}

function buildPlayBoard(level){
  const size = level.size;
  const wrapWidth = Math.min(560, (document.querySelector('.board-wrap').clientWidth - 40) || 480);
  cellPxP = Math.max(26, Math.min(84, Math.floor(wrapWidth / size)));
  const total = cellPxP * size;

  gridP.style.gridTemplateColumns = `repeat(${size}, ${cellPxP}px)`;
  gridP.style.gridTemplateRows = `repeat(${size}, ${cellPxP}px)`;
  gridP.style.width = total+'px'; gridP.style.height = total+'px';
  boardP.style.width = total+'px'; boardP.style.height = total+'px';
  svgEl.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svgEl.style.width = total+'px'; svgEl.style.height = total+'px';

  rulerTop.innerHTML=''; rulerLeft.innerHTML='';
  rulerTop.style.width = total+'px'; rulerLeft.style.height = total+'px';
  for (let i=0;i<size;i++){
    const t=document.createElement('span'); t.textContent = i%2===0?i:''; rulerTop.appendChild(t);
    const l=document.createElement('span'); l.textContent = i%2===0?i:''; rulerLeft.appendChild(l);
  }

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
  const STEPS = [0, 45, 90, 135];
  const cur = mirrorStates[id];
  const idx = STEPS.indexOf(cur);
  const next = STEPS[(idx + 1) % 4];
  lineEl.style.transform = `rotate(${next}deg)`;
  lineEl.dataset.deg = next;
  mirrorStates[id] = next;
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
