/* ================================================================
   EDITOR
   ================================================================ */
let draft = { size:8, walls:[], elements:[], sources:[], goals:[] };
let seq = 0;
function nextId(){ return 'e'+(seq++); }

// 外部から読み込んだステージ（インポート等）が持つ既存IDと、
// これから nextId() で発行するIDが衝突しないよう、seq を安全な値まで進める。
// これを怠ると、読み込み後にコピー＆ペーストした要素が既存要素と同じIDを持ってしまい、
// プレイ中に片方のミラーを回転させるともう片方も連動して回転する、というバグが発生する。
function syncSeqWithDraft(d){
  let maxNum = -1;
  const scan = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      const m = /^e(\d+)$/.exec(item && item.id);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
  };
  scan(d.elements);
  scan(d.sources);
  scan(d.goals);
  if (maxNum + 1 > seq) seq = maxNum + 1;
}

let currentTool = 'wall';
let currentDir = 'right';
let currentColor = 7;
let mirrorOrient = 45;
let mirrorRotatable = true;
let mirrorDoubleSided = true;
let mirrorFilterColor = 7;
let mirrorAngleOnlyMode = false;
let sourceRotatable = false;
// デフォルトで有効：配置済みの光源をクリックした際、色や回転可否は維持したまま
// 向き（上下左右）だけを順番に切り替える編集モード。
let sourceDirCycleMode = true;
let recolorColor = 7;

let isDragging = false;
let lastErasedCell = null;
const MIN_BOARD_SIZE = 3;
const MAX_BOARD_SIZE = 14;

// ---- 表示サイズ（セルのピクセルサイズの倍率）----
// 盤のマス数(MIN/MAX_BOARD_SIZE)とは別に、見た目のセルサイズをユーザーが調整できるようにする。
const EDITOR_ZOOM_MIN = 0.5;
const EDITOR_ZOOM_MAX = 2.0;
const EDITOR_ZOOM_STEP = 0.1;
let editorZoom = parseFloat(localStorage.getItem('lightPuzzle.editorZoom'));
if (!isFinite(editorZoom)) editorZoom = 1;
editorZoom = Math.max(EDITOR_ZOOM_MIN, Math.min(EDITOR_ZOOM_MAX, editorZoom));

// ---- 範囲選択 / コピー・切り取り・貼り付け ----
let isSelecting = false;
let selectAnchor = null;         // {x,y} ドラッグ開始セル
let selection = null;            // {x0,y0,x1,y1} 選択範囲（盤面座標・両端含む）
let clipboard = null;            // {w,h,walls,elements,sources,goals} コピー内容（相対座標dx,dy）
let clipboardOrigin = null;      // {x0,y0} コピー/切り取り元の左上座標（Ctrl+Vで即貼り付けする際の基準位置）
let pasteMode = false;           // true の間、次にクリックしたセルへ貼り付ける

// ---- 元に戻す / やり直す（Undo / Redo）----
let historyStack = [];           // draft のスナップショット（変更前の状態）を積む
let redoStack = [];              // undo した内容を積む
const MAX_HISTORY = 100;

function snapshotDraftJSON(){ return JSON.stringify(draft); }

// mutateFn 実行前後で draft を比較し、変化があった場合だけ履歴に積む。
// （同じクリックで複数回呼ばれても実質変化がなければ履歴が増えないようにするため）
function withHistory(mutateFn){
  const before = snapshotDraftJSON();
  mutateFn();
  const after = snapshotDraftJSON();
  if (before !== after){
    historyStack.push(before);
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }
}

function resetHistory(){
  historyStack = [];
  redoStack = [];
  updateUndoRedoButtons();
}

function undo(){
  if (historyStack.length === 0){ toast('これ以上元に戻せません'); return; }
  redoStack.push(snapshotDraftJSON());
  draft = JSON.parse(historyStack.pop());
  selection = null;
  pasteMode = false;
  updateSelectionUI();
  sizeVal.textContent = draft.size + ' × ' + draft.size;
  renderEditor();
  updateUndoRedoButtons();
}

