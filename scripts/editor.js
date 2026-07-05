/* ================================================================
   EDITOR
   ================================================================ */
let draft = { size:8, walls:[], elements:[], sources:[], goals:[] };
let seq = 0;
function nextId(){ return 'e'+(seq++); }

let currentTool = 'wall';
let currentDir = 'right';
let currentColor = 7;
let mirrorRotatable = true;
let mirrorDoubleSided = true;
let mirrorFilterEnabled = false;
let mirrorFilterColor = 7;
let sourceRotatable = false;

let isDragging = false;
let lastErasedCell = null;

const gridE = $('#gridE');
const boardE = $('#boardE');
const rulerTopE = $('#rulerTopE');
const rulerLeftE = $('#rulerLeftE');
const sizeVal = $('#sizeVal');
const editorMsg = $('#editorMsg');
const dirRow = $('#dirRow');
const colorRow = $('#colorRow');
const colorPicker = $('#colorPicker');
const mirrorSettingsRow = $('#mirrorSettingsRow');
const mirrorRotatableCheck = $('#mirrorRotatable');
const mirrorDoubleSidedCheck = $('#mirrorDoubleSided');
const mirrorFilterEnabledCheck = $('#mirrorFilterEnabled');
const mirrorFilterColorPicker = $('#mirrorFilterColorPicker');

let converterInteractive = false;
let converterType = 'replace';
const converterSettingsRow = $('#converterSettingsRow');
const converterInteractiveCheck = $('#converterInteractive');

converterInteractiveCheck.addEventListener('change', () => {
  converterInteractive = converterInteractiveCheck.checked;
});
converterInteractiveCheck.checked = converterInteractive;
document.querySelectorAll('input[name="converterType"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      converterType = radio.value;
    }
  });
});

const sourceSettingsRow = $('#sourceSettingsRow');
const sourceRotatableCheck = $('#sourceRotatable');

sourceRotatableCheck.checked = sourceRotatable;
sourceRotatableCheck.addEventListener('change', () => {
  sourceRotatable = sourceRotatableCheck.checked;
});

const NEEDS_COLOR = new Set(['source','goal','converter','mirror']);

COLORS.forEach(c => {
  const b = document.createElement('button');
  b.className = 'color-swatch-btn';
  b.style.background = c.hex;
  b.title = c.name;
  b.dataset.bits = c.bits;
  b.addEventListener('click', () => {
    currentColor = c.bits;
    document.querySelectorAll('.color-swatch-btn').forEach(x=>x.classList.toggle('active', x===b));
  });
  colorPicker.appendChild(b);
});
colorPicker.children[colorPicker.children.length-1].classList.add('active'); // default white

COLORS.forEach(c => {
  const b = document.createElement('button');
  b.className = 'color-swatch-btn';
  b.style.background = c.hex;
  b.title = c.name;
  b.dataset.bits = c.bits;
  b.addEventListener('click', () => {
    mirrorFilterColor = c.bits;
    document.querySelectorAll('#mirrorFilterColorPicker .color-swatch-btn').forEach(x=>x.classList.toggle('active', x===b));
  });
  mirrorFilterColorPicker.appendChild(b);
});
mirrorFilterColorPicker.children[mirrorFilterColorPicker.children.length-1].classList.add('active'); // default white

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b===btn));
    dirRow.style.display = currentTool==='source' ? 'flex' : 'none';
    colorRow.style.display = NEEDS_COLOR.has(currentTool) && currentTool!=='mirror' ? 'flex' : 'none';
    sourceSettingsRow.style.display = currentTool==='source' ? 'flex' : 'none';
    mirrorSettingsRow.style.display = currentTool==='mirror' ? 'flex' : 'none';
    converterSettingsRow.style.display = currentTool==='converter' ? 'flex' : 'none';
  });
});
document.querySelectorAll('.dir-picker button').forEach(btn => {
  btn.addEventListener('click', () => {
    currentDir = btn.dataset.dir;
    document.querySelectorAll('.dir-picker button').forEach(b => b.classList.toggle('active', b===btn));
  });
});
document.querySelector('[data-tool="wall"]').classList.add('active');
document.querySelector('[data-dir="right"]').classList.add('active');

