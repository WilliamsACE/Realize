'use strict';
/* Versiones anteriores de tus datos, para deshacer un error (borraste algo, importaste el
   respaldo equivocado…):
   - Copias en este dispositivo (IndexedDB): una al día, la primera vez que abres la app, y
     otra antes de importar, borrar todo o restaurar. Se guardan las últimas COPY_KEEP.
   - Con la sincronización conectada, además, el historial de tu repositorio de GitHub
     (cada sincronización es una versión).
   Restaurar reemplaza los datos actuales; si sincronizas, se propaga a tus otros dispositivos.
   Usa la instantánea y la aplicación de datos de js/sync.js. */

const COPY_KEEP = 10;
const COPY_INDEX = 'copyIndex';   // registro con la lista de copias (sin los datos, para listarlas rápido)

const copyIndex = async () => (await idbGet('meta', COPY_INDEX).catch(() => null))?.list || [];

// La instantánea se toma al llamar (antes de cualquier espera), así refleja el estado de ese momento.
function saveCopy(reason) {
  if (!state.lib.available) return Promise.resolve();
  const snap = localSnapshot();
  const at = Date.now();
  const key = `copy:${at}`;
  return (async () => {
    await idbPut('meta', { key, at, reason, snap });
    const list = [{ key, at, reason, words: snap.words.length, groups: snap.groups.length }, ...await copyIndex()];
    for (const old of list.slice(COPY_KEEP)) await idbDelete('meta', old.key);
    await idbPut('meta', { key: COPY_INDEX, list: list.slice(0, COPY_KEEP) });
  })().catch(e => console.warn('No se pudo guardar la copia', e));
}

// Una copia al día, con los datos tal como estaban al empezar el día.
async function dailyCopy() {
  if (!state.lib.available) return;
  const last = (await copyIndex())[0];
  if (!last || dateKey(last.at) !== dateKey(Date.now())) await saveCopy('Copia del día');
}

// Deja los datos como en `snap` (formato de localSnapshot) y avisa a la sincronización.
async function restoreSnapshot(snap, reason) {
  await saveCopy(reason);
  const full = { ...emptySnapshot(), ...snap };
  // Un libro sin su texto no se puede abrir: se restauran solo los libros cuyo texto sigue aquí.
  const texts = new Set(await idbRun('texts', 'readonly', os => os.getAllKeys()).catch(() => []));
  full.books = full.books.filter(b => texts.has(b.id));
  const books = new Set(full.books.map(b => b.id));
  full.segments = full.segments.filter(s => books.has(s.bookId) || texts.has(`frag:${s.id}`));
  const before = localSnapshot();
  state.ui.session = null;
  state.ui.groupRun = null;
  await applySnapshot(sortSnapshot(full), before);
  notifyDataChange();
}

/* ---------- Historial de GitHub ---------- */

async function remoteVersions() {
  const list = await ghRequest('/commits?per_page=20');
  return list.map(c => ({ sha: c.sha, at: Date.parse(c.commit?.author?.date || c.commit?.committer?.date) || 0, msg: c.commit?.message || '' }))
    .filter(v => !/^Inicio de la sincronización/.test(v.msg));
}