function redo(){
  if (redoStack.length === 0){ toast('やり直せる操作がありません'); return; }
  historyStack.push(snapshotDraftJSON());
  draft = JSON.parse(redoStack.pop());
  selection = null;
  pasteMode = false;
  updateSelectionUI();
  sizeVal.textContent = draft.size + ' × ' + draft.size;
  renderEditor();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons(){
  const undoBtn = $('#editUndoBtn');
  const redoBtn = $('#editRedoBtn');
  if (undoBtn) undoBtn.disabled = historyStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

const selectionRow = $('#selectionRow');
const selCopyBtn = $('#selCopyBtn');
const selCutBtn = $('#selCutBtn');
const selPasteBtn = $('#selPasteBtn');
const selClearBtn = $('#selClearBtn');
const selHint = $('#selHint');

const gridE = $('#gridE');
const boardE = $('#boardE');
const rulerTopE = $('#rulerTopE');
const rulerLeftE = $('#rulerLeftE');
const sizeVal = $('#sizeVal');
const colorRow = $('#colorRow');
const colorPicker = $('#colorPicker');
const mirrorSettingsRow = $('#mirrorSettingsRow');
const mirrorOrientPicker = $('#mirrorOrientPicker');
const mirrorRotatableCheck = $('#mirrorRotatable');
const mirrorDoubleSidedCheck = $('#mirrorDoubleSided');
const mirrorFilterColorPicker = $('#mirrorFilterColorPicker');
const mirrorAngleOnlyModeCheck = $('#mirrorAngleOnlyMode');

const recolorSettingsRow = $('#recolorSettingsRow');
const recolorColorPicker = $('#recolorColorPicker');

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
const sourceColorPicker = $('#sourceColorPicker');
const sourceRotatableCheck = $('#sourceRotatable');
const sourceDirCycleModeCheck = $('#sourceDirCycleMode');

sourceRotatableCheck.checked = sourceRotatable;
sourceRotatableCheck.addEventListener('change', () => {
  sourceRotatable = sourceRotatableCheck.checked;
});

sourceDirCycleModeCheck.checked = sourceDirCycleMode;
sourceDirCycleModeCheck.addEventListener('change', () => {
  sourceDirCycleMode = sourceDirCycleModeCheck.checked;
});


// 通常カラーピッカーとミラーフィルターカラーピッカーは、生成処理を共通化する。
// 光源・色変換パネル・ミラーの色フィルターは「今選んでいる色」を1つの状態として共有し、
// どのパネルに切り替えても直前に選んだ色がそのまま引き継がれるようにする。
function buildColorSwatchPicker(container, onSelect){
  COLORS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'color-swatch-btn';
    b.style.background = c.hex;
    b.title = c.name;
    b.dataset.bits = c.bits;
    b.addEventListener('click', () => { onSelect(c.bits); });
    container.appendChild(b);
  });
}

function setActiveSwatch(container, bits){
  container.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.bits, 10) === bits);
  });
}

// 光源色・パネル色・ミラーフィルター色・色編集ツールの色をまとめて更新し、各カラーピッカーの見た目も同期する。
function setSharedColor(bits){
  currentColor = bits;
  mirrorFilterColor = bits;
  recolorColor = bits;
  setActiveSwatch(colorPicker, bits);
  setActiveSwatch(mirrorFilterColorPicker, bits);
  setActiveSwatch(sourceColorPicker, bits);
  setActiveSwatch(recolorColorPicker, bits);
}

buildColorSwatchPicker(colorPicker, bits => { setSharedColor(bits); });
buildColorSwatchPicker(mirrorFilterColorPicker, bits => { setSharedColor(bits); });
buildColorSwatchPicker(sourceColorPicker, bits => { setSharedColor(bits); });
buildColorSwatchPicker(recolorColorPicker, bits => { setSharedColor(bits); });
setSharedColor(currentColor); // 初期値（白）を各ピッカーに反映

function setMirrorOrientActive(angle){
  document.querySelectorAll('#mirrorOrientPicker button').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.orient, 10) === angle);
  });
}