mirrorRotatableCheck.addEventListener('change', () => {
  mirrorRotatable = mirrorRotatableCheck.checked;
});

mirrorDoubleSidedCheck.addEventListener('change', () => {
  mirrorDoubleSided = mirrorDoubleSidedCheck.checked;
});

mirrorFilterEnabledCheck.addEventListener('change', () => {
  mirrorFilterEnabled = mirrorFilterEnabledCheck.checked;
  mirrorFilterColorPicker.style.display = mirrorFilterEnabled ? 'flex' : 'none';
});

let dragSetupDone = false;

function setupDragPlacement(){
  if (dragSetupDone) return;
  dragSetupDone = true;
  gridE.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastErasedCell = null;
    const cell = e.target.closest('.cell');
    if (cell){
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      onEditorCellClick(x, y);
      lastErasedCell = `${x},${y}`;
    }
  });

  gridE.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const cell = e.target.closest('.cell');
    if (cell){
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      const cellKey = `${x},${y}`;
      if (lastErasedCell !== cellKey){
        onEditorCellClick(x, y);
        lastErasedCell = cellKey;
      }
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    lastErasedCell = null;
  });

  gridE.addEventListener('mouseleave', () => {
    isDragging = false;
    lastErasedCell = null;
  });

  gridE.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDragging = true;
    lastErasedCell = null;
    const touch = e.touches[0];
    const cell = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.cell');
    if (cell){
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      onEditorCellClick(x, y);
      lastErasedCell = `${x},${y}`;
    }
  }, { passive: false });

  gridE.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    const cell = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.cell');
    if (cell){
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      const cellKey = `${x},${y}`;
      if (lastErasedCell !== cellKey){
        onEditorCellClick(x, y);
        lastErasedCell = cellKey;
      }
    }
  }, { passive: false });

  gridE.addEventListener('touchend', () => {
    isDragging = false;
    lastErasedCell = null;
  });
}

$('#sizeUp').addEventListener('click', () => setDraftSize(draft.size + 1));
$('#sizeDown').addEventListener('click', () => setDraftSize(draft.size - 1));

function setDraftSize(n){
  n = Math.max(5, Math.min(14, n));
  draft.size = n;
  draft.walls = draft.walls.filter(w => w[0]<n && w[1]<n);
  draft.elements = draft.elements.filter(e => e.x<n && e.y<n);
  draft.sources = draft.sources.filter(s => s.x<n && s.y<n);
  draft.goals = draft.goals.filter(g => g.x<n && g.y<n);
  sizeVal.textContent = n + ' × ' + n;
  renderEditor();
}

function clearCellInDraft(x,y){
  draft.walls = draft.walls.filter(w => !(w[0]===x && w[1]===y));
  draft.elements = draft.elements.filter(e => !(e.x===x && e.y===y));
  draft.sources = draft.sources.filter(s => !(s.x===x && s.y===y));
  draft.goals = draft.goals.filter(g => !(g.x===x && g.y===y));
}

