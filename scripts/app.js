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
