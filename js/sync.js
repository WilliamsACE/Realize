'use strict';
/* Sincronización entre dispositivos sin servidor propio.

   El navegador habla directo con un repositorio PRIVADO de GitHub del usuario (API de
   Git, con un token limitado a ese repositorio). Cada sincronización es un solo commit
   atómico con estos archivos, en JSON legible y con un registro por línea (así git
   guarda solo las diferencias y el repositorio crece poco):
     datos/palabras.json · datos/grupos.json · datos/progreso.json (estadísticas, ajustes
     compartidos y capturas) · datos/lecturas.json (libros y segmentos) ·
     datos/vocabulario.json (palabras que ya sabes) · textos/<id>.json (texto de cada
     libro o fragmento: no cambia, se sube una sola vez).

   Cada dispositivo guarda la versión de la última sincronización (la «base», en
   IndexedDB) y fusiona en tres vías: lo que cambió en un solo lado gana; si cambió en
   los dos, se decide campo por campo (el repaso más reciente, la unión de listas, la
   suma de actividad…). Lo borrado en un lado se borra en el otro si allí no cambió.
   Las API keys, el token y la elección de proveedor nunca salen del dispositivo. */

const SYNC_API = 'https://api.github.com';
const SYNC_DELAY = 15 * 1000;        // espera tras un cambio antes de subirlo (agrupa ráfagas)
const SYNC_EVERY = 5 * MINUTE;       // con la app abierta, mira si hay cambios de otro dispositivo
// Ajustes propios de cada dispositivo: no se suben ni se sobrescriben al fusionar.
const DEVICE_SETTINGS = ['apiKey', 'deepseekKey', 'openaiKey', 'provider', 'model', 'deepseekModel', 'openaiModel',
  'dismissedBanners', 'syncRepo', 'syncToken', 'syncAuto', 'syncLastAt'];

const sync = { busy: null, again: false, timer: null, status: 'off', error: null, dirty: false, applying: false, branch: null };
const syncReady = (s = state.data.settings) => !!(s.syncRepo && s.syncToken);

class SyncError extends Error {
  constructor(code, message) { super(message); this.name = 'SyncError'; this.code = code; }
}

/* ---------- Cliente de GitHub ---------- */

