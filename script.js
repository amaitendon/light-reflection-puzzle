(function(){
  "use strict";

  /* ================= color system ================= */
  // bitmask: R=1, G=2, B=4
  const COLORS = [
    {bits:1, name:'赤', hex:'#ff5a5a'},
    {bits:2, name:'緑', hex:'#5affa0'},
    {bits:4, name:'青', hex:'#5aa8ff'},
    {bits:3, name:'黄', hex:'#ffe75a'},
    {bits:5, name:'紫', hex:'#ff5ae0'},
    {bits:6, name:'水', hex:'#5afff0'},
    {bits:7, name:'白', hex:'#f5f7fa'},
  ];
  const COLOR_HEX = {};
  COLORS.forEach(c => COLOR_HEX[c.bits] = c.hex);

  /* ================= beam engine ================= */
  const DIRS = { right:[1,0], left:[-1,0], down:[0,1], up:[0,-1] };
  const DIR_ANGLE = { right:0, down:90, left:180, up:270 };

  function reflect(dx, dy, orient){ return orient==='/' ? [-dy,-dx] : [dy,dx]; }
  function rotateCCW(dx,dy){ return [dy,-dx]; }
  function rotateCW(dx,dy){ return [-dy,dx]; }

  function traceAll(level, mirrorStates){
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
          const orient = el.type==='M' ? mirrorStates[el.id] : el.orient;
          [dx,dy] = reflect(dx,dy,orient);
          continue;
        }
        if (el.kind==='filter'){
          const nc = color & el.color;
          if (nc===0){ segments.push({pts,color,terminal:'ABSORB'}); return; }
          color = nc;
          continue;
        }
        if (el.kind==='converter'){ color = el.color; continue; }
        if (el.kind==='halfmirror'){
          const orient = mirrorStates[el.id];
          const reflectColor = color & el.color;
          const transmitColor = color & (~el.color) & 7;
          segments.push({pts,color,terminal:'SPLIT'});
          if (reflectColor){ const [rdx,rdy]=reflect(dx,dy,orient); walk(cx,cy,rdx,rdy,reflectColor); }
          if (transmitColor){ walk(cx,cy,dx,dy,transmitColor); }
          return;
        }
        if (el.kind==='prism'){
          segments.push({pts,color,terminal:'SPLIT'});
          const blue = color & 4, red = color & 1, green = color & 2;
          if (blue) walk(cx,cy,dx,dy,blue);
          const [lx,ly] = rotateCCW(dx,dy);
          if (red) walk(cx,cy,lx,ly,red);
          const [rx,ry] = rotateCW(dx,dy);
          if (green) walk(cx,cy,rx,ry,green);
          return;
        }
      }
    }

    level.sources.forEach(s => walk(s.x, s.y, DIRS[s.dir][0], DIRS[s.dir][1], s.color));
    const goalStates = level.goals.map(g => ({ g, got: goalHits[g.x+','+g.y]||0, ok: (goalHits[g.x+','+g.y]||0)===g.color }));
    const allGoalsMet = goalStates.length>0 && goalStates.every(s=>s.ok);
    return { goalHits, segments, allGoalsMet, goalStates };
  }

  function $(sel){ return document.querySelector(sel); }
  function el(cls){ const d=document.createElement('div'); d.className=cls; return d; }

  function toast(msg){
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ================= storage ================= */
  let customLevels = [];
  const memoryStore = {};
  async function storageGet(key){
    try{ if (window.storage && window.storage.get){ const r = await window.storage.get(key, false); return r ? r.value : null; } }
    catch(e){}
    return memoryStore[key] || null;
  }
  async function storageSet(key, value){
    try{ if (window.storage && window.storage.set){ await window.storage.set(key, value, false); return; } }
    catch(e){}
    memoryStore[key] = value;
  }
  async function loadCustomLevels(){
    const raw = await storageGet('custom-levels');
    try{ customLevels = raw ? JSON.parse(raw) : []; } catch(e){ customLevels = []; }
  }
  async function persistCustomLevels(){ await storageSet('custom-levels', JSON.stringify(customLevels)); }

  /* ================= tabs ================= */
  const tabEditorBtn = $('#tabEditorBtn');
  const tabPlayBtn = $('#tabPlayBtn');
  const panelEditor = $('#panelEditor');
  const panelPlay = $('#panelPlay');

  function showTab(which){
    tabEditorBtn.classList.toggle('active', which==='editor');
    tabPlayBtn.classList.toggle('active', which==='play');
    panelEditor.classList.toggle('active', which==='editor');
    panelPlay.classList.toggle('active', which==='play');
    if (which==='play') showPlayList();
  }
  tabEditorBtn.addEventListener('click', () => showTab('editor'));
  tabPlayBtn.addEventListener('click', () => showTab('play'));

  /* ================================================================
     EDITOR
     ================================================================ */
  let draft = { size:8, walls:[], elements:[], sources:[], goals:[] };
  let seq = 0;
  function nextId(){ return 'e'+(seq++); }

  let currentTool = 'wall';
  let currentDir = 'right';
  let currentColor = 7;

  const gridE = $('#gridE');
  const boardE = $('#boardE');
  const rulerTopE = $('#rulerTopE');
  const rulerLeftE = $('#rulerLeftE');
  const sizeVal = $('#sizeVal');
  const editorMsg = $('#editorMsg');
  const dirRow = $('#dirRow');
  const colorRow = $('#colorRow');
  const colorPicker = $('#colorPicker');

  const NEEDS_COLOR = new Set(['source','goal','filter','converter','halfmirror']);

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

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTool = btn.dataset.tool;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b===btn));
      dirRow.style.display = currentTool==='source' ? 'flex' : 'none';
      colorRow.style.display = NEEDS_COLOR.has(currentTool) ? 'flex' : 'none';
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

    if (currentTool==='mirrorM' || currentTool==='mirrorF'){
      const wantType = currentTool==='mirrorM' ? 'M' : 'F';
      if (elHere && elHere.kind==='mirror' && elHere.type===wantType){
        elHere.orient = elHere.orient==='/' ? '\\' : '/';
      } else {
        clearCellInDraft(x,y);
        draft.elements.push({id:nextId(), kind:'mirror', type:wantType, x, y, orient:'/'});
      }
      renderEditor(); return;
    }

    if (currentTool==='halfmirror'){
      if (elHere && elHere.kind==='halfmirror'){
        if (elHere.color !== currentColor) elHere.color = currentColor;
        else elHere.orient = elHere.orient==='/' ? '\\' : '/';
      } else {
        clearCellInDraft(x,y);
        draft.elements.push({id:nextId(), kind:'halfmirror', x, y, orient:'/', color:currentColor});
      }
      renderEditor(); return;
    }

    if (currentTool==='filter' || currentTool==='converter'){
      if (elHere && elHere.kind===currentTool){
        elHere.color = currentColor;
      } else {
        clearCellInDraft(x,y);
        draft.elements.push({id:nextId(), kind:currentTool, x, y, color:currentColor});
      }
      renderEditor(); return;
    }

    if (currentTool==='prism'){
      if (!(elHere && elHere.kind==='prism')){
        clearCellInDraft(x,y);
        draft.elements.push({id:nextId(), kind:'prism', x, y});
      }
      renderEditor(); return;
    }

    if (currentTool==='source'){
      clearCellInDraft(x,y);
      draft.sources.push({id:nextId(), x, y, dir:currentDir, color:currentColor});
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
      cell.classList.add('mirror-cell', opts.type==='M' ? 'movable' : 'fixed');
      const wrap = el('mirror-wrap');
      const line = el('mirror-line');
      const deg = opts.orient==='/' ? -45 : 45;
      line.style.transform = `rotate(${deg}deg)`;
      line.dataset.deg = deg;
      wrap.appendChild(line);
      if (opts.type==='M'){ wrap.appendChild(el('mirror-ring')); }
      else {
        const badge = el('lock-badge'); badge.textContent='🔒'; wrap.appendChild(badge);
        wrap.appendChild(el('rivet tl')); wrap.appendChild(el('rivet br'));
      }
      cell.appendChild(wrap);
      return line;
    }
    if (kind==='halfmirror'){
      cell.classList.add('movable');
      const hex = COLOR_HEX[opts.color];
      const wrap = el('mirror-wrap');
      const tint = el('half-tint'); tint.style.background = hex; wrap.appendChild(tint);
      const line = el('mirror-line');
      line.style.background = `linear-gradient(90deg, #ffffff, ${hex})`;
      line.style.boxShadow = `0 0 10px ${hex}`;
      const deg = opts.orient==='/' ? -45 : 45;
      line.style.transform = `rotate(${deg}deg)`;
      line.dataset.deg = deg;
      wrap.appendChild(line);
      wrap.appendChild(el('mirror-ring'));
      cell.appendChild(wrap);
      return line;
    }
    if (kind==='filter'){
      const hex = COLOR_HEX[opts.color];
      const panel = el('filter-panel');
      panel.style.background = hex + 'aa';
      panel.style.color = '#0a0e16';
      panel.textContent = 'F';
      cell.appendChild(panel);
      return null;
    }
    if (kind==='converter'){
      const hex = COLOR_HEX[opts.color];
      const panel = el('converter-panel');
      panel.style.background = `linear-gradient(135deg, #3a4152 30%, ${hex})`;
      panel.textContent = '⇄';
      cell.appendChild(panel);
      return null;
    }
    if (kind==='prism'){
      cell.appendChild(el('prism-shape'));
      return null;
    }
  }

  function renderSourceVisual(cell, s){
    cell.classList.add('source');
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
    cell.appendChild(arrow);
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
        buildCellVisual(cell, xx, yy);
        cell.addEventListener('click', () => onEditorCellClick(xx,yy));
        gridE.appendChild(cell);
      }
    }

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
    return payload;
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
        draft = {
          size: entry.level.size,
          walls: entry.level.walls.map(w=>w.slice()),
          elements: entry.level.elements.map(e=>Object.assign({}, e)),
          sources: entry.level.sources.map(s=>Object.assign({}, s)),
          goals: entry.level.goals.map(g=>Object.assign({}, g)),
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

  function loadLevel(level, name, savedId, isTest){
    currentLevel = level;
    currentMeta = { name, savedId, isTest };
    mirrorStates = {};
    level.elements.forEach(e => {
      if ((e.kind==='mirror' && e.type==='M') || e.kind==='halfmirror') mirrorStates[e.id] = e.orient;
    });
    playTitle.textContent = (isTest ? '🧪 テスト：' : '') + name;
    buildPlayBoard(level);
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
      const orient = e.kind==='mirror' ? (e.type==='M'?mirrorStates[e.id]:e.orient) : (e.kind==='halfmirror'?mirrorStates[e.id]:undefined);
      const opts = Object.assign({}, e, orient!==undefined?{orient}:{});
      const line = renderElementVisual(cell, e.kind, opts);
      if (line && ((e.kind==='mirror'&&e.type==='M') || e.kind==='halfmirror')){
        cell.addEventListener('click', () => rotateMirror(e.id, line));
      }
    });

    level.sources.forEach(s => renderSourceVisual(cellMapP[s.x+','+s.y], s));
    level.goals.forEach(g => renderGoalVisual(cellMapP[g.x+','+g.y], g, false));
  }

  function rotateMirror(id, lineEl){
    const cur = parseFloat(lineEl.dataset.deg);
    const next = cur + 90;
    lineEl.style.transform = `rotate(${next}deg)`;
    lineEl.dataset.deg = next;
    mirrorStates[id] = (mirrorStates[id]==='/') ? '\\' : '/';
    recompute();
  }

  function cellCenter(x,y){ return [ x*cellPxP + cellPxP/2, y*cellPxP + cellPxP/2 ]; }

  function recompute(){
    const level = currentLevel;
    const { segments, allGoalsMet, goalStates } = traceAll(level, mirrorStates);

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

  window.addEventListener('resize', () => {
    if (panelEditor.classList.contains('active')) renderEditor();
    if (panelPlay.classList.contains('active') && playBoardView.style.display!=='none' && currentLevel){
      buildPlayBoard(currentLevel);
      recompute();
    }
  });

  /* ================= init ================= */
  (async function init(){
    await loadCustomLevels();
    renderEditor();
    renderStageList();
    showTab('editor');
  })();
})();