MIRROR_ROTATION_STEPS.forEach(angle => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = `${angle}°`;
  b.title = `${angle}°`;
  b.dataset.orient = String(angle);
  b.addEventListener('click', () => {
    mirrorOrient = angle;
    document.querySelectorAll('#mirrorOrientPicker button').forEach(x=>x.classList.toggle('active', x===b));
  });
  mirrorOrientPicker.appendChild(b);
});
setMirrorOrientActive(mirrorOrient);

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b===btn));
    colorRow.style.display = (currentTool==='goal' || currentTool==='converter') ? 'flex' : 'none';
    sourceSettingsRow.style.display = currentTool==='source' ? 'flex' : 'none';
    mirrorSettingsRow.style.display = currentTool==='mirror' ? 'flex' : 'none';
    converterSettingsRow.style.display = currentTool==='converter' ? 'flex' : 'none';
    recolorSettingsRow.style.display = currentTool==='recolor' ? 'flex' : 'none';
    selectionRow.style.display = currentTool==='select' ? 'flex' : 'none';
    if (currentTool !== 'select'){
      pasteMode = false;
      updateSelectionUI();
    }
    renderEditor();
  });
});
document.querySelectorAll('#sourceDirPicker button').forEach(btn => {
  btn.addEventListener('click', () => {
    currentDir = btn.dataset.dir;
    document.querySelectorAll('#sourceDirPicker button').forEach(b => b.classList.toggle('active', b===btn));
  });
});
document.querySelector('[data-tool="wall"]').classList.add('active');
document.querySelector('#sourceDirPicker [data-dir="right"]').classList.add('active');

mirrorRotatableCheck.addEventListener('change', () => {
  mirrorRotatable = mirrorRotatableCheck.checked;
});

mirrorDoubleSidedCheck.addEventListener('change', () => {
  mirrorDoubleSided = mirrorDoubleSidedCheck.checked;
});

// ミラーの色フィルターは、選んでいる色が白(7)かどうかで自動的に有効/無効を判定する
// （チェックボックスは廃止。白＝通常ミラー、白以外＝色フィルター付きミラー）
function isMirrorFilterActive(bits){ return bits !== 7; }

mirrorAngleOnlyModeCheck.addEventListener('change', () => {
  mirrorAngleOnlyMode = mirrorAngleOnlyModeCheck.checked;
});

let dragSetupDone = false;

// マウス操作とタッチ操作は「座標(x,y)の取得方法」が違うだけで、
// その後の処理内容は同じだったため、共通処理をここにまとめる。
function handleGridPointerDown(x, y){
  if (pasteMode){
    pasteAt(x, y);
    pasteMode = false;
    updateSelectionUI();
    return;
  }
  if (currentTool === 'select'){
    isSelecting = true;
    selectAnchor = {x,y};
    selection = {x0:x,y0:y,x1:x,y1:y};
    updateSelectionUI();
    renderEditor();
    return;
  }

  isDragging = true;
  lastErasedCell = null;
  onEditorCellClick(x, y);
  lastErasedCell = `${x},${y}`;
}

function handleGridPointerMove(x, y){
  if (isSelecting){
    selection = {x0:selectAnchor.x, y0:selectAnchor.y, x1:x, y1:y};
    updateSelectionUI();
    renderEditor();
    return;
  }
  if (!isDragging) return;
  const cellKey = `${x},${y}`;
  if (lastErasedCell !== cellKey){
    onEditorCellClick(x, y);
    lastErasedCell = cellKey;
  }
}

function resetGridPointerState(){
  isSelecting = false;
  isDragging = false;
  lastErasedCell = null;
}

function endGridDrag(){
  isDragging = false;
  lastErasedCell = null;
}

function cellFromTouch(touch){
  return document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.cell');
}

function setupDragPlacement(){
  if (dragSetupDone) return;
  dragSetupDone = true;
  gridE.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    handleGridPointerDown(parseInt(cell.dataset.x), parseInt(cell.dataset.y));
  });

  gridE.addEventListener('mousemove', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    handleGridPointerMove(parseInt(cell.dataset.x), parseInt(cell.dataset.y));
  });

  document.addEventListener('mouseup', resetGridPointerState);

  gridE.addEventListener('mouseleave', endGridDrag);

  gridE.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const cell = cellFromTouch(e.touches[0]);
    if (!cell) return;
    handleGridPointerDown(parseInt(cell.dataset.x), parseInt(cell.dataset.y));
  }, { passive: false });

  gridE.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const cell = cellFromTouch(e.touches[0]);
    if (!cell) return;
    handleGridPointerMove(parseInt(cell.dataset.x), parseInt(cell.dataset.y));
  }, { passive: false });

  gridE.addEventListener('touchend', resetGridPointerState);
}

$('#sizeUp').addEventListener('click', () => setDraftSize(draft.size + 1));
$('#sizeDown').addEventListener('click', () => setDraftSize(draft.size - 1));

