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
  // パネルが表示状態(display)になった直後に呼ぶことで、
  // board-wrap の幅が 0 のまま盤面サイズが計算されてしまうのを防ぐ
  if (which==='editor') renderEditor();
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
  const stageId = getStageIdFromUrl();
  const mode = getModeFromUrl();

  if (stageId) {
    // URLに ?stage=XXX があれば公式ステージを読み込んでプレイ
    showTab('play');
    const stages = await loadOfficialStages();
    const target = stages.find(s => s.id === stageId);
    if (target) {
      migrateLegacyData(target.level);
      loadLevel(target.level, target.name || target.title, stageId, false);
    } else {
      toast('ステージが見つかりませんでした: ' + stageId);
      showPlayList();
    }
  } else if (mode === 'play') {
    showTab('play');
  } else {
    showTab('editor');
  }
})();