// Lee los archivos de datos tal como estaban en ese commit (y baja los textos de libros que falten).
async function remoteSnapshotAt(sha) {
  const treeSha = (await ghRequest(`/git/commits/${sha}`)).tree.sha;
  const t = await ghRequest(`/git/trees/${treeSha}?recursive=1`);
  const tree = Object.fromEntries(t.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
  const snap = emptySnapshot();
  for (const [path, f] of Object.entries(SYNC_FILES)) {
    if (tree[path]) f.set(snap, JSON.parse(fromBase64((await ghRequest(`/git/blobs/${tree[path]}`)).content)));
  }
  await pullTexts(null, snap, tree);
  return snap;
}

/* ---------- Vista (Ajustes → Tus datos) ---------- */

function versionsPanel() {
  const v = state.ui.versions;
  if (!v?.open) return '';
  const when = ts => new Date(ts).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const row = (title, detail, action, id) => `<div class="version-row">
      <div class="stack-xs grow"><b>${title}</b><span class="hint">${detail}</span></div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="${action}" data-id="${esc(id)}" ${v.busy ? 'disabled' : ''}>Restaurar</button>
    </div>`;
  const local = v.copies.length
    ? v.copies.map(c => row(when(c.at), `${esc(c.reason)} · ${plural(c.words, 'palabra', 'palabras')}${c.groups ? ` · ${plural(c.groups, 'grupo', 'grupos')}` : ''}`, 'restore-copy', c.key)).join('')
    : '<p class="hint">Todavía no hay copias. Se hace una cada día al abrir la app.</p>';
  const remote = !syncReady() ? ''
    : v.remoteError ? banner('err', 'No se pudo leer el historial de GitHub', esc(v.remoteError))
    : !v.remote ? '<span class="row gap-sm"><span class="spinner"></span><span class="hint">Leyendo el historial de GitHub…</span></span>'
    : v.remote.length ? v.remote.map(r => row(when(r.at), esc(r.msg.replace(/^Sincronización desde /, 'Sincronizado desde el ')), 'restore-remote', r.sha)).join('')
    : '<p class="hint">Aún no hay versiones en GitHub.</p>';
  return `<div class="versions">
    ${v.busy ? `<span class="row gap-sm"><span class="spinner"></span><span class="hint">${esc(v.busy)}</span></span>` : ''}
    <span class="eyebrow">En este dispositivo</span>
    ${local}
    ${syncReady() ? `<span class="eyebrow" style="margin-top:8px">En GitHub (sincronizadas)</span>${remote}` : ''}
  </div>`;
}

// Ajustes se repinta solo si sigue abierto.
const refreshVersions = () => refreshIfOn('ajustes');

Object.assign(actions, {
  'versions-toggle': async () => {
    const v = (state.ui.versions ||= { open: false, copies: [], remote: null, remoteError: null, busy: '' });
    v.open = !v.open;
    if (!v.open) { refreshVersions(); return; }
    v.copies = await copyIndex();
    v.remote = null;
    v.remoteError = null;
    refreshVersions();
    if (syncReady()) {
      try { v.remote = await remoteVersions(); } catch (e) { v.remoteError = e.message || String(e); }
      refreshVersions();
    }
  },
  'restore-copy': async el => {
    const v = state.ui.versions;
    const c = v?.copies.find(x => x.key === el.dataset.id);
    if (!c || !confirm(`¿Volver a tus datos del ${new Date(c.at).toLocaleString('es')}? Lo que hiciste después se reemplaza${syncReady() ? ' (también en tus otros dispositivos)' : ''}. Antes se guarda una copia de cómo están ahora.`)) return;
    v.busy = 'Restaurando…';
    refreshVersions();
    try {
      const rec = await idbGet('meta', c.key);
      if (!rec?.snap) throw new Error('La copia ya no existe.');
      await restoreSnapshot(rec.snap, 'Antes de restaurar');
      toast('Datos restaurados');
    } catch (e) {
      toast(`No se pudo restaurar: ${e.message || e}`, 'err');
    }
    Object.assign(v, { busy: '', copies: await copyIndex() });
    refreshVersions();
  },
  'restore-remote': async el => {
    const v = state.ui.versions;
    const r = v?.remote?.find(x => x.sha === el.dataset.id);
    if (!r || !confirm(`¿Volver a tus datos del ${new Date(r.at).toLocaleString('es')}? Lo que hiciste después se reemplaza en todos tus dispositivos. Antes se guarda una copia de cómo están ahora.`)) return;
    v.busy = 'Descargando esa versión…';
    refreshVersions();
    try {
      await restoreSnapshot(await remoteSnapshotAt(r.sha), 'Antes de restaurar');
      await syncNow();
      toast('Datos restaurados');
    } catch (e) {
      toast(`No se pudo restaurar: ${e.message || e}`, 'err');
    }
    Object.assign(v, { busy: '', copies: await copyIndex() });
    refreshVersions();
  },
  'storage-protect': async () => {
    const ok = await protectStorage(true);
    toast(ok ? 'Listo: el navegador no borrará tus datos por su cuenta' : 'El navegador no lo permitió. Instalar la app suele activarlo.', ok ? '' : 'err');
    refreshVersions();
  },
});

// Estado del almacenamiento en Ajustes (se rellena después de pintar: las consultas son asíncronas).
async function fillStorageStatus() {
  const el = document.getElementById('storage-status');
  if (!el || !navigator.storage?.estimate) return;
  const [{ usage = 0 }, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? false]);
  const mb = usage / 1024 / 1024;
  el.innerHTML = `<div class="stack-xs grow"><b>${persisted ? 'Datos protegidos' : 'Datos sin proteger'}</b>
      <span class="hint">${persisted ? 'El navegador no los borrará por falta de espacio.' : 'Si el dispositivo se queda sin espacio, el navegador podría borrarlos.'} Ocupan ${mb < 1 ? `${Math.max(1, Math.round(usage / 1024))} KB` : `${mb.toFixed(1)} MB`}.</span></div>
    ${persisted ? `<span class="chip chip-ok">${icon('check', 14)} Protegidos</span>` : '<button type="button" class="btn btn-secondary btn-sm" data-action="storage-protect">Protegerlos</button>'}`;
}
