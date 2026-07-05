/* ================= ui utils ================= */
function $(sel){ return document.querySelector(sel); }
function el(cls){ const d=document.createElement('div'); d.className=cls; return d; }

function toast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================= board layout (共通の盤面サイズ計算) =================
   エディター(editor.js)とプレイ(play.js)はどちらも「盤面を囲む枠(board-wrap)の
   幅から1マスのpx数を逆算し、grid/board/ruler(/svg)に反映する」という同じ処理を
   必要とする。以前はこのロジックが2箇所に別々にコピーされており、
   - 参照する要素を間違える
   - 表示前(display:none)に計算してしまい幅が0になる
   といった食い違いがバグの温床になっていた。
   盤面サイズに関する計算・DOM反映はすべてこの関数に一本化し、
   呼び出し側は「どの要素を使うか」と「最大セルサイズ」だけを渡す。 */
function layoutBoard({ wrapEl, gridEl, boardEl, rulerTopEl, rulerLeftEl, svgEl, size, maxCellPx, minCellPx = 26, maxWrapPx = 560 }){
  const wrapWidth = Math.min(maxWrapPx, (wrapEl.clientWidth - 40) || 480);
  const cellPx = Math.max(minCellPx, Math.min(maxCellPx, Math.floor(wrapWidth / size)));
  const total = cellPx * size;

  gridEl.style.gridTemplateColumns = `repeat(${size}, ${cellPx}px)`;
  gridEl.style.gridTemplateRows = `repeat(${size}, ${cellPx}px)`;
  gridEl.style.width = total + 'px';
  gridEl.style.height = total + 'px';
  boardEl.style.width = total + 'px';
  boardEl.style.height = total + 'px';

  if (svgEl){
    svgEl.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svgEl.style.width = total + 'px';
    svgEl.style.height = total + 'px';
  }

  rulerTopEl.innerHTML = '';
  rulerLeftEl.innerHTML = '';
  rulerTopEl.style.width = total + 'px';
  rulerLeftEl.style.height = total + 'px';
  for (let i = 0; i < size; i++){
    const t = document.createElement('span'); t.textContent = i % 2 === 0 ? i : ''; rulerTopEl.appendChild(t);
    const l = document.createElement('span'); l.textContent = i % 2 === 0 ? i : ''; rulerLeftEl.appendChild(l);
  }

  return { cellPx, total };
}