// "https://github.com/ana/realize-datos.git" → "ana/realize-datos"
const cleanRepo = v => String(v || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');

async function ghRequest(path, { method = 'GET', body = null, settings = state.data.settings } = {}) {
  if (navigator.onLine === false) throw new SyncError('OFFLINE', 'Sin conexión. Se sincronizará cuando vuelvas a estar en línea.');
  let res;
  try {
    res = await fetch(`${SYNC_API}/repos/${settings.syncRepo}${path}`, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${settings.syncToken}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('NETWORK', 'No se pudo conectar con GitHub. Revisa tu conexión.');
  }
  if (res.ok) return res.status === 204 ? null : res.json();
  const msg = String((await res.json().catch(() => null))?.message || '');
  if (res.status === 401) throw new SyncError('TOKEN', 'El token no es válido o ya expiró. Crea uno nuevo y vuelve a conectar.');
  if (res.status === 403 && /rate limit/i.test(msg)) throw new SyncError('RATE', 'GitHub limitó las peticiones por un rato. Se reintentará más tarde.');
  if (res.status === 403) throw new SyncError('FORBIDDEN', 'El token no puede escribir en el repositorio. Dale el permiso «Contents: Read and write».');
  if (res.status === 404) throw new SyncError('NOT_FOUND', 'No se encontró el repositorio, o el token no tiene acceso a él.');
  if (res.status === 409 && /empty/i.test(msg)) throw new SyncError('EMPTY', 'El repositorio está vacío.');
  if (res.status === 409 || (res.status === 422 && /fast.forward|reference/i.test(msg))) throw new SyncError('CONFLICT', 'Otro dispositivo guardó cambios al mismo tiempo.');
  throw new SyncError('HTTP', `GitHub respondió con un error (${res.status})${msg ? `: ${msg}` : ''}.`);
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// SHA del blob tal como lo calcula git, para no volver a subir lo que no cambió.
async function blobSha(text) {
  if (!globalThis.crypto?.subtle) return null;   // fuera de https: se sube todo y GitHub lo deduplica
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ghBranch() {
  if (!sync.branch) sync.branch = (await ghRequest('')).default_branch || 'main';
  return sync.branch;
}

// Commit actual de la rama; si el repositorio está vacío, lo inicia con un LÉEME.
async function ghHead(branch) {
  try {
    return (await ghRequest(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  } catch (e) {
    if (e.code !== 'EMPTY' && e.code !== 'NOT_FOUND') throw e;
    if (e.code === 'NOT_FOUND') await ghRequest('');   // distingue «repo inaccesible» de «rama vacía»
    await ghRequest('/contents/LEEME.md', {
      method: 'PUT',
      body: { message: 'Inicio de la sincronización de Realize', branch, content: toBase64('# Datos de Realize\n\nCopia sincronizada de tus palabras, grupos y lecturas. La app lo actualiza sola: no edites estos archivos a mano.\n') },
    });
    return (await ghRequest(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  }
}

/* ---------- Instantánea de los datos ---------- */

const clone = v => JSON.parse(JSON.stringify(v));
// JSON con las claves ordenadas: dos objetos iguales dan el mismo texto.
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
const same = (a, b) => canon(a) === canon(b);

function sharedSettings(s) {
  const out = { ...s };
  for (const k of DEVICE_SETTINGS) delete out[k];
  return out;
}

function localSnapshot() {
  const d = state.data;
  return clone({
    words: d.words, groups: d.groups || [], captures: d.captures || [], captureSeg: d.captureSeg || '',
    settings: sharedSettings(d.settings), stats: d.stats,
    books: state.lib.books, segments: state.lib.segments, known: [...state.lib.known.values()],
  });
}
const emptySnapshot = () => ({ words: [], groups: [], captures: [], captureSeg: '', settings: {}, stats: defaultStats(), books: [], segments: [], known: [] });

// Un registro por línea: git guarda solo las líneas que cambian entre versiones.
const lines = arr => (arr.length ? `[\n${arr.map(x => JSON.stringify(x)).join(',\n')}\n]` : '[]');
// Orden estable en el archivo: por fecha de creación (el orden en que se agregaron, que es
// el que usa la sesión para presentar las nuevas) y luego por clave.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byCreated = (a, b) => cmp(a.createdAt || a.at || 0, b.createdAt || b.at || 0) || cmp(String(a.id), String(b.id));
// Todos los dispositivos ordenan igual; si no, se reordenarían el archivo unos a otros sin fin.
function sortSnapshot(s) {
  for (const k of ['words', 'groups', 'captures', 'books', 'segments']) s[k].sort(byCreated);
  s.known.sort((a, b) => cmp(a.lemma, b.lemma));
  return s;
}
const SYNC_FILES = {
  'datos/palabras.json': { get: s => s.words, set: (s, v) => { s.words = v || []; }, text: s => lines(s.words) },
  'datos/grupos.json': { get: s => s.groups, set: (s, v) => { s.groups = v || []; }, text: s => lines(s.groups) },
  'datos/vocabulario.json': { get: s => s.known, set: (s, v) => { s.known = v || []; }, text: s => lines(s.known) },
  'datos/lecturas.json': {
    get: s => ({ books: s.books, segments: s.segments }),
    set: (s, v) => { s.books = v?.books || []; s.segments = v?.segments || []; },
    text: s => `{\n"books": ${lines(s.books)},\n"segments": ${lines(s.segments)}\n}`,
  },
  'datos/progreso.json': {
    get: s => ({ stats: s.stats, settings: s.settings, captures: s.captures, captureSeg: s.captureSeg }),
    set: (s, v) => { s.stats = { ...defaultStats(), ...(v?.stats || {}) }; s.settings = v?.settings || {}; s.captures = v?.captures || []; s.captureSeg = v?.captureSeg || ''; },
    text: s => JSON.stringify({ stats: s.stats, settings: s.settings, captures: s.captures, captureSeg: s.captureSeg }, null, 1),
  },
};
const textPath = id => `textos/${String(id).replace(/[^\w-]/g, '_')}.json`;
// Textos que hacen falta: el de cada libro y el de cada segmento creado desde un fragmento.
const neededTexts = snap => new Set([...snap.books.map(b => b.id), ...snap.segments.filter(s => s.sel?.fragment).map(s => `frag:${s.id}`)]);

/* ---------- Fusión en tres vías ---------- */

const unionArr = (a = [], b = []) => [...new Set([...a, ...b])];
function unionBy(a = [], b = [], keyOf) {
  const m = new Map();
  for (const x of [...a, ...b]) if (!m.has(keyOf(x))) m.set(keyOf(x), x);
  return [...m.values()];
}
const keepLocal = (k, l) => l[k];

// Campo por campo: gana el lado que cambió; si cambiaron los dos, decide `tie`.
function mergeFields(b, l = {}, r = {}, tie = keepLocal) {
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const v = same(l[k], r[k]) ? l[k] : b && same(l[k], b[k]) ? r[k] : b && same(r[k], b[k]) ? l[k] : tie(k, l, r, b);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Listas de registros con clave: altas, bajas y cambios de cada lado.
function mergeList(base = [], local = [], remote = [], key, tie) {
  const index = list => new Map(list.map(x => [x[key], { v: x, c: canon(x) }]));
  const B = index(base), L = index(local), R = index(remote);
  const out = [];
  for (const k of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(k), l = L.get(k), r = R.get(k);
    if (l && r) out.push(l.c === r.c ? l.v : b && l.c === b.c ? r.v : b && r.c === b.c ? l.v : mergeFields(b?.v, l.v, r.v, tie));
    else if (l) { if (!b || l.c !== b.c) out.push(l.v); }   // el otro lado lo borró: se borra si aquí no cambió
    else if (!b || r.c !== b.c) out.push(r.v);
  }
  return out;
}

// Listas de la palabra que se unen (con el mismo tope que normalizeWord).
const WORD_SETS = { forms: 12, segIds: 0, recogDays: 0, successDays: 0, acceptedMeanings: 10, mistakes: 5 };
function wordTie(k, l, r) {
  if (k in WORD_SETS) { const u = unionArr(l[k], r[k]); return WORD_SETS[k] ? u.slice(0, WORD_SETS[k]) : u; }
  if (k === 'contexts') return unionBy(l[k], r[k], c => c.text).slice(0, 4);
  if (k === 'sentences') return unionBy(l[k], r[k], s => `${s.at}|${s.text}`).sort((a, b) => b.at - a.at).slice(0, 10);
  // Progreso y contenido: los del dispositivo que la repasó por última vez (así el SRS queda coherente).
  return ((r.lastReviewedAt || 0) > (l.lastReviewedAt || 0) ? r : l)[k];
}
function groupTie(k, l, r) {
  if (k === 'runs' || k === 'best') return Math.max(l[k] || 0, r[k] || 0);
  if (k === 'ids') return unionArr(l.ids, r.ids);
  if (k === 'defs') return { ...r.defs, ...l.defs };
  return ((r.lastAt || 0) > (l.lastAt || 0) ? r : l)[k];
}
function knownTie(k, l, r) {
  const rank = x => KNOWN_RANK[x.status] || 0;
  return (rank(r) > rank(l) || (rank(r) === rank(l) && (r.at || 0) > (l.at || 0)) ? r : l)[k];
}

// Estadísticas: la actividad se suma (lo que hizo cada dispositivo desde la base) y la racha
// es la del que estudió más recientemente.
function mergeStats(b, l, r) {
  b = b || {};
  const num = (o, k) => Number(o?.[k]) || 0;
  const add = (lv, rv, bv) => Math.max(lv, rv, lv + rv - bv);
  const history = {};
  for (const d of new Set([...Object.keys(l.history || {}), ...Object.keys(r.history || {})])) {
    history[d] = add(num(l.history, d), num(r.history, d), num(b.history, d));
  }
  const li = l.newIntroduced || {}, ri = r.newIntroduced || {}, bi = b.newIntroduced || {};
  let newIntroduced;
  if (li.date === ri.date) {
    newIntroduced = { date: li.date ?? null };
    for (const m of ['classic', 'relaxed', 'intensive']) newIntroduced[m] = add(num(li, m), num(ri, m), bi.date === li.date ? num(bi, m) : 0);
  } else newIntroduced = (ri.date || '') > (li.date || '') ? ri : li;
  const later = (r.lastStudyDate || '') > (l.lastStudyDate || '') || (r.lastStudyDate === l.lastStudyDate && num(r, 'streak') > num(l, 'streak')) ? r : l;
  const feats = { ...(r.feats || {}) };
  for (const [k, ts] of Object.entries(l.feats || {})) feats[k] = feats[k] ? Math.min(feats[k], ts) : ts;
  return {
    ...l, history, newIntroduced, feats,
    streak: later.streak, lastStudyDate: later.lastStudyDate, freezes: later.freezes,
    bestStreak: Math.max(num(l, 'bestStreak'), num(r, 'bestStreak')),
    sessionsDone: add(num(l, 'sessionsDone'), num(r, 'sessionsDone'), num(b, 'sessionsDone')),
    frozenDays: unionArr(l.frozenDays, r.frozenDays).sort().slice(-30),
    lastExportAt: Math.max(num(l, 'lastExportAt'), num(r, 'lastExportAt')) || null,
  };
}

function mergeSnapshots(b, l, r) {
  b = b || {};
  return {
    words: mergeList(b.words, l.words, r.words, 'id', wordTie),
    groups: mergeList(b.groups, l.groups, r.groups, 'id', groupTie),
    captures: mergeList(b.captures, l.captures, r.captures, 'id', keepLocal),
    captureSeg: same(l.captureSeg, r.captureSeg) || !same(l.captureSeg, b.captureSeg) ? l.captureSeg : r.captureSeg,
    settings: mergeFields(b.settings, l.settings, r.settings),
    stats: mergeStats(b.stats, l.stats, r.stats),
    books: mergeList(b.books, l.books, r.books, 'id', keepLocal),
    segments: mergeList(b.segments, l.segments, r.segments, 'id', keepLocal),
    known: mergeList(b.known, l.known, r.known, 'lemma', knownTie),
  };
}

/* La misma palabra agregada en dos dispositivos antes de conectarlos tiene dos ids:
   se queda la que lleva más progreso y los grupos pasan a apuntar a ella. */
function dedupeWords(snap) {
  const progress = w => (w.srs?.reps || 0) * 10 + (w.successDays?.length || 0) + (w.introducedAt ? 1 : 0);
  const keepers = new Map(), remap = new Map();
  for (const w of snap.words) {
    const k = normalize(w.word);
    const prev = keepers.get(k);
    if (!prev) { keepers.set(k, w); continue; }
    const [keep, drop] = progress(w) > progress(prev) ? [w, prev] : [prev, w];
    for (const f of Object.keys(WORD_SETS)) keep[f] = wordTie(f, keep, drop);
    keep.pinned = !!(keep.pinned || drop.pinned);
    keepers.set(k, keep);
    remap.set(drop.id, keep.id);
  }
  if (!remap.size) return snap;
  for (const g of snap.groups) {
    g.ids = unionArr(g.ids.map(id => remap.get(id) || id));
    for (const [from, to] of remap) if (g.defs?.[from]) { g.defs[to] ||= g.defs[from]; delete g.defs[from]; }
  }
  return { ...snap, words: snap.words.filter(w => keepers.get(normalize(w.word)) === w) };
}

// Un dispositivo recién estrenado (solo las palabras de ejemplo) toma directamente lo de la nube.
function isPristine(snap) {
  const samples = new Set(sampleWords().map(w => normalize(w.word)));
  return snap.words.every(w => samples.has(normalize(w.word))) && !snap.groups.length && !snap.segments.length
    && !snap.books.length && !snap.captures.length && !snap.stats.lastStudyDate;
}

/* ---------- Aplicar lo fusionado en este dispositivo ---------- */

// Reemplaza el contenido de cada registro sin cambiar el objeto: así las referencias que
// tenga abiertas la app (una sesión, una petición a la IA) siguen apuntando a datos vivos.
function replaceInPlace(arr, next, key) {
  const cur = new Map(arr.map(x => [x[key], x]));
  const out = next.map(n => {
    const o = cur.get(n[key]);
    if (!o) return n;
    for (const k of Object.keys(o)) if (!(k in n)) delete o[k];
    return Object.assign(o, n);
  });
  arr.splice(0, arr.length, ...out);
}

// Debe ser síncrona hasta guardar en memoria: entre la instantánea local y este punto no
// puede colarse ningún cambio del usuario.
function applySnapshot(m, before) {
  const d = state.data;
  replaceInPlace(d.words, m.words.map(normalizeWord).filter(w => w.word), 'id');
  if (!Array.isArray(d.groups)) d.groups = [];
  replaceInPlace(d.groups, m.groups.filter(g => g?.id && Array.isArray(g.ids)).map(normalizeGroup), 'id');
  d.captures = m.captures;
  d.captureSeg = m.captureSeg;
  Object.assign(d.settings, sharedSettings(m.settings));
  Object.assign(d.stats, m.stats);
  replaceInPlace(state.lib.books, m.books, 'id');
  replaceInPlace(state.lib.segments, m.segments, 'id');
  state.lib.known = new Map(m.known.map(k => [k.lemma, k]));
  saveData(d);
  // IndexedDB: solo lo que cambió.
  if (!state.lib.available) return Promise.resolve();
  const write = async (store, prev, next, key) => {
    const old = new Map(prev.map(x => [x[key], canon(x)]));
    const puts = next.filter(x => old.get(x[key]) !== canon(x));
    const keep = new Set(next.map(x => x[key]));
    if (puts.length) await idbPutMany(store, puts);
    for (const k of old.keys()) if (!keep.has(k)) await idbDelete(store, k);
  };
  return Promise.all([write('books', before.books, m.books, 'id'), write('segments', before.segments, m.segments, 'id'), write('known', before.known, m.known, 'lemma')])
    .catch(e => console.error('No se pudieron guardar las lecturas sincronizadas', e));
}

/* ---------- Una sincronización completa ---------- */

async function loadBase(repo) {
  try { const rec = await idbGet('meta', 'syncBase'); return rec?.repo === repo ? rec : null; } catch { return null; }
}
const saveBase = rec => idbPut('meta', { key: 'syncBase', ...rec }).catch(e => console.warn('No se guardó la base de sincronización', e));
const clearBase = () => idbDelete('meta', 'syncBase').catch(() => {});
const deviceName = () => (/iphone|ipad|android|mobile/i.test(navigator.userAgent) ? 'celular' : 'computadora');

async function runSync() {
  const repo = state.data.settings.syncRepo;
  const branch = await ghBranch();
  for (let attempt = 0; ; attempt++) {
    // 1) Lo que hay en la nube (solo se descarga lo que cambió desde la última vez).
    const head = await ghHead(branch);
    const base = await loadBase(repo);
    let remote = null, tree = base?.tree || {}, treeSha = base?.treeSha;
    if (base && base.commit === head) remote = base.snap;
    else {
      treeSha = (await ghRequest(`/git/commits/${head}`)).tree.sha;
      const t = await ghRequest(`/git/trees/${treeSha}?recursive=1`);
      tree = Object.fromEntries(t.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
      if (Object.keys(SYNC_FILES).some(p => tree[p])) {
        remote = emptySnapshot();
        for (const [path, f] of Object.entries(SYNC_FILES)) {
          if (!tree[path]) continue;
          f.set(remote, base && base.tree[path] === tree[path]
            ? clone(f.get(base.snap)) : JSON.parse(fromBase64((await ghRequest(`/git/blobs/${tree[path]}`)).content)));
        }
      }
    }

    // 2) Fusión y 3) aplicarla aquí, sin pausas entre medio.
    const local = localSnapshot();
    const asIs = canon(local);
    const merged = sortSnapshot(!remote ? clone(local)
      : !base && isPristine(local) ? remote
      : dedupeWords(mergeSnapshots(base?.snap, local, remote)));
    const pulled = canon(merged) !== canon(sortSnapshot(local));   // llegó contenido nuevo, no solo otro orden
    let saving = null;
    if (pulled || canon(merged) !== asIs) {
      sync.applying = true;
      try { saving = applySnapshot(merged, local); } finally { sync.applying = false; }
    }
    await saving;
    await pullTexts(base?.snap, merged, tree);

    // 4) Subir en un solo commit lo que cambió.
    const entries = [];
    const shas = {};
    for (const [path, f] of Object.entries(SYNC_FILES)) {
      const text = f.text(merged);
      shas[path] = await blobSha(text);
      if (!shas[path] || shas[path] !== tree[path]) entries.push({ path, mode: '100644', type: 'blob', content: text });
    }
    entries.push(...await textEntries(base?.snap, merged, tree));
    let commit = head;
    if (entries.length) {
      const t = await ghRequest('/git/trees', { method: 'POST', body: { base_tree: treeSha, tree: entries } });
      if (t.sha !== treeSha) {
        const c = await ghRequest('/git/commits', { method: 'POST', body: { message: `Sincronización desde ${deviceName()}`, tree: t.sha, parents: [head] } });
        try {
          await ghRequest(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: c.sha, force: false } });
        } catch (e) {
          // Otro dispositivo subió algo justo ahora: se vuelve a empezar con su versión.
          if (e.code === 'CONFLICT' && attempt < 3) continue;
          throw e;
        }
        commit = c.sha;
        for (const e of entries) { if (e.sha === null) delete tree[e.path]; else tree[e.path] = shas[e.path] || await blobSha(e.content); }
        if (Object.values(tree).some(v => !v)) {
          const fresh = await ghRequest(`/git/trees/${t.sha}?recursive=1`);
          tree = Object.fromEntries(fresh.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
        }
        treeSha = t.sha;
      }
    }
    await saveBase({ repo, commit, treeSha, tree, snap: merged });
    return { pulled, pushed: commit !== head };
  }
}

// Textos de libros: se bajan los que faltan aquí y se borran los de libros borrados en otro lado.
async function pullTexts(baseSnap, merged, tree) {
  if (!state.lib.available) return;
  const need = neededTexts(merged);
  const local = new Set(await idbRun('texts', 'readonly', os => os.getAllKeys()));
  for (const id of need) {
    if (local.has(id) || !tree[textPath(id)]) continue;
    const rec = JSON.parse(fromBase64((await ghRequest(`/git/blobs/${tree[textPath(id)]}`)).content));
    await idbPut('texts', rec);
  }
  if (baseSnap) for (const id of neededTexts(baseSnap)) if (!need.has(id) && local.has(id)) await idbDelete('texts', id).catch(() => {});
}
// …y en la nube: se suben los nuevos y se quitan los que estaban en la última sincronización
// y ya no hacen falta (nunca los de otro dispositivo que todavía no terminó de subir).
async function textEntries(baseSnap, merged, tree) {
  if (!state.lib.available) return [];
  const need = neededTexts(merged);
  const out = [];
  for (const id of need) {
    if (tree[textPath(id)]) continue;
    const rec = await idbGet('texts', id);
    if (rec) out.push({ path: textPath(id), mode: '100644', type: 'blob', content: JSON.stringify(rec) });
  }
  if (baseSnap) for (const id of neededTexts(baseSnap)) if (!need.has(id) && tree[textPath(id)]) out.push({ path: textPath(id), mode: '100644', type: 'blob', sha: null });
  return out;
}

/* ---------- Cuándo sincronizar ---------- */

function syncNow({ manual = false } = {}) {
  if (!syncReady()) return Promise.resolve(null);
  if (sync.busy) { sync.again = true; return sync.busy; }
  clearTimeout(sync.timer);
  sync.status = 'syncing';
  updateSyncUI();
  sync.busy = (async () => {
    try {
      const r = await runSync();
      sync.status = 'ok';
      sync.error = null;
      state.data.settings.syncLastAt = Date.now();
      saveData(state.data);
      if (r.pulled) onPulled();
      if (manual) toast(r.pulled || r.pushed ? 'Sincronizado' : 'Todo estaba al día');
      return r;
    } catch (e) {
      if (e.code !== 'OFFLINE' && e.code !== 'NETWORK') console.warn('Sincronización', e);
      sync.status = e.code === 'OFFLINE' || e.code === 'NETWORK' ? 'offline' : 'error';
      sync.error = e instanceof SyncError ? e : new SyncError('UNKNOWN', `Error inesperado: ${e?.message || e}`);
      if (manual) toast(sync.error.message, 'err');
      return null;
    } finally {
      sync.busy = null;
      if (sync.again) { sync.again = false; scheduleSync(2000); }
      else if (sync.status === 'ok') sync.dirty = false;
      updateSyncUI();
    }
  })();
  return sync.busy;
}

function scheduleSync(delay = SYNC_DELAY) {
  if (!syncReady() || sync.applying) return;
  sync.dirty = true;
  if (sync.busy) sync.again = true;
  if (!state.data.settings.syncAuto) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(() => syncNow(), delay);
}
dataChangeListeners.add(() => scheduleSync());

// Llegaron cambios de otro dispositivo: se repinta, salvo en medio de un ejercicio o escribiendo.
function onPulled() {
  const s = state.ui.session;
  if (s?.ex && !findWord(s.ex.wordId)) state.ui.session = null;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (!document.body.classList.contains('is-focus') && !typing) render();
  toast('Se trajeron los cambios de tu otro dispositivo');
}

function syncBoot() {
  const auto = () => syncReady() && state.data.settings.syncAuto;
  document.addEventListener('visibilitychange', () => {
    if (!auto()) return;
    if (document.visibilityState === 'hidden') { if (sync.dirty) syncNow(); }   // al salir, sube lo pendiente
    else if (Date.now() - (state.data.settings.syncLastAt || 0) > MINUTE) syncNow();
  });
  window.addEventListener('online', () => { if (auto()) syncNow(); });
  setInterval(() => { if (auto() && document.visibilityState === 'visible') syncNow(); }, SYNC_EVERY);
  sync.status = syncReady() ? 'ok' : 'off';
  updateSyncUI();
  if (auto()) syncNow();
}

/* ---------- Vista ---------- */

function syncAgo(ts, now = Date.now()) {
  if (!ts) return 'nunca';
  const min = Math.floor((now - ts) / MINUTE);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.floor(min / 60)} h`;
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function syncStatusInfo() {
  if (!syncReady()) return { cls: 'is-off', label: 'Sin sincronizar' };
  if (sync.status === 'syncing') return { cls: 'is-syncing', label: 'Sincronizando…' };
  if (sync.status === 'offline') return { cls: 'is-offline', label: 'Sin conexión' };
  if (sync.status === 'error') return { cls: 'is-error', label: 'Error al sincronizar' };
  if (sync.dirty) return { cls: 'is-dirty', label: 'Cambios por subir' };
  return { cls: 'is-ok', label: 'Sincronizado' };
}

// Indicador de la barra (nube) y tarjeta de Ajustes; se actualizan sin repintar la vista.
function updateSyncUI() {
  const st = syncStatusInfo();
  document.querySelectorAll('.sync-chip').forEach(el => {
    el.hidden = !syncReady();
    el.classList.remove('is-off', 'is-ok', 'is-dirty', 'is-syncing', 'is-offline', 'is-error');
    el.classList.add(st.cls);
    el.title = `${st.label}${sync.error && st.cls === 'is-error' ? `: ${sync.error.message}` : ''} · Toca para sincronizar`;
    el.setAttribute('aria-label', el.title);
    const t = el.querySelector('.sync-chip-label');
    if (t) t.textContent = st.label;
  });
  const card = document.getElementById('sync-card');
  if (card && syncReady() && !state.ui.syncForm?.busy) card.outerHTML = syncCard();
}

function syncCard() {
  const s = state.data.settings;
  const u = (state.ui.syncForm ||= { repo: s.syncRepo || '', busy: false, error: null, guide: false });
  if (!syncReady() || u.busy) {
    return `<section class="card stack" id="sync-card">
      <div class="row nowrap top">
        <span class="icon-tile">${icon('cloud')}</span>
        <div class="stack-xs grow"><h2>Celular y computadora</h2>
          <span class="hint">Usa la app en todos tus dispositivos con los mismos datos. Sin servidor: el navegador los guarda en un repositorio privado de GitHub que es solo tuyo.</span></div>
      </div>
      <details class="sync-guide" ${u.guide || !s.syncRepo ? 'open' : ''}>
        <summary>Cómo conectarlo (solo la primera vez)</summary>
        <ol>
          <li>Entra a <a href="https://github.com/signup" target="_blank" rel="noopener">GitHub</a> (la cuenta es gratis).</li>
          <li><a href="https://github.com/new?name=realize-datos&visibility=private" target="_blank" rel="noopener">Crea un repositorio</a> y márcalo como <b>Private</b>.</li>
          <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Crea un token «Fine-grained»</a>: en <i>Repository access</i> elige <i>Only select repositories</i> y ese repositorio; en <i>Permissions → Repository permissions → Contents</i> elige <b>Read and write</b>. Ponle una expiración larga.</li>
          <li>Pega aquí el repositorio y el token, y pulsa <b>Conectar</b>.</li>
          <li>En tu otro dispositivo abre la app y repite el paso 4.</li>
        </ol>
      </details>
      <form class="stack-sm" data-submit="sync-connect" autocomplete="off">
        <div class="field"><label class="label" for="sync-repo">Repositorio</label>
          <input id="sync-repo" name="repo" class="input" placeholder="tu-usuario/realize-datos" value="${esc(u.repo)}" autocapitalize="off" spellcheck="false" ${u.busy ? 'readonly' : ''}></div>
        <div class="field"><label class="label" for="sync-token">Token de GitHub</label>
          <input id="sync-token" name="token" type="password" class="input" placeholder="github_pat_…" autocomplete="off" spellcheck="false" ${u.busy ? 'readonly' : ''}></div>
        ${u.error ? banner('err', 'No se pudo conectar', esc(u.error)) : ''}
        <button class="btn btn-primary btn-sm" type="submit" style="align-self:flex-start" ${u.busy ? 'disabled' : ''}>${u.busy ? '<span class="spinner"></span><span>Conectando…</span>' : `${icon('cloud', 18)}<span>Conectar</span>`}</button>
        <p class="hint">El token se guarda solo en este dispositivo y no entra en los respaldos. Tus API keys de IA tampoco se sincronizan.</p>
      </form>
    </section>`;
  }
  const st = syncStatusInfo();
  return `<section class="card stack" id="sync-card">
    <div class="row nowrap top">
      <span class="icon-tile">${icon('cloud')}</span>
      <div class="stack-xs grow"><span class="row gap-sm"><h2>Celular y computadora</h2><span class="chip ${st.cls === 'is-ok' ? 'chip-ok' : st.cls === 'is-error' ? 'chip-warn' : 'chip-accent'}">${st.label}</span></span>
        <span class="hint">Tus datos se sincronizan con tu repositorio privado de GitHub.</span></div>
    </div>
    <div class="kv"><span>Repositorio</span><a href="https://github.com/${esc(s.syncRepo)}" target="_blank" rel="noopener"><b>${esc(s.syncRepo)}</b></a></div>
    <div class="kv"><span>Última sincronización</span><b>${syncAgo(s.syncLastAt)}</b></div>
    ${st.cls === 'is-error' ? banner('err', 'No se pudo sincronizar', esc(sync.error?.message || '')) : ''}
    <label class="switch-row"><input type="checkbox" ${s.syncAuto ? 'checked' : ''} data-bind="setting-bool" data-key="syncAuto"><span class="switch" aria-hidden="true"></span>
      <span class="stack-xs"><b>Sincronizar automáticamente</b><span class="hint">Al abrir la app, unos segundos después de cada cambio y al salir.</span></span></label>
    <div class="actions">
      <button type="button" class="btn btn-primary btn-sm" data-action="sync-now" ${sync.busy ? 'disabled' : ''}>${sync.busy ? '<span class="spinner"></span><span>Sincronizando…</span>' : `${icon('sync', 18)}<span>Sincronizar ahora</span>`}</button>
      <button type="button" class="btn-link danger" data-action="sync-disconnect">Desconectar este dispositivo</button>
    </div>
  </section>`;
}

Object.assign(actions, {
  'sync-now': () => {
    if (!syncReady()) { go('ajustes'); return; }
    syncNow({ manual: true });
  },
  'sync-connect': async form => {
    const u = state.ui.syncForm;
    const repo = cleanRepo(form.elements.repo.value);
    const token = form.elements.token.value.trim();
    u.repo = form.elements.repo.value.trim();
    u.error = !/^[\w.-]+\/[\w.-]+$/.test(repo) ? 'Escribe el repositorio como usuario/nombre (por ejemplo, ana/realize-datos).'
      : !token ? 'Pega el token de GitHub.' : null;
    if (u.error) { refreshIfOn('ajustes'); return; }
    u.busy = true;
    refreshIfOn('ajustes');
    const conn = { syncRepo: repo, syncToken: token };
    try {
      const info = await ghRequest('', { settings: conn });
      if (!info.private) throw new SyncError('PUBLIC', 'Ese repositorio es público: cualquiera vería tus datos. Hazlo privado en GitHub (Settings → General → Danger Zone → Change visibility) o usa otro.');
      sync.branch = info.default_branch || 'main';
      Object.assign(state.data.settings, conn, { syncAuto: true });
      saveData(state.data);
      u.busy = false;
      const r = await syncNow();
      if (!r) {
        // Sin una primera sincronización correcta no se queda conectado (p. ej., token sin permiso de escritura).
        const err = sync.error;
        Object.assign(state.data.settings, { syncToken: '' });
        saveData(state.data);
        sync.status = 'off';
        throw err || new SyncError('UNKNOWN', 'No se pudo sincronizar.');
      }
      u.error = null;
      toast(r.pulled ? 'Conectado: se trajeron tus datos de la nube' : 'Conectado: tus datos ya están en la nube');
    } catch (e) {
      u.busy = false;
      u.error = e.message || String(e);
      sync.branch = null;
    }
    updateSyncUI();
    refreshIfOn('ajustes');
  },
  'sync-disconnect': async () => {
    if (!confirm('¿Desconectar este dispositivo? Tus datos se quedan aquí y en GitHub; solo deja de sincronizarse.')) return;
    if (sync.dirty) await syncNow();
    Object.assign(state.data.settings, { syncToken: '', syncLastAt: null });
    saveData(state.data);
    await clearBase();
    Object.assign(sync, { status: 'off', error: null, dirty: false, branch: null });
    clearTimeout(sync.timer);
    state.ui.syncForm = null;
    updateSyncUI();
    toast('Este dispositivo ya no se sincroniza');
    refreshIfOn('ajustes');
  },
});