function onEditorCellClick(x,y){
  const elHere = draft.elements.find(e=>e.x===x&&e.y===y);

  if (currentTool==='erase'){ clearCellInDraft(x,y); renderEditor(); return; }

  if (currentTool==='wall'){ clearCellInDraft(x,y); draft.walls.push([x,y]); renderEditor(); return; }

  if (currentTool==='mirror'){
    if (elHere && elHere.kind==='mirror'){
      elHere.rotatable = mirrorRotatable;
      elHere.doubleSided = mirrorDoubleSided;
      elHere.filterColor = mirrorFilterEnabled ? mirrorFilterColor : null;
      if (mirrorRotatable){
        const cur = normalizeMirrorAngle(elHere.orient);
        const idx = MIRROR_ROTATION_STEPS.indexOf(cur);
        elHere.orient = MIRROR_ROTATION_STEPS[(idx + 1) % MIRROR_ROTATION_STEPS.length];
      }
    } else {
      clearCellInDraft(x,y);
      draft.elements.push({
        id:nextId(),
        kind:'mirror',
        x, y,
        orient: 45,
        rotatable: mirrorRotatable,
        doubleSided: mirrorDoubleSided,
        filterColor: mirrorFilterEnabled ? mirrorFilterColor : null
      });
    }
    renderEditor(); return;
  }

  if (currentTool==='converter'){
    if (elHere && elHere.kind==='converter'){
      elHere.color = currentColor;
      elHere.interactive = converterInteractive;
      elHere.type = converterType;
    } else {
      clearCellInDraft(x,y);
      draft.elements.push({
        id:nextId(),
        kind:'converter',
        x, y,
        color:currentColor,
        interactive: converterInteractive,
        type: converterType,
        enabled: true
      });
    }
    renderEditor(); return;
  }


  if (currentTool==='source'){
    const srcHere = draft.sources.find(s=>s.x===x&&s.y===y);
    if (srcHere){
      srcHere.color = currentColor;
      srcHere.rotatable = sourceRotatable;
      if (sourceRotatable){
        const nextDir = { right:'down', down:'left', left:'up', up:'right' };
        srcHere.dir = nextDir[srcHere.dir] || 'right';
      }
    } else {
      clearCellInDraft(x,y);
      draft.sources.push({
        id:nextId(),
        x,
        y,
        dir:currentDir,
        color:currentColor,
        rotatable: sourceRotatable
      });
    }
    renderEditor(); return;
  }

  if (currentTool==='goal'){
    clearCellInDraft(x,y);
    draft.goals.push({id:nextId(), x, y, color:currentColor});
    renderEditor(); return;
  }
}

function renderElementVisual(cell, kind, opts){
  if (kind==='mirror'){
    const lineAngle = normalizeMirrorAngle(opts.orient);
    cell.classList.add('mirror-cell', opts.rotatable ? 'movable' : 'fixed', opts.doubleSided === false ? 'single-sided' : 'double-sided');
    const wrap = el('mirror-wrap');
    const line = el('mirror-line');
    line.dataset.deg = lineAngle;
    if (opts.filterColor){
      const hex = COLOR_HEX[opts.filterColor];
      const tint = el('half-tint'); tint.style.background = hex; wrap.appendChild(tint);
      line.style.background = `linear-gradient(90deg, #ffffff, ${hex})`;
      line.style.boxShadow = `0 0 10px ${hex}`;
    } else {
      line.style.background = opts.doubleSided === false
        ? 'linear-gradient(90deg, #ffe4bd, var(--brass))'
        : 'linear-gradient(90deg, #eafcff, var(--cyan))';
      line.style.boxShadow = opts.doubleSided === false
        ? '0 0 8px rgba(201,149,92,0.5)'
        : '0 0 10px var(--cyan-soft), 0 0 2px #fff';
    }

    line.style.transform = `rotate(${lineAngle}deg)`;
    wrap.appendChild(line);
    const frontAngle = lineAngle + 90;
    const backAngle = frontAngle + 180;
    const front = el('mirror-side front');
    front.style.setProperty('--marker-angle', `${frontAngle}deg`);
    wrap.appendChild(front);
    const back = el('mirror-side back');
    back.style.setProperty('--marker-angle', `${backAngle}deg`);
    wrap.appendChild(back);
    if (opts.rotatable){ wrap.appendChild(el('mirror-ring')); }
    else {
      const badge = el('lock-badge'); badge.textContent='🔒'; wrap.appendChild(badge);
      wrap.appendChild(el('rivet tl')); wrap.appendChild(el('rivet br'));
    }
    cell.appendChild(wrap);
    return line;
  }
  if (kind==='converter'){
    cell.classList.add('converter-cell');
    if (opts.interactive) {
      cell.classList.add('interactive');
    }
    const hex = COLOR_HEX[opts.color];
    const panel = el('converter-panel');
    panel.style.background = `linear-gradient(135deg, #3a4152 30%, ${hex})`;
    
    let symbol = '⇄';
    if (opts.type === 'add') symbol = '＋';
    else if (opts.type === 'remove') symbol = '−';
    panel.textContent = symbol;

    if (opts.enabled === false) {
      panel.classList.add('disabled');
    }
    cell.appendChild(panel);

    if (opts.interactive) {
      const ring = el('converter-ring');
      cell.appendChild(ring);
      const badge = el('converter-badge');
      badge.textContent = opts.enabled === false ? 'OFF' : 'ON';
      cell.appendChild(badge);
    }
    return panel;
  }
}