const editorZoomVal = $('#editorZoomVal');
function setEditorZoom(z){
  editorZoom = Math.max(EDITOR_ZOOM_MIN, Math.min(EDITOR_ZOOM_MAX, Math.round(z * 100) / 100));
  localStorage.setItem('lightPuzzle.editorZoom', editorZoom);
  editorZoomVal.textContent = Math.round(editorZoom * 100) + '%';
  renderEditor();
}
$('#editorZoomUp').addEventListener('click', () => setEditorZoom(editorZoom + EDITOR_ZOOM_STEP));
$('#editorZoomDown').addEventListener('click', () => setEditorZoom(editorZoom - EDITOR_ZOOM_STEP));
editorZoomVal.textContent = Math.round(editorZoom * 100) + '%';

function setDraftSize(n){
  n = Math.max(MIN_BOARD_SIZE, Math.min(MAX_BOARD_SIZE, n));
  withHistory(() => {
    draft.size = n;
    draft.walls = draft.walls.filter(w => w[0]<n && w[1]<n);
    draft.elements = draft.elements.filter(e => e.x<n && e.y<n);
    draft.sources = draft.sources.filter(s => s.x<n && s.y<n);
    draft.goals = draft.goals.filter(g => g.x<n && g.y<n);
  });
  sizeVal.textContent = n + ' × ' + n;
  selection = null;
  pasteMode = false;
  updateSelectionUI();
  renderEditor();
}

function normalizedSelection(){
  if (!selection) return null;
  return {
    x0: Math.min(selection.x0, selection.x1),
    y0: Math.min(selection.y0, selection.y1),
    x1: Math.max(selection.x0, selection.x1),
    y1: Math.max(selection.y0, selection.y1),
  };
}

function updateSelectionUI(){
  selPasteBtn.classList.toggle('active', pasteMode);
  if (pasteMode){
    selHint.textContent = '貼り付け先のマスをクリック';
  } else if (selection){
    const s = normalizedSelection();
    const sizeTxt = `${s.x1-s.x0+1}×${s.y1-s.y0+1} マス選択中`;
    selHint.textContent = clipboard ? `${sizeTxt}` : sizeTxt;
  } else {
    selHint.textContent = 'ドラッグしてマスを選択';
  }
}

function copySelectionToClipboard(){
  const s = normalizedSelection();
  if (!s) { toast('先に範囲をドラッグして選択してね'); return null; }
  const { x0, y0, x1, y1 } = s;
  const inRect = (x,y) => x>=x0 && x<=x1 && y>=y0 && y<=y1;
  const walls = draft.walls.filter(([x,y]) => inRect(x,y)).map(([x,y]) => [x-x0, y-y0]);
  const stripToRel = (item) => {
    const { id, x, y, ...rest } = item;
    return { ...rest, dx: x-x0, dy: y-y0 };
  };
  const elements = draft.elements.filter(e => inRect(e.x,e.y)).map(stripToRel);
  const sources = draft.sources.filter(s2 => inRect(s2.x,s2.y)).map(stripToRel);
  const goals = draft.goals.filter(g => inRect(g.x,g.y)).map(stripToRel);
  clipboard = { w: x1-x0+1, h: y1-y0+1, walls, elements, sources, goals };
  clipboardOrigin = { x0, y0 };
  return clipboard;
}

function pasteAt(x0, y0){
  if (!clipboard) { toast('コピーまたは切り取りをしてから貼り付けてね'); return; }
  const size = draft.size;
  withHistory(() => {
    for (let dy=0; dy<clipboard.h; dy++){
      for (let dx=0; dx<clipboard.w; dx++){
        const tx = x0+dx, ty = y0+dy;
        if (tx<0||ty<0||tx>=size||ty>=size) continue;
        clearCellInDraft(tx,ty);
      }
    }
    clipboard.walls.forEach(([dx,dy]) => {
      const tx = x0+dx, ty = y0+dy;
      if (tx<0||ty<0||tx>=size||ty>=size) return;
      draft.walls.push([tx,ty]);
    });
    const placeAll = (list, targetArr) => {
      list.forEach(item => {
        const { dx, dy, ...rest } = item;
        const tx = x0+dx, ty = y0+dy;
        if (tx<0||ty<0||tx>=size||ty>=size) return;
        targetArr.push({ ...rest, id: nextId(), x: tx, y: ty });
      });
    };
    placeAll(clipboard.elements, draft.elements);
    placeAll(clipboard.sources, draft.sources);
    placeAll(clipboard.goals, draft.goals);
  });
  toast('貼り付けました');
  renderEditor();
}

