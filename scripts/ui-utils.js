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
