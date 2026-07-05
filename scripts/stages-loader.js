/* ================= stages-loader ================= */
/* サーバー上の公式ステージを読み込むモジュール */

let officialStages = [];   // { id, title, difficulty, tags, description, level }
let officialLoaded = false;

async function loadOfficialStages() {
  if (officialLoaded) return officialStages;
  try {
    const res = await fetch('stages/index.json');
    if (!res.ok) throw new Error('index.json not found');
    const manifest = await res.json();

    const loaded = await Promise.all(
      manifest.stages.map(async meta => {
        try {
          const r = await fetch(meta.file);
          if (!r.ok) throw new Error(`${meta.file} not found`);
          const data = await r.json();
          return {
            id: meta.id,
            title: meta.title || data.name,
            difficulty: Math.max(1, Math.min(3, meta.difficulty || 1)),
            tags: meta.tags || [],
            description: meta.description || '',
            level: data.level,
            name: data.name,
          };
        } catch (e) {
          console.warn('ステージ読み込みエラー:', meta.id, e);
          return null;
        }
      })
    );

    const serverStages = loaded.filter(Boolean);
    officialStages = serverStages;
    officialLoaded = true;
    return officialStages;
  } catch (e) {
    console.warn('公式ステージを読み込めませんでした:', e);
    officialStages = [];
    officialLoaded = true;
    return officialStages;
  }
}

/* URLパラメータから起動ステージIDを取得 */
function getStageIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('stage') || null;
}

/* URLパラメータからモードを取得 ('play' or null) */
function getModeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') || null;
}
