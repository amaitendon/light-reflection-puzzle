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
let mirrorFilterEnabled = false;
let mirrorFilterColor = 7;
let sourceRotatable = true;

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
const mirrorFilterEnabledCheck = $('#mirrorFilterEnabled');
const mirrorFilterColorPicker = $('#mirrorFilterColorPicker');

let converterInteractive = true;
let converterType = 'replace';
const converterSettingsRow = $('#converterSettingsRow');
const converterInteractiveCheck = $('#converterInteractive');

converterInteractiveCheck.addEventListener('change', () => {
  converterInteractive = converterInteractiveCheck.checked;
});
document.querySelectorAll('input[name="converterType"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      converterType = radio.value;
    }
  });
});

const sourceSettingsRow = $('#sourceSettingsRow');
const sourceRotatableCheck = $('#sourceRotatable');

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
      elHere.filterColor = mirrorFilterEnabled ? mirrorFilterColor : null;
      if (mirrorRotatable){
        const STEPS = [0, 45, 90, 135];
        // orientが文字列なら数値に正規化
        let cur = elHere.orient;
        if (cur === '/') cur = 135;
        else if (cur === '\\') cur = 45;
        else if (typeof cur !== 'number') cur = 45;
        const idx = STEPS.indexOf(cur);
        elHere.orient = STEPS[(idx + 1) % 4];
      }
    } else {
      clearCellInDraft(x,y);
      draft.elements.push({
        id:nextId(),
        kind:'mirror',
        x, y,
        orient: 45,
        rotatable: mirrorRotatable,
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
    cell.classList.add('mirror-cell', opts.rotatable ? 'movable' : 'fixed');
    const wrap = el('mirror-wrap');
    const line = el('mirror-line');
    // orientを数値に正規化
    let orient = opts.orient;
    if (orient === '/') orient = 135;
    else if (orient === '\\') orient = 45;
    else if (typeof orient !== 'number') orient = 45;
    const deg = orient; // 0/45/90/135
    
    if (opts.filterColor){
      const hex = COLOR_HEX[opts.filterColor];
      const tint = el('half-tint'); tint.style.background = hex; wrap.appendChild(tint);
      line.style.background = `linear-gradient(90deg, #ffffff, ${hex})`;
      line.style.boxShadow = `0 0 10px ${hex}`;
    } else {
      line.style.background = opts.rotatable ? 'linear-gradient(90deg, #eafcff, var(--cyan))' : 'linear-gradient(90deg, #ffe4bd, var(--brass))';
      line.style.boxShadow = opts.rotatable ? '0 0 10px var(--cyan-soft), 0 0 2px #fff' : '0 0 8px rgba(201,149,92,0.5)';
    }
    
    line.style.transform = `rotate(${deg}deg)`;
    line.dataset.deg = deg;
    wrap.appendChild(line);
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
  const emitter = el('emitter');
  emitter.style.background = `radial-gradient(circle, #fff, ${hex})`;
  emitter.style.boxShadow = `0 0 12px ${hex}`;
  cell.appendChild(emitter);
  const arrow = el('emitter-arrow');
  const angle = DIR_ANGLE[s.dir];
  arrow.style.borderWidth = `8px 0 8px 11px`;
  arrow.style.borderColor = `transparent transparent transparent ${hex}`;
  arrow.style.left='50%'; arrow.style.top='50%';
  arrow.style.transform = `translate(-30%,-50%) rotate(${angle}deg)`;
  arrow.style.transformOrigin = '20% 50%';
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

$('#saveBtn').addEventListener('click', async () => {
  if (!validateDraft()) return;
  const name = $('#nameInput').value.trim() || ('ステージ ' + (customLevels.length+1));
  const level = draftToLevel();
  const entry = { id:'u'+Date.now(), name, level };
  customLevels.push(entry);
  await persistCustomLevels();
  toast('「' + name + '」を保存しました');
  renderStageList();
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

$('#exportBtn').addEventListener('click', () => {
  if (!validateDraft()) return;
  const level = draftToLevel();
  const name = $('#nameInput').value.trim() || '無題のステージ';
  let code = '';
  try{ code = btoa(unescape(encodeURIComponent(JSON.stringify({name, level})))); }
  catch(e){ toast('書き出しに失敗しました'); return; }
  const box = $('#exportBox');
  box.style.display = 'block';
  box.value = code;
  box.focus(); box.select();
  try{ document.execCommand('copy'); toast('コードをコピーしました'); }
  catch(e){ toast('コードを選択してコピーしてね'); }
});

function decodeCode(code){
  const json = decodeURIComponent(escape(atob(code.trim())));
  const payload = JSON.parse(json);
  if (!payload || !payload.level || !payload.level.sources || !payload.level.goals) throw new Error('invalid');
  migrateLegacyData(payload.level);
  return payload;
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

$('#importBtn').addEventListener('click', () => {
  const code = $('#importInput').value;
  if (!code.trim()){ toast('コードを貼り付けてね'); return; }
  try{
    const payload = decodeCode(code);
    draft = {
      size: payload.level.size,
      walls: payload.level.walls.map(w=>w.slice()),
      elements: payload.level.elements.map(e=>Object.assign({}, e)),
      sources: payload.level.sources.map(s=>Object.assign({}, s)),
      goals: payload.level.goals.map(g=>Object.assign({}, g)),
    };
    $('#nameInput').value = payload.name || '';
    sizeVal.textContent = draft.size + ' × ' + draft.size;
    renderEditor();
    toast('「' + (payload.name||'ステージ') + '」を読み込みました');
  }catch(e){
    toast('コードを読み込めませんでした');
  }
});