function removeItemsInRect(x0, y0, x1, y1){
  const inRect = (x,y) => x>=x0 && x<=x1 && y>=y0 && y<=y1;
  draft.walls = draft.walls.filter(([x,y]) => !inRect(x,y));
  draft.elements = draft.elements.filter(e => !inRect(e.x,e.y));
  draft.sources = draft.sources.filter(s => !inRect(s.x,s.y));
  draft.goals = draft.goals.filter(g => !inRect(g.x,g.y));
}

selCopyBtn.addEventListener('click', () => {
  if (copySelectionToClipboard()) toast('コピーしました');
});

selCutBtn.addEventListener('click', () => {
  const s = normalizedSelection();
  if (!copySelectionToClipboard()) return;
  withHistory(() => { removeItemsInRect(s.x0, s.y0, s.x1, s.y1); });
  toast('切り取りました');
  renderEditor();
});

selPasteBtn.addEventListener('click', () => {
  if (!clipboard) { toast('コピーまたは切り取りをしてから貼り付けてね'); return; }
  pasteMode = !pasteMode;
  updateSelectionUI();
});

selClearBtn.addEventListener('click', () => {
  selection = null;
  pasteMode = false;
  updateSelectionUI();
  renderEditor();
});

document.addEventListener('keydown', (e) => {
  if (!panelEditor.classList.contains('active')) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  // 元に戻す/やり直すは選択ツール以外でも使えるようにする
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z'){
    e.preventDefault(); undo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))){
    e.preventDefault(); redo(); return;
  }

  if (currentTool !== 'select') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c'){ e.preventDefault(); selCopyBtn.click(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x'){ e.preventDefault(); selCutBtn.click(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v'){
    e.preventDefault();
    if (!clipboard){ toast('コピーまたは切り取りをしてから貼り付けてね'); return; }
    // クリックして選んだマスがあればそこへ、無ければコピー/切り取り元の位置へ貼り付ける
    const target = normalizedSelection() || clipboardOrigin;
    pasteMode = false;
    pasteAt(target.x0, target.y0);
    updateSelectionUI();
  }
  else if (e.key === 'Escape'){ selClearBtn.click(); }
});

function clearCellInDraft(x,y){
  draft.walls = draft.walls.filter(w => !(w[0]===x && w[1]===y));
  draft.elements = draft.elements.filter(e => !(e.x===x && e.y===y));
  draft.sources = draft.sources.filter(s => !(s.x===x && s.y===y));
  draft.goals = draft.goals.filter(g => !(g.x===x && g.y===y));
}