function renderSourceVisual(cell, s){
  cell.classList.add('source', s.rotatable ? 'movable' : 'fixed');
  const hex = COLOR_HEX[s.color];
  const contrastHex = hex === '#ffffff' ? '#111827' : hex;
  const emitter = el('emitter');
  emitter.style.background = `radial-gradient(circle, #fff, ${hex})`;
  emitter.style.boxShadow = `0 0 12px ${hex}`;
  cell.appendChild(emitter);
  const arrow = el('emitter-arrow');
  const angle = DIR_ANGLE[s.dir];
  arrow.style.borderWidth = `8px 0 8px 11px`;
  arrow.style.borderColor = `transparent transparent transparent ${contrastHex}`;
  arrow.style.left='50%'; arrow.style.top='50%';
  arrow.style.transform = `translate(-30%,-50%) rotate(${angle}deg)`;
  arrow.style.transformOrigin = '20% 50%';
  arrow.style.filter = hex === '#ffffff'
    ? 'drop-shadow(0 0 2px rgba(255,255,255,0.95)) drop-shadow(0 0 4px rgba(0,0,0,0.85))'
    : 'drop-shadow(0 0 2px rgba(0,0,0,0.45))';
  arrow.dataset.deg = angle;
  cell.appendChild(arrow);

  if (s.rotatable) {
    cell.appendChild(el('source-ring'));
  } else {
    const badge = el('lock-badge'); badge.textContent='🔒'; cell.appendChild(badge);
    cell.appendChild(el('rivet tl')); cell.appendChild(el('rivet br'));
  }
  return arrow;
}

function renderGoalVisual(cell, g, satisfied){
  cell.classList.add('goal');
  if (satisfied) cell.classList.add('hit');
  const hex = COLOR_HEX[g.color];
  const target = el('target');
  target.style.borderColor = hex;
  target.style.boxShadow = `0 0 ${satisfied?18:10}px ${hex}`;
  cell.appendChild(target);
  const dotWrap = document.createElement('style');
  target.style.setProperty('--dot', hex);
  const dot = document.createElement('div');
  dot.style.position='absolute'; dot.style.inset='28%'; dot.style.borderRadius='50%'; dot.style.background=hex;
  target.appendChild(dot);
}

function buildCellVisual(cell, x, y){
  if (draft.walls.some(w=>w[0]===x&&w[1]===y)){ cell.classList.add('wall'); return; }
  const m = draft.elements.find(e=>e.x===x&&e.y===y);
  if (m) renderElementVisual(cell, m.kind, m);
  const s = draft.sources.find(ss=>ss.x===x&&ss.y===y);
  if (s) renderSourceVisual(cell, s);
  const g = draft.goals.find(gg=>gg.x===x&&gg.y===y);
  if (g) renderGoalVisual(cell, g, false);
}

