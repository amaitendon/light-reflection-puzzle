/* ================= official-stage ================= */
/* 公式ステージの書き出し（エディター用） */

const OFFICIAL_FORMAT = 'official-stage';

function buildOfficialPackage({ id, title, description, difficulty, tags, name, level }) {
  return {
    format: OFFICIAL_FORMAT,
    version: 1,
    id,
    title: title || name || '無題のステージ',
    description: description || '',
    difficulty: Math.max(1, Math.min(5, difficulty || 1)),
    tags: Array.isArray(tags) ? tags : [],
    name: name || title || '無題のステージ',
    level,
  };
}

function parseTagsInput(raw) {
  return String(raw || '')
    .split(/[,、]/)
    .map(t => t.trim())
    .filter(Boolean);
}

async function fetchManifestStageIds() {
  try {
    const res = await fetch('stages/index.json');
    if (!res.ok) return [];
    const manifest = await res.json();
    return (manifest.stages || []).map(s => s.id);
  } catch {
    return [];
  }
}

function stageIdToNumber(id) {
  const m = String(id).match(/stage-(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

async function getNextStageId() {
  const serverIds = await fetchManifestStageIds();
  const nums = serverIds.map(stageIdToNumber);
  const max = nums.length ? Math.max(...nums) : 0;
  return `stage-${String(max + 1).padStart(3, '0')}`;
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportOfficialStageFile({ title, description, difficulty, tags, name, level }) {
  const id = await getNextStageId();
  const pkg = buildOfficialPackage({ id, title, description, difficulty, tags, name, level });
  downloadJSON(pkg, `${id}-official.json`);
  return pkg;
}