function onEditorCellClick(x,y){
  if (currentTool === 'select' || pasteMode) return; // 選択・貼り付けは専用のドラッグ/クリック処理で扱う
  const elHere = draft.elements.find(e=>e.x===x&&e.y===y);

  if (currentTool==='erase'){ withHistory(() => { clearCellInDraft(x,y); }); renderEditor(); return; }

  if (currentTool==='wall'){ withHistory(() => { clearCellInDraft(x,y); draft.walls.push([x,y]); }); renderEditor(); return; }

  if (currentTool==='mirror'){
    withHistory(() => {
      if (elHere && elHere.kind==='mirror'){
        if (mirrorAngleOnlyMode){
          // 角度だけ変更モード：色フィルター・回転可否・両面反射は既存の設定を維持し、向きだけ更新する
          elHere.orient = mirrorOrient;
        } else {
          elHere.rotatable = mirrorRotatable;
          elHere.doubleSided = mirrorDoubleSided;
          elHere.filterColor = isMirrorFilterActive(mirrorFilterColor) ? mirrorFilterColor : null;
          elHere.orient = mirrorOrient;
        }
      } else {
        clearCellInDraft(x,y);
        draft.elements.push({
          id:nextId(),
          kind:'mirror',
          x, y,
          orient: mirrorOrient,
          rotatable: mirrorRotatable,
          doubleSided: mirrorDoubleSided,
          filterColor: isMirrorFilterActive(mirrorFilterColor) ? mirrorFilterColor : null
        });
      }
    });
    renderEditor(); return;
  }

  if (currentTool==='converter'){
    withHistory(() => {
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
    });
    renderEditor(); return;
  }


  if (currentTool==='source'){
    withHistory(() => {
      const srcHere = draft.sources.find(s=>s.x===x&&s.y===y);
      if (srcHere){
        const isSameKind = srcHere.color === currentColor && srcHere.rotatable === sourceRotatable;
        if (sourceDirCycleMode && isSameKind){
          // 向き順送りモード：選択中の色・回転可否と一致する光源だけが対象。
          // 色・回転可否など既存の設定は維持し、向きだけ時計回りに1段階進める
          const idx = SOURCE_DIR_ORDER.indexOf(srcHere.dir);
          srcHere.dir = SOURCE_DIR_ORDER[(idx + 1 + SOURCE_DIR_ORDER.length) % SOURCE_DIR_ORDER.length];
        } else {
          // 色または回転可否が違う光源（＝別の種類）をクリックした場合は、現在のツール設定で上書きする
          srcHere.color = currentColor;
          srcHere.rotatable = sourceRotatable;
          srcHere.dir = currentDir;
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
    });
    renderEditor(); return;
  }

  if (currentTool==='goal'){
    withHistory(() => {
      clearCellInDraft(x,y);
      draft.goals.push({id:nextId(), x, y, color:currentColor});
    });
    renderEditor(); return;
  }

  if (currentTool==='recolor'){
    // 色編集ツール：向き・回転可否・両面反射など他の設定はいっさい変更せず、色だけを差し替える
    withHistory(() => {
      const m = draft.elements.find(e=>e.x===x&&e.y===y);
      if (m && m.kind==='mirror'){
        m.filterColor = isMirrorFilterActive(recolorColor) ? recolorColor : null;
        return;
      }
      if (m && m.kind==='converter'){
        m.color = recolorColor;
        return;
      }
      const s = draft.sources.find(ss=>ss.x===x&&ss.y===y);
      if (s){ s.color = recolorColor; return; }
      const g = draft.goals.find(gg=>gg.x===x&&gg.y===y);
      if (g){ g.color = recolorColor; return; }
      toast('このマスには色を変更できる要素がありません');
    });
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
  layoutBoard({
    wrapEl: boardE.closest('.board-wrap'),
    gridEl: gridE,
    boardEl: boardE,
    rulerTopEl: rulerTopE,
    rulerLeftEl: rulerLeftE,
    size,
    maxCellPx: 68,
    zoom: editorZoom,
  });

  gridE.innerHTML = '';
  for (let yy=0; yy<size; yy++){
    for (let xx=0; xx<size; xx++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = xx;
      cell.dataset.y = yy;
      buildCellVisual(cell, xx, yy);
      if (pasteMode) cell.classList.add('paste-armed');
      const s = normalizedSelection();
      if (s && xx>=s.x0 && xx<=s.x1 && yy>=s.y0 && yy<=s.y1) cell.classList.add('selected');
      cell.addEventListener('click', () => onEditorCellClick(xx,yy));
      gridE.appendChild(cell);
    }
  }

  setupDragPlacement();
}

$('#editClearBtn').addEventListener('click', () => {
  withHistory(() => {
    draft.walls=[]; draft.elements=[]; draft.sources=[]; draft.goals=[];
  });
  selection = null;
  pasteMode = false;
  updateSelectionUI();
  renderEditor();
});

$('#editUndoBtn').addEventListener('click', undo);
$('#editRedoBtn').addEventListener('click', redo);
updateUndoRedoButtons();

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
  syncSeqWithDraft(draft);
  const name = payload.name || payload.title || '';
  $('#nameInput').value = name;
  if (payload.description !== undefined) $('#officialDesc').value = payload.description || '';
  if (payload.difficulty !== undefined) $('#officialDifficulty').value = String(Math.max(1, Math.min(3, payload.difficulty || 1)));
  if (payload.tags !== undefined) {
    const tags = Array.isArray(payload.tags) ? payload.tags : parseTagsInput(payload.tags);
    $('#officialTags').value = tags.join(', ');
  }
  sizeVal.textContent = draft.size + ' × ' + draft.size;
  selection = null;
  pasteMode = false;
  updateSelectionUI();
  resetHistory();
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