function renderEditor(){
  const size = draft.size;
  const wrapWidth = Math.min(560, (document.querySelector('.board-wrap').clientWidth - 40) || 480);
  const cellPx = Math.max(26, Math.min(68, Math.floor(wrapWidth / size)));
  const total = cellPx * size;

  gridE.style.gridTemplateColumns = `repeat(${size}, ${cellPx}px)`;
  gridE.style.gridTemplateRows = `repeat(${size}, ${cellPx}px)`;
  gridE.style.width = total+'px'; gridE.style.height = total+'px';
  boardE.style.width = total+'px'; boardE.style.height = total+'px';

  rulerTopE.innerHTML=''; rulerLeftE.innerHTML='';
  rulerTopE.style.width = total+'px'; rulerLeftE.style.height = total+'px';
  for (let i=0;i<size;i++){
    const t=document.createElement('span'); t.textContent = i%2===0?i:''; rulerTopE.appendChild(t);
    const l=document.createElement('span'); l.textContent = i%2===0?i:''; rulerLeftE.appendChild(l);
  }

  gridE.innerHTML = '';
  for (let yy=0; yy<size; yy++){
    for (let xx=0; xx<size; xx++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = xx;
      cell.dataset.y = yy;
      buildCellVisual(cell, xx, yy);
      cell.addEventListener('click', () => onEditorCellClick(xx,yy));
      gridE.appendChild(cell);
    }
  }

  setupDragPlacement();

  const nS = draft.sources.length, nG = draft.goals.length;
  if (nS===0 && nG===0) editorMsg.textContent = '光源とゴールを配置しよう';
  else if (nS===0) editorMsg.textContent = '光源がまだない';
  else if (nG===0) editorMsg.textContent = 'ゴールがまだない';
  else editorMsg.textContent = `光源${nS}・ゴール${nG}。準備完了、テストプレイで確認しよう`;
}

$('#editClearBtn').addEventListener('click', () => {
  draft.walls=[]; draft.elements=[]; draft.sources=[]; draft.goals=[];
  renderEditor();
});

function draftToLevel(){
  return {
    size: draft.size,
    walls: draft.walls.map(w=>w.slice()),
    elements: draft.elements.map(e=>Object.assign({}, e)),
    sources: draft.sources.map(s=>Object.assign({}, s)),
    goals: draft.goals.map(g=>Object.assign({}, g)),
  };
}

function validateDraft(){
  if (draft.sources.length===0 || draft.goals.length===0){
    toast('光源とゴールを1つ以上配置してね');
    return false;
  }
  return true;
}

$('#testPlayBtn').addEventListener('click', () => {
  if (!validateDraft()) return;
  const level = draftToLevel();
  const nameField = $('#nameInput').value.trim();
  showTab('play');
  loadLevel(level, nameField || 'テストプレイ', null, true);
});

$('#exportOfficialBtn').addEventListener('click', async () => {
  if (!validateDraft()) return;
  const name = $('#nameInput').value.trim() || '無題のステージ';
  const title = name;
  const description = $('#officialDesc').value.trim();
  const difficulty = parseInt($('#officialDifficulty').value, 10) || 1;
  const tags = parseTagsInput($('#officialTags').value);
  const level = draftToLevel();
  try {
    const pkg = await exportOfficialStageFile({ title, description, difficulty, tags, name, level });
    toast('「' + pkg.title + '」を書き出しました（' + pkg.id + '）');
  } catch (e) {
    toast('書き出しに失敗しました');
  }
});

function applyStagePayload(payload){
  if (!payload || !payload.level || !payload.level.sources || !payload.level.goals) throw new Error('invalid');
  migrateLegacyData(payload.level);
  draft = {
    size: payload.level.size,
    walls: payload.level.walls.map(w=>w.slice()),
    elements: payload.level.elements.map(e=>Object.assign({}, e)),
    sources: payload.level.sources.map(s=>Object.assign({}, s)),
    goals: payload.level.goals.map(g=>Object.assign({}, g)),
  };
  const name = payload.name || payload.title || '';
  $('#nameInput').value = name;
  if (payload.description !== undefined) $('#officialDesc').value = payload.description || '';
  if (payload.difficulty !== undefined) $('#officialDifficulty').value = String(payload.difficulty || 1);
  if (payload.tags !== undefined) {
    const tags = Array.isArray(payload.tags) ? payload.tags : parseTagsInput(payload.tags);
    $('#officialTags').value = tags.join(', ');
  }
  sizeVal.textContent = draft.size + ' × ' + draft.size;
  renderEditor();
  toast('「' + (name || 'ステージ') + '」を読み込みました');
}

$('#importFileBtn').addEventListener('click', () => $('#importFileInput').click());
$('#importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    applyStagePayload(JSON.parse(text));
  } catch (err) {
    toast('JSONを読み込めませんでした');
  }
  e.target.value = '';
});

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
    if (e.kind==='converter'){
      return {
        type: 'replace',
        interactive: true,
        ...e
      };
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
