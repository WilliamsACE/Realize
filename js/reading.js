'use strict';
/* =========================================================
   Módulo "Preparar una lectura"
   1. Librerías bajo demanda (PDF.js, JSZip, mammoth.js) desde jsDelivr, versión fija
   2. Lectura de archivos: PDF, EPUB, DOCX, TXT y texto pegado — todo en el navegador
   3. Segmentación: páginas, capítulos, secciones, bloques o fragmento pegado
   4. Detección de palabras difíciles sin IA (lista NGSL de wordlist.js) y de
      expresiones de varias palabras: phrasal verbs y modismos (phrases.js)
   5. Segmentos, triage y vínculo con el estudio
   6. Vistas: lecturas, libro, segmento, triage, glosario, captura y pruebas
   7. Acciones, bindings y registro en el router (js/ui/router.js)
   El texto del libro nunca sale del navegador: a la IA solo se envían las
   palabras en estudio y, para elegir el sentido correcto, su oración de contexto.
   ========================================================= */

/* ===================== 1. Librerías ===================== */

const LIBS = {
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js',
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
};

class ReadingError extends Error {}

const scriptPromises = {};
function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!scriptPromises[url]) {
    scriptPromises[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new ReadingError(`La librería ${globalName} no se inicializó.`)));
      s.onerror = () => {
        delete scriptPromises[url];
        s.remove();
        reject(new ReadingError(`No se pudo cargar ${globalName} desde el CDN. Revisa tu conexión a internet.`));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromises[url];
}

// PDF.js solo se distribuye como módulo ES: se importa dinámicamente.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(LIBS.pdfjs)
      .then(m => { m.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker; return m; })
      .catch(() => { pdfjsPromise = null; throw new ReadingError('No se pudo cargar PDF.js desde el CDN. Revisa tu conexión a internet.'); });
  }
  return pdfjsPromise;
}

/* ===================== 2. Lectura de archivos ===================== */

const WORD_RE = /\p{L}+(?:['’]\p{L}+)*/gu;
const countWords = text => (String(text || '').match(WORD_RE) || []).length;
const stripExt = name => String(name || 'Libro').replace(/\.[^.]+$/, '');

// Convierte HTML/XHTML en texto plano conservando los saltos de párrafo.
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'tr', 'br', 'hr', 'pre', 'dd', 'dt', 'figcaption', 'header', 'footer', 'aside', 'table']);
function htmlToText(node) {
  let out = '';
  const walk = n => {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = (n.localName || '').toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'head' || tag === 'title') return;
    const block = BLOCK_TAGS.has(tag);
    if (block) out += '\n\n';
    for (const c of n.childNodes) walk(c);
    if (block) out += '\n\n';
  };
  walk(node);
  return out.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* PDF: una unidad por página. Si casi no hay letras, el PDF es una imagen escaneada. */
async function parsePdf(file, onProgress) {
  const pdfjs = await loadPdfjs();
  let doc;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    doc = await task.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new ReadingError('El PDF está protegido con contraseña.');
    throw new ReadingError(`No se pudo abrir el PDF: ${e?.message || e}`);
  }
  const units = [];
  let letters = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let text = '';
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      text += it.str + (it.hasEOL ? '\n' : '');
    }
    // Une palabras cortadas con guion al final de línea y los saltos de línea simples.
    text = text.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2').replace(/\n(?!\n)/g, ' ').replace(/[ \t]+/g, ' ').trim();
    letters += (text.match(/\p{L}/gu) || []).length;
    units.push({ id: 'p' + i, title: `Página ${i}`, loc: `p. ${i}`, text });
    page.cleanup?.();
    onProgress?.(i, doc.numPages);
  }
  const meta = await doc.getMetadata().catch(() => null);
  await task.destroy?.().catch?.(() => {});
  if (letters < Math.max(40, units.length * 20)) {
    throw new ReadingError('Este PDF parece escaneado: no tiene texto que se pueda extraer. Los PDF escaneados (imágenes) no están soportados.');
  }
  return { title: String(meta?.info?.Title || '').trim() || stripExt(file.name), format: 'pdf', kind: 'pages', units };
}

const parseXml = str => new DOMParser().parseFromString(str, 'application/xml');
function parseXhtml(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xhtml+xml');
  return doc.getElementsByTagName('parsererror').length ? new DOMParser().parseFromString(str, 'text/html') : doc;
}
// Resuelve rutas relativas dentro del EPUB ("../Text/ch1.xhtml#x" → "OEBPS/Text/ch1.xhtml").
function resolvePath(baseDir, href) {
  const clean = decodeURIComponent(String(href || '').split('#')[0]);
  const parts = (baseDir + clean).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}
const dirOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
async function zipText(zip, path) {
  let f = zip.file(path);
  if (!f) { const lower = path.toLowerCase(); f = zip.file(new RegExp(`^${escapeRe(lower)}$`, 'i'))[0]; }
  return f ? f.async('string') : null;
}

/* EPUB: capítulos según el índice (nav de EPUB 3 o NCX de EPUB 2); cada capítulo
   abarca desde su archivo hasta el archivo del siguiente capítulo en el spine. */
async function parseEpub(file) {
  const JSZip = await loadScript(LIBS.jszip, 'JSZip');
  let zip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new ReadingError('El archivo EPUB está dañado o no es un EPUB.'); }
  const container = await zipText(zip, 'META-INF/container.xml');
  const opfPath = container && parseXml(container).getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new ReadingError('El EPUB no es válido (no se encontró su paquete OPF).');
  const opf = parseXml(await zipText(zip, opfPath) || '');
  const base = dirOf(opfPath);
  const manifest = new Map();
  for (const it of opf.getElementsByTagName('item')) {
    manifest.set(it.getAttribute('id'), { href: resolvePath(base, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  }
  const spineEl = opf.getElementsByTagName('spine')[0];
  const spine = [...opf.getElementsByTagName('itemref')].map(r => manifest.get(r.getAttribute('idref'))).filter(it => it && /html/.test(it.type));
  if (!spine.length) throw new ReadingError('El EPUB no tiene capítulos legibles.');
  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || stripExt(file.name);

  // Índice: EPUB 3 (nav) o EPUB 2 (NCX).
  let toc = [];
  const navItem = [...manifest.values()].find(it => /\bnav\b/.test(it.props));
  if (navItem) {
    const doc = parseXhtml(await zipText(zip, navItem.href) || '');
    const navs = [...doc.getElementsByTagName('nav')];
    const nav = navs.find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0];
    if (nav) toc = [...nav.getElementsByTagName('a')].map(a => ({ title: a.textContent.replace(/\s+/g, ' ').trim(), href: resolvePath(dirOf(navItem.href), a.getAttribute('href')) }));
  }
  if (!toc.length) {
    const ncx = manifest.get(spineEl?.getAttribute('toc')) || [...manifest.values()].find(it => it.type === 'application/x-dtbncx+xml');
    if (ncx) {
      const doc = parseXml(await zipText(zip, ncx.href) || '');
      toc = [...doc.getElementsByTagName('navPoint')].map(np => ({
        title: np.getElementsByTagName('text')[0]?.textContent.replace(/\s+/g, ' ').trim(),
        href: resolvePath(dirOf(ncx.href), np.getElementsByTagName('content')[0]?.getAttribute('src')),
      }));
    }
  }

  const texts = await Promise.all(spine.map(async it => htmlToText(parseXhtml(await zipText(zip, it.href) || '<html/>').documentElement)));
  const starts = [];
  for (const t of toc) {
    const idx = spine.findIndex(it => it.href === t.href);
    if (idx >= 0 && !starts.some(s => s.idx === idx)) starts.push({ idx, title: t.title || `Capítulo ${starts.length + 1}` });
  }
  starts.sort((a, b) => a.idx - b.idx);
  let units;
  if (starts.length) {
    units = [];
    if (starts[0].idx > 0) {
      const pre = texts.slice(0, starts[0].idx).join('\n\n');
      if (countWords(pre) > 80) units.push({ title: 'Inicio', text: pre });
    }
    starts.forEach((s, i) => units.push({ title: s.title, text: texts.slice(s.idx, starts[i + 1]?.idx ?? texts.length).join('\n\n') }));
  } else {
    units = texts.map((text, i) => ({ title: (text.split('\n')[0] || '').slice(0, 60) || `Sección ${i + 1}`, text }));
  }
  units = units.filter(u => countWords(u.text) > 0).map((u, i) => ({ id: 'c' + i, title: u.title, loc: u.title, text: u.text }));
  if (!units.length) throw new ReadingError('No se encontró texto en el EPUB.');
  return { title, format: 'epub', kind: 'chapters', units };
}

/* Encabezados en texto plano: "Chapter 1", "# Título", líneas cortas en MAYÚSCULAS. */
function splitByHeadings(text) {
  const lines = text.split('\n');
  const sections = [];
  let cur = { title: 'Inicio', lines: [] };
  const isHeading = (line, prevBlank, nextBlank) => {
    const t = line.trim();
    if (!t || t.length > 80) return false;
    if (/^#{1,3}\s+\S/.test(t)) return true;
    if (/^(chapter|cap[ií]tulo|part|parte|book|prologue|pr[oó]logo|epilogue|ep[ií]logo|introduction|preface|interlude)\b/i.test(t) && t.split(/\s+/).length <= 10) return prevBlank;
    return prevBlank && nextBlank && t === t.toUpperCase() && /\p{Lu}/u.test(t) && t.split(/\s+/).length <= 8 && !/[.!?,;:]$/.test(t);
  };
  lines.forEach((line, i) => {
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextBlank = i === lines.length - 1 || !lines[i + 1].trim();
    if (isHeading(line, prevBlank, nextBlank)) {
      sections.push(cur);
      cur = { title: line.trim().replace(/^#+\s*/, ''), lines: [] };
    } else cur.lines.push(line);
  });
  sections.push(cur);
  return sections.map(s => ({ title: s.title, text: s.lines.join('\n').trim() })).filter(s => countWords(s.text) > 0);
}

function makeTextBook(raw, title, format) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!countWords(text)) throw new ReadingError('El texto está vacío.');
  const secs = splitByHeadings(text);
  if (secs.length >= 2) {
    return { title, format, kind: 'sections', units: secs.map((s, i) => ({ id: 's' + i, title: s.title, loc: s.title, text: s.text })) };
  }
  return { title, format, kind: 'plain', units: [{ id: 'all', title: 'Texto completo', loc: '', text }] };
}

/* DOCX: mammoth convierte a HTML; los h1–h3 definen secciones. */
async function parseDocx(file) {
  const mammoth = await loadScript(LIBS.mammoth, 'mammoth');
  let html;
  try { html = (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value; }
  catch (e) { throw new ReadingError(`No se pudo leer el DOCX: ${e?.message || e}`); }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sections = [];
  let cur = { title: 'Inicio', parts: [] };
  for (const el of doc.body.children) {
    if (/^H[1-3]$/.test(el.tagName)) {
      sections.push(cur);
      cur = { title: el.textContent.trim() || 'Sección', parts: [] };
    } else cur.parts.push(htmlToText(el));
  }
  sections.push(cur);
  const secs = sections.map(s => ({ title: s.title, text: s.parts.join('\n\n').trim() })).filter(s => countWords(s.text) > 0);
  const title = stripExt(file.name);
  if (!secs.length) throw new ReadingError('El DOCX no tiene texto.');
  if (secs.length >= 2) return { title, format: 'docx', kind: 'sections', units: secs.map((s, i) => ({ id: 's' + i, title: s.title, loc: s.title, text: s.text })) };
  return { title, format: 'docx', kind: 'plain', units: [{ id: 'all', title: 'Texto completo', loc: '', text: secs.map(s => s.text).join('\n\n') }] };
}

async function saveBook(parsed) {
  const book = {
    id: uid(), title: parsed.title || 'Sin título', format: parsed.format, kind: parsed.kind,
    unitCount: parsed.units.length, wordCount: parsed.units.reduce((n, u) => n + countWords(u.text), 0), createdAt: Date.now(),
  };
  state.lib.books.push(book);
  textCache.set(book.id, parsed.units);
  await libSave('books', book);
  await libSave('texts', { id: book.id, units: parsed.units });
  return book;
}

const textCache = new Map(); // textos ya cargados de IndexedDB (o en memoria si no hay IndexedDB)
async function loadUnits(bookId) {
  if (textCache.has(bookId)) return textCache.get(bookId);
  const rec = state.lib.available ? await idbGet('texts', bookId).catch(() => null) : null;
  const units = rec?.units || [];
  textCache.set(bookId, units);
  return units;
}

/* ===================== 3. Segmentación ===================== */

// Divide en oraciones respetando abreviaturas comunes (Mr., Dr., etc.).
const ABBREV = /^(mr|mrs|ms|dr|st|jr|sr|prof|vs|etc|e\.g|i\.e|no|vol|ch|fig|mt|capt|col|gen|lt|sgt|rev)\.$/i;
function splitSentences(text) {
  const out = [];
  for (const para of String(text).split(/\n\s*\n/)) {
    const t = para.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    let start = 0;
    const re = /[.!?…]+["'”’)\]]*\s+/g;
    let m;
    while ((m = re.exec(t))) {
      const end = m.index + m[0].length;
      const lastWord = (t.slice(start, m.index + 1).match(/(\S+)$/) || [''])[0];
      if (ABBREV.test(lastWord)) continue;
      if (/\p{Ll}/u.test(t[end] || '')) continue; // sigue en minúscula: no es fin de oración
      out.push(t.slice(start, end).trim());
      start = end;
    }
    if (start < t.length) out.push(t.slice(start).trim());
  }
  return out;
}

// Bloques de ~N palabras cortando en párrafos (o en oraciones si un párrafo es enorme).
function chunkText(text, size) {
  let pieces = String(text).split(/\n\s*\n/).filter(p => p.trim());
  if (pieces.some(p => countWords(p) > size * 1.5)) pieces = pieces.flatMap(p => (countWords(p) > size * 1.5 ? splitSentences(p) : [p]));
  const blocks = [];
  let cur = [], count = 0, start = 1;
  const flush = () => {
    if (!cur.length) return;
    const i = blocks.length;
    blocks.push({ id: 'b' + i, title: `Bloque ${i + 1}`, loc: `Bloque ${i + 1}`, text: cur.join('\n\n'), from: start, to: start + count - 1, words: count });
    start += count; cur = []; count = 0;
  };
  for (const p of pieces) {
    cur.push(p);
    count += countWords(p);
    if (count >= size) flush();
  }
  // Un último bloque muy corto se une al anterior.
  if (cur.length && blocks.length && count < size * 0.3) {
    const last = blocks[blocks.length - 1];
    last.text += '\n\n' + cur.join('\n\n'); last.to += count; last.words += count; cur = [];
  }
  flush();
  return blocks;
}

function defaultSelection(book, units) {
  const sel = { from: 1, to: Math.min(units.length, 20), ids: [], blockSize: state.data.settings.blockWords, fragment: '' };
  if (book.kind === 'chapters' || book.kind === 'sections') sel.ids = units[0] ? [units[0].id] : [];
  if (book.kind === 'plain') sel.ids = ['b0'];
  return sel;
}

// Unidades de texto ({ text, loc }) de la selección actual y un título sugerido.
function selectionUnits(bs) {
  const { book, units, sel } = bs;
  if (sel.fragment.trim()) return { units: [{ text: sel.fragment, loc: 'Fragmento' }], title: 'Fragmento' };
  if (book.kind === 'pages') {
    const from = Math.max(1, Math.min(sel.from, units.length));
    const to = Math.max(from, Math.min(sel.to, units.length));
    return { units: units.slice(from - 1, to), title: from === to ? `Página ${from}` : `Páginas ${from}–${to}` };
  }
  const list = book.kind === 'plain' ? chunkText(units[0]?.text || '', sel.blockSize) : units;
  const chosen = list.filter(u => sel.ids.includes(u.id));
  const title = !chosen.length ? '' : chosen.length === 1 ? chosen[0].title : `${chosen[0].title} – ${chosen[chosen.length - 1].title}`;
  return { units: chosen, title };
}

/* ===================== 4. Detección de palabras difíciles ===================== */

// Mapa forma → lema a partir de la lista NGSL (wordlist.js).
let COMMON = null;
function commonMap() {
  if (!COMMON) {
    COMMON = new Map();
    for (const fam of String(window.COMMON_WORDS_RAW || '').split('|')) {
      const forms = fam.split(' ');
      for (const f of forms) if (f && !COMMON.has(f)) COMMON.set(f, forms[0]);
    }
  }
  return COMMON;
}

// Quita contracciones y posesivos: don't → do, she'll → she, John's → john.
function baseToken(raw) {
  let w = raw.toLowerCase().replace(/’/g, "'");
  if (w === "can't") return 'can';
  if (w === "won't") return 'will';
  if (w === "shan't") return 'shall';
  if (w === "ain't") return 'be';
  const m = w.match(/^(.+?)(?:n't|'s|'re|'ll|'ve|'d|'m)$/);
  if (m) w = m[1];
  if (w.includes("'")) w = w.split("'").sort((a, b) => b.length - a.length)[0]; // o'clock → clock
  return w;
}

/* Posibles formas base de una palabra (plural, -ed, -ing). Solo se usan para
   agrupar palabras raras entre sí: las comunes ya traen todas sus formas en la NGSL. */
const DOUBLED = /([bdgklmnprtvz])\1$/;
// ¿El verbo base probablemente termina en -e? (thriving → thrive, glimpsed → glimpse)
const preferE = b => /([vzcu]|[^aeious]s|[dr]g|at|iz|ys|ur|ir|[^e]ar)$/.test(b) || (b.length <= 4 && /[^aeiou][aeiou][^aeiouwxy]$/.test(b));
function lemmaGuesses(w) {
  const g = [];
  const n = w.length;
  if (n > 4 && w.endsWith('ies')) g.push(w.slice(0, -3) + 'y');
  if (n > 4 && /(s|x|z|ch|sh)es$/.test(w)) g.push(w.slice(0, -2));
  if (n > 3 && w.endsWith('s') && !/(ss|us|is|os|as)$/.test(w)) g.push(w.slice(0, -1));
  if (n > 4 && w.endsWith('ied')) g.push(w.slice(0, -3) + 'y');
  for (const suf of ['ed', 'ing']) {
    if (n > suf.length + 2 && w.endsWith(suf)) {
      const b = w.slice(0, -suf.length);
      if (DOUBLED.test(b)) g.push(b.slice(0, -1));
      if (preferE(b)) g.push(b + 'e', b); else g.push(b, b + 'e');
    }
  }
  return [...new Set(g)].filter(x => x.length >= 3 && x !== w);
}
// Sin otra forma en el texto, solo se quitan plurales simples y consonantes dobles.
function defaultLemma(w, common) {
  let out = w;
  if (w.length > 4 && w.endsWith('s') && !/(ss|us|is|os|as|ies)$/.test(w)) out = w.slice(0, -1);
  else for (const suf of ['ed', 'ing']) {
    const b = w.slice(0, -suf.length);
    if (w.endsWith(suf) && b.length >= 4 && DOUBLED.test(b)) out = b.slice(0, -1);
  }
  return common.has(out) ? w : out;
}
// Agrupa formas raras del texto en lemas: usa la forma base si aparece, o una base compartida.
function groupForms(forms, common) {
  const set = new Set(forms);
  const guesses = new Map(forms.map(f => [f, lemmaGuesses(f)]));
  const shared = new Map();
  for (const gs of guesses.values()) for (const g of gs) shared.set(g, (shared.get(g) || 0) + 1);
  const key = new Map();
  for (const f of forms) {
    const gs = guesses.get(f);
    key.set(f, gs.find(g => set.has(g)) || gs.find(g => shared.get(g) >= 2 && !common.has(g)) || defaultLemma(f, common));
  }
  const resolve = (f, depth = 0) => {
    const k = key.get(f);
    return k && k !== f && set.has(k) && depth < 4 ? resolve(k, depth + 1) : k || f;
  };
  return new Map(forms.map(f => [f, resolve(f)]));
}

/* ---------- Expresiones de varias palabras (phrases.js) ---------- */
const PARTICLES = new Set(['up', 'down', 'off', 'out', 'in', 'on', 'away', 'back', 'over', 'around', 'round', 'through', 'about', 'along', 'aside', 'apart', 'forward', 'together']);
const OBJ_PRONOUNS = new Set(['it', 'him', 'her', 'them', 'me', 'us', 'you', 'this', 'that', 'these', 'those', 'everything', 'something', 'anything', 'nothing', 'everyone', 'someone', 'one']);
const DETERMINERS = new Set(['the', 'a', 'an', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'some', 'any', 'every', 'each']);
const POSSESSIVES = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their', "one's"]);

// Índice: forma base de la primera palabra → expresiones que empiezan con ella.
let PHRASES = null;
function phraseIndex() {
  if (!PHRASES) {
    PHRASES = new Map();
    const common = commonMap();
    for (const raw of String(window.PHRASES_RAW || '').split('\n')) {
      const line = raw.trim().toLowerCase();
      if (!line || line.startsWith('#')) continue;
      const closes = line.endsWith('$');
      const lemma = line.replace(/\$$/, '').trim();
      const words = lemma.split(/[\s-]+/);
      const head = common.get(words[0]) || words[0];
      const p = { lemma, words, closes, separable: words.length === 2 && PARTICLES.has(words[1]) };
      (PHRASES.get(head) || PHRASES.set(head, []).get(head)).push(p);
    }
  }
  return PHRASES;
}

/* ¿La expresión p empieza en el token i? La primera palabra ya coincide (por su lema).
   Devuelve los tokens que la forman y su texto, o null. */
function matchPhraseAt(sent, toks, i, p) {
  const w = p.words;
  const lit = (t, word) => !!t && (word === "one's" ? POSSESSIVES.has(t.low) || t.low.endsWith("'s") : t.low === word);
  const between = (a, b) => sent.slice(a.end, b.start);
  const span = (a, b) => sent.slice(toks[a].start, toks[b].end).toLowerCase().replace(/’/g, "'");
  // Seguidas, separadas solo por espacios o guion ("off-putting").
  let ok = true;
  for (let j = 1; j < w.length && ok; j++) ok = lit(toks[i + j], w[j]) && /^[\s-]+$/.test(between(toks[i + j - 1], toks[i + j]));
  if (ok) {
    const end = i + w.length;
    const next = toks[end];
    // "to boot$": solo si cierra la frase (no "to boot the computer").
    if (!p.closes || !next || /[,;:.!?…—–()"“”]/.test(between(toks[end - 1], next))) {
      return { tokens: Array.from({ length: w.length }, (_, j) => i + j), surface: span(i, end - 1) };
    }
  }
  if (!p.separable) return null;
  // Phrasal verb separado por un objeto corto: "put it off", "turned the offer down".
  for (let g = 1; g <= 3; g++) {
    const k = i + 1 + g;
    const part = toks[k];
    if (!part) break;
    if (/[^\p{L}\s'’-]/u.test(between(toks[i], part))) break;   // hay puntuación en medio
    if (part.low !== w[1]) continue;
    const gap = toks.slice(i + 1, k);
    const gapOk = g === 1 ? OBJ_PRONOUNS.has(gap[0].low) : DETERMINERS.has(gap[0].low) && !gap.some(t => PARTICLES.has(t.low));
    if (!gapOk) continue;
    // Si a la partícula le sigue otro objeto es una preposición: "put my hand on the table".
    const next = toks[k + 1];
    if (next && /^\s+$/.test(between(part, next)) && (DETERMINERS.has(next.low) || OBJ_PRONOUNS.has(next.low))) return null;
    return { tokens: [i, k], surface: g === 1 ? span(i, k) : '' };
  }
  return null;
}

// Busca expresiones en una oración ya tokenizada; prefiere la más larga en cada posición.
function findPhrases(sent, toks) {
  const idx = phraseIndex(), common = commonMap(), out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].low;
    let best = null;
    for (const h of new Set([common.get(t) || t, t, ...lemmaGuesses(t)])) {
      for (const p of idx.get(h) || []) {
        if (best && p.words.length <= best.p.words.length) continue;
        const m = matchPhraseAt(sent, toks, i, p);
        if (m) best = { p, ...m };
      }
    }
    if (!best) continue;
    out.push(best);
    if (best.tokens.length === best.p.words.length) i = best.tokens[best.tokens.length - 1];
  }
  return out;
}

// Recorta oraciones muy largas alrededor de la palabra.
function clipAround(text, forms) {
  if (text.length <= 260) return text;
  const lower = text.toLowerCase();
  const idx = Math.max(0, Math.min(...forms.map(f => { const i = lower.indexOf(f); return i < 0 ? Infinity : i; })));
  const i = Number.isFinite(idx) ? idx : 0;
  let a = Math.max(0, i - 120), b = Math.min(text.length, i + 140);
  if (a > 0) a = text.indexOf(' ', a) + 1;
  if (b < text.length) b = text.lastIndexOf(' ', b);
  return (a > 0 ? '…' : '') + text.slice(a, b).trim() + (b < text.length ? '…' : '');
}

function pickExamples(sents, forms) {
  const scored = sents.map(s => {
    const n = countWords(s.text);
    return { s, score: (n >= 6 && n <= 30 ? 0 : Math.abs(n - 18)) + (s.text.length > 260 ? 5 : 0) };
  }).sort((a, b) => a.score - b.score);
  const out = [];
  for (const { s } of scored) {
    if (out.length >= 2) break;
    const text = clipAround(s.text, forms);
    if (!out.some(o => o.text === text)) out.push({ text, loc: s.loc });
  }
  return out;
}

/**
 * Analiza el texto del segmento: tokeniza, descarta palabras comunes (NGSL),
 * nombres propios, números y siglas, agrupa formas y ordena por frecuencia.
 * Además detecta expresiones (phrasal verbs y modismos) aunque sus palabras sean comunes.
 * @param {{text:string, loc:string}[]} units
 */
function analyzeUnits(units) {
  const common = commonMap();
  const stats = new Map();      // forma → { total, lower, capStart, capMid, caps }
  const formSents = new Map();  // forma → índices de oraciones (máx. 8)
  const phraseHits = new Map(); // expresión → { freq, forms, sentIdx }
  const sentences = [];
  let wordCount = 0;
  for (const u of units) {
    for (const sent of splitSentences(u.text)) {
      const si = sentences.length;
      sentences.push({ text: sent, loc: u.loc || '' });
      const toks = [...sent.matchAll(WORD_RE)].map(m => ({ raw: m[0], low: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length }));
      const inPhrase = new Map();   // índice de token → expresión que lo contiene
      for (const m of findPhrases(sent, toks)) {
        let e = phraseHits.get(m.p.lemma);
        if (!e) phraseHits.set(m.p.lemma, (e = { freq: 0, forms: new Map(), sentIdx: [] }));
        e.freq++;
        if (m.surface) e.forms.set(m.surface, (e.forms.get(m.surface) || 0) + 1);
        if (e.sentIdx.length < 12 && e.sentIdx[e.sentIdx.length - 1] !== si) e.sentIdx.push(si);
        for (const k of m.tokens) inPhrase.set(k, m.p.lemma);
      }
      let first = true;
      for (const [ti, { raw }] of toks.entries()) {
        wordCount++;
        const form = baseToken(raw);
        if (form.length < 2 && form !== 'a' && form !== 'i') { first = false; continue; }
        let st = stats.get(form);
        if (!st) stats.set(form, (st = { total: 0, lower: 0, capStart: 0, capMid: 0, caps: 0, inPhrase: 0, phrase: '' }));
        st.total++;
        if (inPhrase.has(ti)) { st.inPhrase++; st.phrase = inPhrase.get(ti); }
        const c0 = raw[0];
        if (raw.length > 1 && raw === raw.toUpperCase()) st.caps++;
        else if (c0 === c0.toLowerCase()) st.lower++;
        else if (first) st.capStart++;
        else st.capMid++;
        first = false;
        const list = formSents.get(form) || formSents.set(form, []).get(form);
        if (list.length < 8 && list[list.length - 1] !== si) list.push(si);
      }
    }
  }

  let totalTokens = 0, baseKnown = 0;
  const rareForms = new Map();
  const phraseRare = new Map();  // expresión → ocurrencias de palabras raras que solo aparecen dentro de ella
  for (const [form, st] of stats) {
    totalTokens += st.total;
    const capTotal = st.capStart + st.capMid;
    // Nombre propio: casi nunca en minúscula y con mayúscula sobre todo a mitad de oración,
    // o que aparece varias veces y siempre con mayúscula inicial.
    const proper = (st.capMid > 0 && st.lower <= st.total * 0.1 && st.capMid / capTotal > 0.5)
      || (st.lower === 0 && st.caps === 0 && capTotal >= 2);
    const acronym = st.caps === st.total && (form.length <= 5 || /^[ivxlcdm]+$/.test(form));
    if (common.has(form) || proper || acronym || form.length < 3) { baseKnown += st.total; continue; }
    // "fend" en "fended off": si solo aparece dentro de la expresión, se estudia la expresión.
    if (st.inPhrase === st.total) { phraseRare.set(st.phrase, (phraseRare.get(st.phrase) || 0) + st.total); continue; }
    rareForms.set(form, st.total);
  }

  const keyOf = groupForms([...rareForms.keys()], common);
  const lemmas = new Map();
  for (const [form, n] of rareForms) {
    const k = keyOf.get(form);
    if (common.has(k)) { baseKnown += n; continue; }
    let e = lemmas.get(k);
    if (!e) lemmas.set(k, (e = { lemma: k, freq: 0, forms: new Map(), sentIdx: [] }));
    e.freq += n;
    e.lower = (e.lower || 0) + (stats.get(form)?.lower || 0);   // veces que apareció en minúscula
    e.forms.set(form, n);
    for (const si of formSents.get(form) || []) if (e.sentIdx.length < 12 && !e.sentIdx.includes(si)) e.sentIdx.push(si);
  }

  const toCand = (e, phrase) => {
    const forms = [...e.forms.entries()].sort((a, b) => b[1] - a[1]).map(f => f[0]);
    const sents = e.sentIdx.sort((a, b) => a - b).map(i => sentences[i]);
    return {
      lemma: e.lemma, forms, freq: e.freq, ...(phrase ? { phrase: true } : e.lower === 0 ? { capOnly: true } : {}),
      locs: [...new Set(sents.map(s => s.loc).filter(Boolean))].slice(0, 5),
      examples: pickExamples(sents, forms),
    };
  };
  // Con la misma frecuencia, las expresiones van primero: son las más fáciles de pasar por alto.
  const cands = [...[...lemmas.values()].map(e => toCand(e, false)), ...[...phraseHits].map(([lemma, e]) => toCand({ lemma, ...e }, true))]
    .sort((a, b) => b.freq - a.freq || (b.phrase ? 1 : 0) - (a.phrase ? 1 : 0) || a.lemma.localeCompare(b.lemma));
  const rare = Object.fromEntries([...[...lemmas.values()].map(e => [e.lemma, e.freq]), ...phraseRare]);
  return { wordCount, totalTokens, baseKnown, rare, cands };
}

/* ===================== 5. Segmentos y triage ===================== */

// Índice lema → palabra en estudio (incluye la forma de diccionario).
function studyIndex() {
  const m = new Map();
  for (const w of state.data.words) { m.set(lemmaOf(w), w); m.set(normalize(w.word), w); }
  return m;
}
const studyWordFor = (idx, lemma) => idx.get(lemma) || lemmaVariants(lemma).map(v => idx.get(v)).find(Boolean) || null;

function linkWordToSegment(w, segId, cand) {
  if (!w.segIds.includes(segId)) w.segIds.push(segId);
  for (const f of cand.forms) if (!w.forms.includes(f) && w.forms.length < 12) w.forms.push(f);
  for (const ex of cand.examples) {
    if (w.contexts.length < 3 && !w.contexts.some(c => c.text === ex.text)) w.contexts.push({ text: ex.text, loc: ex.loc, segId });
  }
  w.freq = Math.max(w.freq || 0, cand.freq);
}

// Crea (o reutiliza) la palabra en estudio. stage 2 = "Me suena": salta la exposición.
function addStudyWord(seg, cand, stage) {
  let w = studyWordFor(studyIndex(), cand.lemma);
  if (!w) {
    w = createWord({ word: cand.lemma, lemma: cand.lemma });
    w.source = 'reading';
    w.stage = stage;
    state.data.words.push(w);
    const cached = state.lib.aiCache.get(cand.lemma);
    if (cached) applyContent(w, cached.content);
  }
  linkWordToSegment(w, seg.id, cand);
  persist();
  return w;
}

// Modo automático: intensivo para las 10 palabras en estudio más frecuentes.
function computeAutoTop(seg) {
  return rankedCands(seg).filter(c => ['familiar', 'unknown', 'studying'].includes(c.status))
    .slice(0, AUTO_INTENSIVE_TOP).map(c => c.lemma);
}

function createSegment(bs) {
  const p = bs.preview;
  const idx = studyIndex();
  const id = uid();
  const candidates = p.analysis.cands.filter(c => !knownRecord(c.lemma)).map(c => ({ ...c, status: studyWordFor(idx, c.lemma) ? 'studying' : 'pending' }));
  const seg = {
    id, bookId: bs.book.id, title: (bs.title || '').trim() || p.title || 'Lectura', createdAt: Date.now(),
    sel: { ...bs.sel, fragment: bs.sel.fragment ? '(fragmento)' : '' }, mode: bs.mode,
    wordCount: p.analysis.wordCount, totalTokens: p.analysis.totalTokens, baseKnown: p.analysis.baseKnown, rare: p.analysis.rare,
    candidates, history: [], tests: [], autoTop: [],
  };
  // Las palabras que ya estudias (por ejemplo, de otro libro) se vinculan a este segmento.
  for (const c of candidates) if (c.status === 'studying') linkWordToSegment(studyWordFor(idx, c.lemma), id, c);
  seg.autoTop = computeAutoTop(seg);
  state.lib.segments.push(seg);
  libSaveSegment(seg);
  if (bs.sel.fragment.trim()) libSave('texts', { id: 'frag:' + id, units: [{ id: 'frag', title: 'Fragmento', loc: 'Fragmento', text: bs.sel.fragment }] });
  persist();
  return seg;
}

/* Estado visible de una candidata, combinando la decisión del triage con el
   vocabulario global y el progreso de estudio. */
function candState(c, idx) {
  const k = knownRecord(c.lemma);
  const w = studyWordFor(idx, c.lemma);
  if (k?.status === 'mastered' || (w && isMastered(w))) return { key: 'mastered', label: 'Dominada', cls: 'chip-ok' };
  if (k?.status === 'learned' || (w && isLearned(w))) return { key: 'learned', label: 'Aprendida', cls: 'chip-ok' };
  if (k) return { key: 'known', label: 'La sé', cls: 'chip-ok' };
  if (w) {
    const label = c.status === 'familiar' ? 'Me suena' : c.status === 'unknown' ? 'No la sé' : 'En estudio';
    return { key: c.status === 'familiar' ? 'familiar' : c.status === 'unknown' ? 'unknown' : 'studying', label: `${label} · ${isStudyReady(w) ? (isNew(w) ? 'nueva' : STAGES[w.stage].toLowerCase()) : 'sin significado'}`, cls: 'chip-accent' };
  }
  if (c.status === 'skipped') return { key: 'skipped', label: 'Descartada', cls: '' };
  return { key: 'pending', label: 'Sin revisar', cls: '' };
}

function segmentStats(seg) {
  const idx = studyIndex();
  const out = { total: seg.candidates.length, pending: 0, known: 0, familiar: 0, unknown: 0, studying: 0, learned: 0, waiting: 0 };
  for (const c of seg.candidates) {
    const st = candState(c, idx).key;
    if (st === 'pending') out.pending++;
    else if (st === 'known') out.known++;
    else if (st === 'learned' || st === 'mastered') out.learned++;
    else out[st]++;
  }
  const words = segWords(seg);
  out.waiting = words.filter(w => !isStudyReady(w)).length;
  out.due = words.filter(w => isStudyReady(w) && isDueToday(w)).length;
  out.fresh = words.filter(w => isStudyReady(w) && isNew(w)).length;
  out.ready = words.filter(isStudyReady).length;
  return out;
}
const segWords = seg => state.data.words.filter(w => w.segIds.includes(seg.id));

// La siguiente palabra por revisar: la más importante que quede (no la más frecuente).
const nextPending = (seg, idx = studyIndex()) => rankedCands(seg).find(c => c.status === 'pending' && candState(c, idx).key === 'pending');

function triageDecide(seg, cand, decision) {
  seg.history.push({ lemma: cand.lemma, prev: cand.status, decision });
  seg.history = seg.history.slice(-40);
  cand.status = decision;
  if (decision === 'known') libMarkKnown(cand.lemma, 'known', 'triage');
  else if (decision !== 'skipped') addStudyWord(seg, cand, decision === 'familiar' ? 2 : 1);   // «skipped»: no se estudia
  seg.autoTop = computeAutoTop(seg);
  libSaveSegment(seg);
}

function triageUndo(seg) {
  const h = seg.history.pop();
  if (!h) return;
  const cand = seg.candidates.find(c => c.lemma === h.lemma);
  if (!cand) return;
  if (h.decision === 'known') {
    const rec = state.lib.known.get(cand.lemma);
    if (rec?.source === 'triage') libUnmarkKnown(cand.lemma);
  } else {
    // Solo se borra la palabra si se creó en este triage y todavía no se estudió.
    const w = studyWordFor(studyIndex(), cand.lemma);
    if (w && !w.introducedAt && w.source === 'reading' && w.segIds.length === 1 && w.segIds[0] === seg.id) {
      state.data.words = state.data.words.filter(x => x.id !== w.id);
      persist();
    }
  }
  cand.status = h.prev;
  seg.autoTop = computeAutoTop(seg);
  libSaveSegment(seg);
}

function deleteSegment(seg) {
  state.lib.segments = state.lib.segments.filter(s => s.id !== seg.id);
  libDelete('segments', seg.id);
  libDelete('texts', 'frag:' + seg.id);
  for (const w of state.data.words) w.segIds = w.segIds.filter(id => id !== seg.id);
  persist();
}

/* ===================== 6. Vistas ===================== */

const FORMAT_LABEL = { pdf: 'PDF', epub: 'EPUB', docx: 'DOCX', txt: 'TXT', paste: 'Texto pegado' };
const KIND_UNIT = { pages: ['página', 'páginas'], chapters: ['capítulo', 'capítulos'], sections: ['sección', 'secciones'], plain: ['texto', 'textos'] };
const MODE_INFO = {
  relaxed: { title: 'Relajado', text: 'Reconocer la palabra al leer. Tarjeta, opción múltiple y a veces escribirla. 5–10 min.' },
  intensive: { title: 'Intensivo', text: 'Dominar y usar la palabra: repasos seguidos, completar oraciones del libro, escribir tus propias oraciones y una mini prueba.' },
  auto: { title: 'Automático', text: `Intensivo para las ${AUTO_INTENSIVE_TOP} palabras más importantes y relajado para el resto.` },
};

function modePicker(current, action) {
  return `<div class="mode-picker" role="radiogroup" aria-label="Modo de aprendizaje">${Object.entries(MODE_INFO).map(([k, m]) => `
    <button type="button" class="mode-opt ${current === k ? 'on' : ''}" role="radio" aria-checked="${current === k}" data-action="${action}" data-mode="${k}">
      <b>${m.title}</b><span>${m.text}</span>
    </button>`).join('')}</div>`;
}

const bookTitle = id => state.lib.books.find(b => b.id === id)?.title || 'Texto';

/* ---------- Lecturas (biblioteca + importar) ---------- */

function renderLibrary() {
  const u = state.ui.imp;
  const books = state.lib.books.slice().sort((a, b) => b.createdAt - a.createdAt);
  const caps = state.data.captures.length;
  const showImport = u.open || !books.length;
  return `
  <div class="row between">
    <div class="page-head"><span class="muted small">Lecturas</span><h1>Preparar una lectura</h1></div>
    <div class="actions">
      <a class="btn btn-secondary btn-sm" href="#/captura">${icon('bolt', 18)}<span>Captura rápida${caps ? ` (${caps})` : ''}</span></a>
      ${books.length ? `<button type="button" class="btn btn-primary btn-sm" data-action="imp-toggle">${icon('plus', 18)}<span>Nueva lectura</span></button>` : ''}
    </div>
  </div>
  ${!state.lib.available && !isDismissed('noIdb') ? banner('warn', 'IndexedDB no está disponible', 'Puedes preparar lecturas, pero se perderán al cerrar la página.', '', 'noIdb') : ''}

  ${showImport ? `<section class="card stack">
    <h2>Nueva lectura</h2>
    <label class="dropzone ${u.busy ? 'busy' : ''}" for="book-file" data-drop="book">
      ${u.busy ? '<span class="spinner"></span>' : icon('upload', 28)}
      <b>${u.busy ? 'Procesando…' : 'Sube un PDF, EPUB, DOCX o TXT'}</b>
      <span class="hint" id="imp-progress">${u.busy ? esc(u.progress) : 'Arrastra el archivo aquí o haz clic para elegirlo. Todo se procesa en tu navegador: el texto no se envía a ninguna API.'}</span>
    </label>
    <input id="book-file" type="file" accept=".pdf,.epub,.docx,.txt,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden ${u.busy ? 'disabled' : ''}>
    ${u.error ? banner('err', 'No se pudo leer el archivo', esc(u.error), '', true) : ''}
    <form class="stack-sm" data-submit="imp-paste">
      <span class="label">…o pega el texto directamente</span>
      <input class="input" name="title" placeholder="Título (opcional)" autocomplete="off">
      <textarea class="textarea" name="text" rows="6" placeholder="Pega aquí el capítulo o el artículo que vas a leer"></textarea>
      <div class="actions"><button type="submit" class="btn btn-dark btn-sm" ${u.busy ? 'disabled' : ''}>Usar este texto</button></div>
    </form>
  </section>` : ''}

  ${books.map(b => {
    const segs = state.lib.segments.filter(s => s.bookId === b.id).sort((x, y) => x.createdAt - y.createdAt);
    const [one, many] = KIND_UNIT[b.kind] || KIND_UNIT.plain;
    return `<section class="card stack-sm">
      <div class="row between top nowrap">
        <div class="stack-xs grow"><h2>${esc(b.title)}</h2><span class="hint">${FORMAT_LABEL[b.format] || b.format} · ${plural(b.unitCount, one, many)} · ${fmtNum(b.wordCount)} palabras</span></div>
        <button type="button" class="icon-btn" data-action="delete-book" data-id="${b.id}" aria-label="Borrar libro" title="Borrar libro">${icon('trash')}</button>
      </div>
      ${segs.map(s => {
        const p = segmentCoverage(s);
        return `<a class="seg-row" href="#/segmento/${s.id}">
          <span class="stack-xs grow"><b>${esc(s.title)}</b><span class="muted small">${MODE_INFO[s.mode]?.title || ''} · ${plural(s.candidates.length, 'palabra candidata', 'palabras candidatas')}</span></span>
          <span class="seg-cov">${p >= state.data.settings.coverageTarget ? '<span class="chip chip-ok">Listo para leer</span>' : ''}<b>${fmtPct(p)}</b></span>
          <span class="seg-bar">${coverageBar(s, { compact: true })}</span>
        </a>`;
      }).join('') || '<p class="muted small">Aún no hay lecturas. Elige qué parte vas a leer.</p>'}
      <div class="actions"><a class="btn btn-secondary btn-sm" href="#/libro/${b.id}">${icon('plus', 18)}<span>Nueva lectura</span></a></div>
    </section>`;
  }).join('')}`;
}

/* ---------- Libro: elegir qué parte leer ---------- */

function rangeView(bs) {
  const n = bs.units.length;
  const from = Math.max(1, Math.min(bs.sel.from, n));
  const to = Math.max(from, Math.min(bs.sel.to, n));
  const words = bs.units.slice(from - 1, to).reduce((s, u) => s + countWords(u.text), 0);
  const start = bs.units[from - 1]?.text || '';
  const end = bs.units[to - 1]?.text || '';
  return `
    <div class="range-track" aria-hidden="true"><div class="range-sel" style="left:${((from - 1) / n) * 100}%;width:${Math.max(0.8, ((to - from + 1) / n) * 100)}%"></div></div>
    <div class="row between"><b>Páginas ${from}–${to} <span class="muted">de ${n}</span></b><span class="muted small">${plural(to - from + 1, 'página', 'páginas')} · ~${fmtNum(words)} palabras</span></div>
    <div class="split-2">
      <div class="preview-box"><span class="eyebrow">Inicio · p. ${from}</span><p>${start ? esc(start.slice(0, 280)) + (start.length > 280 ? '…' : '') : '<i>(página sin texto)</i>'}</p></div>
      <div class="preview-box"><span class="eyebrow">Final · p. ${to}</span><p>${end ? (end.length > 280 ? '…' : '') + esc(end.slice(-280)) : '<i>(página sin texto)</i>'}</p></div>
    </div>`;
}

function unitList(bs) {
  const list = bs.book.kind === 'plain' ? chunkText(bs.units[0]?.text || '', bs.sel.blockSize) : bs.units;
  return list.map(u => `
    <label class="check-row">
      <input type="checkbox" data-bind="sel-unit" value="${esc(u.id)}" ${bs.sel.ids.includes(u.id) ? 'checked' : ''}>
      <span class="stack-xs grow"><b>${esc(u.title)}</b><span class="hint">${u.from ? `palabras ${fmtNum(u.from)}–${fmtNum(u.to)} · ` : `${fmtNum(countWords(u.text))} palabras · `}${esc(u.text.slice(0, 90))}…</span></span>
    </label>`).join('');
}

function previewPanel(bs) {
  if (bs.busy) return `<div class="card stack-sm"><span class="row gap-sm"><span class="spinner"></span><b>Analizando el texto…</b></span></div>`;
  const p = bs.preview;
  if (!p) return `<div class="card card-dashed">${icon('book', 28)}<b>Vista previa de la lectura</b><span class="small">Elige la parte que vas a leer y pulsa «Analizar».</span></div>`;
  const a = p.analysis;
  const cands = a.cands.filter(c => !knownRecord(c.lemma));
  const phrases = cands.filter(c => c.phrase);
  const known = a.baseKnown + Object.entries(a.rare).reduce((s, [l, f]) => s + (knownRecord(l) ? f : 0), 0);
  const cov = a.totalTokens ? (known / a.totalTokens) * 100 : 100;
  // Estimación: ~3 s por palabra en el triage y que no conoces la mitad de las candidatas.
  const triageMin = Math.max(1, Math.round((cands.length * 3) / 60));
  const half = Math.round(cands.length / 2);
  const tile = (n, label) => `<div class="stat" style="background:var(--surface-2)"><b>${n}</b><span>${label}</span></div>`;
  return `<div class="card stack">
    <h2>Vista previa de la lectura</h2>
    <div class="stat-grid" style="flex:none">
      ${tile(fmtNum(a.wordCount), 'Palabras totales')}${tile(fmtNum(cands.length), 'Palabras del texto')}${tile(fmtPct(cov), 'Ya conoces')}
    </div>
    <div class="kv"><span>Revisar palabras</span><b>~${triageMin} min</b></div>
    <div class="kv"><span>Estudio relajado</span><b>~${Math.round(half * 1.5)} min</b></div>
    <div class="kv"><span>Estudio intensivo</span><b>~${Math.round(half * 4)} min</b></div>
    <span class="hint">Estimado si no conoces la mitad de las candidatas (~${half}), repartido en varios días.</span>
    <div class="kv"><span>Lectura</span><b>~${Math.max(1, Math.round(a.wordCount / 200))} min</b></div>
    ${cands.length > phrases.length ? `<div class="stack-xs"><span class="eyebrow">Más frecuentes</span><div class="chips">${cands.filter(c => !c.phrase).slice(0, 12).map(c => `<span class="chip">${esc(c.lemma)} ×${c.freq}</span>`).join('')}</div></div>` : ''}
    ${phrases.length ? `<div class="stack-xs"><span class="eyebrow">Expresiones y phrasal verbs (${phrases.length})</span><div class="chips">${phrases.slice(0, 12).map(c => `<span class="chip chip-accent">${esc(c.lemma)} ×${c.freq}</span>`).join('')}</div></div>` : ''}
    <span class="label">Modo de aprendizaje</span>
    ${modePicker(bs.mode, 'set-draft-mode')}
    <div class="actions"><button type="button" class="btn btn-primary" data-action="create-segment">Crear lectura</button></div>
  </div>`;
}

function refreshBookPanels() {
  const bs = state.ui.book;
  if (!bs || currentRoute().name !== 'libro') return;
  const rv = $('#range-view');
  if (rv && bs.book.kind === 'pages') rv.innerHTML = rangeView(bs);
  const pv = $('#seg-preview');
  if (pv) pv.innerHTML = previewPanel(bs);
}

function renderBook(id) {
  const bs = state.ui.book;
  const book = state.lib.books.find(b => b.id === id);
  if (!book) return `<div class="page-head"><h1>Libro no encontrado</h1></div><a class="btn btn-secondary" href="#/lecturas">Volver a Lecturas</a>`;
  if (!bs || bs.loading) return `<div class="page-head"><span class="muted small">Libro</span><h1>${esc(book.title)}</h1></div><p class="row gap-sm"><span class="spinner"></span> Cargando texto…</p>`;
  if (!bs.units.length) return `<div class="page-head"><h1>${esc(book.title)}</h1></div>${banner('err', 'No se encontró el texto de este libro', 'Vuelve a subirlo.')}`;
  const sel = bs.sel;
  const auto = selectionUnits(bs).title;
  let chooser;
  if (book.kind === 'pages') {
    chooser = `
      <div class="fields">
        <div class="field"><label class="label" for="sel-from">De la página</label><input id="sel-from" class="input" type="number" inputmode="numeric" min="1" max="${bs.units.length}" value="${sel.from}" data-bind="sel-from"></div>
        <div class="field"><label class="label" for="sel-to">A la página</label><input id="sel-to" class="input" type="number" inputmode="numeric" min="1" max="${bs.units.length}" value="${sel.to}" data-bind="sel-to"></div>
      </div>
      <div id="range-view" class="stack-sm">${rangeView(bs)}</div>`;
  } else {
    chooser = `
      ${book.kind === 'plain' ? `<div class="field"><label class="label" for="sel-block">Palabras por bloque</label><input id="sel-block" class="input" type="number" min="300" max="20000" step="100" value="${sel.blockSize}" data-bind="sel-block" style="max-width:160px"></div>` : ''}
      <div class="row between"><span class="label">${book.kind === 'chapters' ? 'Capítulos (del índice del libro)' : book.kind === 'sections' ? 'Secciones (según los encabezados)' : 'Bloques'}</span>
        <span class="actions"><button type="button" class="btn-link" data-action="sel-all">Todos</button><button type="button" class="btn-link" data-action="sel-none">Ninguno</button></span></div>
      <div id="unit-list" class="check-list">${unitList(bs)}</div>
      ${book.kind !== 'chapters' ? `<details class="stack-sm" ${sel.fragment ? 'open' : ''}><summary class="label">¿Solo vas a leer un fragmento? Pégalo aquí</summary>
        <textarea class="textarea" rows="5" data-bind="sel-fragment" placeholder="Si pegas un fragmento, se usará en lugar de la selección">${esc(sel.fragment)}</textarea></details>` : ''}`;
  }
  const segs = state.lib.segments.filter(s => s.bookId === book.id);
  return `
  <div class="page-head"><a class="btn-link" style="align-self:flex-start;padding-left:0" href="#/lecturas">← Lecturas</a><h1>${esc(book.title)}</h1><span class="muted small">${FORMAT_LABEL[book.format]} · ${plural(book.unitCount, ...(KIND_UNIT[book.kind] || KIND_UNIT.plain))} · ${fmtNum(book.wordCount)} palabras</span></div>
  <div class="split">
    <div class="card stack col-main">
      <h2>¿Qué parte vas a leer?</h2>
      ${chooser}
      <div class="field"><label class="label" for="sel-title">Nombre de la lectura</label><input id="sel-title" class="input" data-bind="sel-title" value="${esc(bs.title)}" placeholder="${esc(auto || 'Capítulo 1')}" autocomplete="off"></div>
      <div class="actions"><button type="button" class="btn btn-primary" data-action="analyze">${icon('book')}<span>Analizar</span></button></div>
    </div>
    <div class="col-side stack">
      <div id="seg-preview">${previewPanel(bs)}</div>
      ${segs.length ? `<div class="card stack-sm"><h2>Lecturas de este libro</h2>${segs.map(s => `<a class="seg-row" href="#/segmento/${s.id}"><span class="grow"><b>${esc(s.title)}</b></span><b>${fmtPct(segmentCoverage(s))}</b></a>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

/* ---------- Segmento ---------- */

function renderSegment(id) {
  const seg = segmentById(id);
  if (!seg) return `<div class="page-head"><h1>Lectura no encontrada</h1></div><a class="btn btn-secondary" href="#/lecturas">Volver a Lecturas</a>`;
  const st = segmentStats(seg);
  const prepCount = segWords(seg).filter(w => isStudyReady(w) && !isMastered(w)).length;   // «Estudiar todas»
  const hardCount = hardIds(seg).length;
  const p = segmentCoverage(seg);
  const target = state.data.settings.coverageTarget;
  const ready = p >= target;
  const lastTest = seg.tests[seg.tests.length - 1];
  const busy = state.ui.enrichBusy;
  const tile = (n, label, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
  return `
  <div class="page-head"><a class="btn-link" style="align-self:flex-start;padding-left:0" href="#/lecturas">← ${esc(bookTitle(seg.bookId))}</a><h1>${esc(seg.title)}</h1>
    <span class="muted small">${fmtNum(seg.wordCount)} palabras · ${MODE_INFO[seg.mode].title}</span></div>

  <div class="card stack coverage-card ${ready ? 'is-ready' : ''}">
    <span class="eyebrow">Comprensión del texto</span>
    <div class="row between baseline"><span class="coverage-text">Ya conoces el <b>${fmtPct(p)}</b> de las palabras de este texto</span>
      ${ready ? `<span class="chip chip-ok">${icon('check', 16)} Listo para leer</span>` : `<span class="chip">Objetivo ${target}%</span>`}</div>
    ${coverageBar(seg)}
    ${(() => { const q = planFor(seg); return q.chosen && q.cur - q.now >= 0.1 ? `<span class="hint" style="font-weight:600;color:var(--accent-text)">Con ${q.chosen === 1 ? 'la palabra que elegiste' : `las ${q.chosen} palabras que elegiste`} estudiar llegarás al ${fmtPct(q.cur)}: sube cuando las aprendas.</span>` : ''; })()}
    <span class="hint">Cuenta ocurrencias: una palabra que aparece 30 veces pesa más que una que aparece una vez. Las palabras comunes, los nombres propios y las que ya sabes cuentan como conocidas.${ready ? '' : ` Te falta ${fmtPct(Math.max(0, target - p))}.`}</span>
  </div>

  ${freqLoading() ? '<div class="card"><span class="row gap-sm"><span class="spinner"></span><span class="muted small">Calculando qué palabras son más importantes…</span></span></div>' : planCard(seg)}

  <div class="stat-grid seg-stats">
    ${tile(st.total, 'Palabras del texto')}${tile(st.pending, 'Sin revisar')}${tile(st.known, 'La sé')}
    ${tile(st.familiar, 'Me suenan')}${tile(st.unknown + st.studying, 'No la sé / en estudio')}${tile(st.learned, 'Aprendidas', 'ok')}
  </div>

  <div class="split">
    <div class="col-main stack">
      <div class="card step-row">
        <span class="step-num">1</span>
        <div class="stack-xs grow"><b>Revisar palabras</b><span class="hint">${st.pending ? `${plural(st.pending, 'palabra por revisar', 'palabras por revisar')}, de la más importante a la menos.${planFor(seg).need ? ` Te faltan ${planFor(seg).need} para tu meta.` : ' Ya cumpliste tu meta.'}` : 'Revisaste todas las palabras candidatas.'}</span></div>
        <a class="btn ${st.pending ? 'btn-primary' : 'btn-secondary'} btn-sm" href="#/triage/${seg.id}">${st.pending ? (seg.history.length ? 'Continuar' : 'Empezar') : 'Ver resumen'}</a>
      </div>
      <div class="card step-row">
        <span class="step-num">2</span>
        <div class="stack-xs grow"><b>Significados con IA</b><span class="hint">${st.waiting ? `${plural(st.waiting, 'palabra espera', 'palabras esperan')} su significado (en tandas de ${ENRICH_BATCH}; usa la oración del libro para elegir el sentido).` : 'Todas las palabras en estudio tienen significado.'}</span></div>
        ${st.waiting ? (hasKey() ? `<button type="button" class="btn btn-dark btn-sm" data-action="enrich-seg" data-seg="${seg.id}" ${busy ? 'disabled' : ''}>${busy ? `<span class="spinner"></span><span>${esc(busy)}</span>` : `${icon('sparkle', 18)}<span>Enriquecer</span>`}</button>` : `<a class="btn btn-secondary btn-sm" href="#/ajustes">${icon('sparkle', 16)}<span>Conectar IA</span></a>`) : ''}
      </div>
      <div class="card step-row">
        <span class="step-num">3</span>
        <div class="stack-xs grow"><b>Estudiar</b>${st.ready ? '' : '<span class="hint">Primero revisa las palabras y completa los significados.</span>'}</div>
        ${st.ready ? `<div class="study-options">
          <div class="study-option">
            <div class="stack-xs grow"><b>Lo de hoy</b><span class="hint">${st.due} para repasar · ${st.fresh} nuevas (máx. ${dailyLimit(seg.mode === 'intensive' ? 'intensive' : 'relaxed')}/día)</span></div>
            <button type="button" class="btn btn-primary btn-sm" data-action="start-session" data-seg="${seg.id}">Estudiar hoy</button>
          </div>
          <div class="study-option">
            <div class="stack-xs grow"><b>Todas las palabras (${prepCount})</b><span class="hint">De una vez, en bloques de ${PREP_BLOCK}, para entender la lectura hoy mismo.${seg.prepPasses ? ` Ya diste ${plural(seg.prepPasses, 'vuelta completa', 'vueltas completas')}: ahora van en orden aleatorio.` : ''}${st.waiting ? ` Las ${st.waiting} sin significado no entran.` : ''}</span></div>
            <button type="button" class="btn btn-secondary btn-sm" data-action="start-session" data-seg="${seg.id}" data-all="1" ${prepCount ? '' : 'disabled'}>Estudiar todas</button>
          </div>
          ${hardCount ? `<div class="study-option">
            <div class="stack-xs grow"><b>Las que más te costaron (${hardCount})</b><span class="hint">Las que fallaste o marcaste como difíciles. Salen de la lista al acertarlas aquí.</span></div>
            <button type="button" class="btn btn-secondary btn-sm" data-action="start-session" data-seg="${seg.id}" data-hard="1">Repasarlas</button>
          </div>` : ''}
        </div>` : ''}
      </div>
      <div class="card step-row">
        <span class="step-num">4</span>
        <div class="stack-xs grow"><b>Prueba final de la lectura</b><span class="hint">${lastTest ? `Último resultado: ${Math.round((lastTest.score / lastTest.total) * 100)}% (${lastTest.score}/${lastTest.total}) · ${new Date(lastTest.at).toLocaleDateString('es')}` : 'Examen mezclado con todas las palabras en estudio de la lectura.'}</span></div>
        <a class="btn btn-secondary btn-sm ${st.ready >= 3 ? '' : 'disabled'}" href="${st.ready >= 3 ? `#/prueba/${seg.id}` : '#/segmento/' + seg.id}" ${st.ready >= 3 ? '' : 'aria-disabled="true"'}>Hacer prueba</a>
      </div>
    </div>
    <div class="col-side stack">
      <div class="card stack">
        <h2>Modo de aprendizaje</h2>
        ${modePicker(seg.mode, 'set-seg-mode')}
        <span class="hint">Puedes cambiarlo cuando quieras; afecta a las próximas sesiones.</span>
      </div>
      <div class="card stack-sm">
        <label class="switch-row"><input type="checkbox" ${state.data.settings.noSpoilers ? 'checked' : ''} data-bind="setting-bool" data-key="noSpoilers" data-rerender="1"><span class="switch" aria-hidden="true"></span>
          <span class="stack-xs"><b>Sin spoilers</b><span class="hint">Usa ejemplos genéricos en lugar de las oraciones del libro.</span></span></label>
        <div class="actions">
          <a class="btn btn-secondary btn-sm" href="#/glosario/${seg.id}">${icon('list', 18)}<span>Glosario</span></a>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export-csv-seg" data-seg="${seg.id}">${icon('download', 18)}<span>CSV para Anki</span></button>
        </div>
        <button type="button" class="btn-link danger" style="align-self:flex-start" data-action="delete-segment" data-seg="${seg.id}">Borrar lectura</button>
      </div>
    </div>
  </div>`;
}

/* ---------- Triage ---------- */

function renderTriage(id) {
  const seg = segmentById(id);
  if (!seg) return `<div class="page-head"><h1>Lectura no encontrada</h1></div>`;
  if (freqLoading()) return '<div class="card narrow"><span class="row gap-sm"><span class="spinner"></span><span class="muted">Preparando las palabras, de la más importante a la menos…</span></span></div>';
  const idx = studyIndex();
  const cand = nextPending(seg, idx);
  if (!cand) return renderTriageSummary(seg);
  const plan = planFor(seg);
  if ((plan.K > 0 ? plan.chosen >= plan.K : plan.plan.mode === 'coverage') && !state.ui.planContinue?.has(seg.id)) return goalReachedCard(seg, plan);
  const showEx = !state.data.settings.noSpoilers || state.ui.triageReveal === cand.lemma;
  const w = { word: cand.lemma, forms: cand.forms };
  return `
  <div class="study-head">
    <div class="row between">
      <span class="small" style="font-weight:600;color:var(--muted)">${esc(seg.title)} · Revisar palabras · Meta: ${plan.chosen} de ${plan.K}</span>
      <span class="actions">
        ${seg.history.length ? '<button type="button" class="btn-link" data-action="triage-undo">Deshacer</button>' : ''}
        <a class="btn-link" href="#/segmento/${seg.id}">Pausar</a>
      </span>
    </div>
    <div class="progress"><div style="width:${plan.K ? Math.min(100, Math.round((plan.chosen / plan.K) * 100)) : 100}%"></div></div>
  </div>
  <div class="card stack-lg narrow triage-card">
    <div class="stack-xs">
      <div class="word-title"><h1 class="word-xl">${esc(cand.lemma)}</h1>${speakBtn(cand.lemma, 'Escuchar pronunciación')}${cand.phrase ? '<span class="chip chip-accent">Expresión</span>' : ''}</div>
      <span class="muted">Aparece ${plural(cand.freq, 'vez', 'veces')}${cand.locs.length ? ` · ${esc(cand.locs.slice(0, 3).join(', '))}` : ''}${cand.forms.length > 1 ? ` · formas: ${esc(cand.forms.slice(0, 4).join(', '))}` : ''}</span>
      ${triageInsights(cand)}
    </div>
    ${cand.examples.length ? (showEx
      ? `<div class="stack-sm">${cand.examples.map(e => `<p class="lead">${highlightWord(e.text, w)}${e.loc ? ` <span class="hint">· ${esc(e.loc)}</span>` : ''}</p>`).join('')}</div>`
      : `<button type="button" class="btn-link" style="align-self:flex-start" data-action="triage-reveal" data-lemma="${esc(cand.lemma)}">Mostrar oraciones del libro (modo sin spoilers)</button>`) : ''}
    <div class="triage-btns">
      <button type="button" class="tbtn tbtn-known" data-action="triage-decide" data-decision="known"><span class="key">1</span><b>La sé</b></button>
      <button type="button" class="tbtn tbtn-familiar" data-action="triage-decide" data-decision="familiar"><span class="key">2</span><b>Me suena</b></button>
      <button type="button" class="tbtn tbtn-unknown" data-action="triage-decide" data-decision="unknown"><span class="key">3</span><b>No la sé</b></button>
    </div>
    <button type="button" class="tbtn-skip ${infoOf(cand).skip ? 'is-suggested' : ''}" data-action="triage-decide" data-decision="skipped"><span class="key">4</span><span>No vale la pena estudiarla</span></button>
    <p class="hint">Atajos: 1, 2, 3 y 4 · Z para deshacer. «Me suena» se salta la presentación de la palabra; «No la sé» empieza desde el principio.</p>
  </div>`;
}

function renderTriageSummary(seg) {
  const c = { known: 0, familiar: 0, unknown: 0, studying: 0, skipped: 0 };
  for (const x of seg.candidates) if (c[x.status] !== undefined) c[x.status]++;
  const st = segmentStats(seg);
  const total = seg.candidates.length;
  const canVerify = state.data.settings.verifyKnown && c.known >= 3;
  return `
  <div class="card stack-lg narrow">
    <div class="stack-xs"><span class="eyebrow">${esc(seg.title)} · Revisión terminada</span><h1 class="word-lg">Resumen</h1></div>
    <p class="lead">De ${plural(total, 'palabra', 'palabras')}: <b>${c.known}</b> las sabes, <b>${c.familiar}</b> te suenan y <b>${c.unknown}</b> no las sabes${c.skipped ? ` y <b>${c.skipped}</b> las descartaste` : ''}${c.studying ? ` (${c.studying} ya estaban en estudio)` : ''}.</p>
    <div class="coverage-mini row between"><span>Comprensión actual</span><b>${fmtPct(segmentCoverage(seg))}</b></div>
    ${canVerify && !isDismissed(`verify-${seg.id}`) ? banner('info', '¿Seguro que las sabes?', `Comprueba una muestra de ${Math.min(10, c.known)} palabras con opción múltiple. Las que falles pasarán a estudio.`,
      `<div class="actions">${hasKey() ? `<a class="btn btn-primary btn-sm" href="#/verificar/${seg.id}">Verificar una muestra</a>` : `<a class="btn btn-secondary btn-sm" href="#/ajustes">${icon('sparkle', 16)}<span>Conectar IA para verificar</span></a>`}</div>`, `verify-${seg.id}`) : ''}
    ${st.waiting && !isDismissed(`segWaiting-${seg.id}`, st.waiting) ? banner('warn', `${plural(st.waiting, 'palabra espera', 'palabras esperan')} su significado`, 'Enriquécelas con IA para poder estudiarlas.',
      hasKey() ? `<div class="actions"><button type="button" class="btn btn-dark btn-sm" data-action="enrich-seg" data-seg="${seg.id}" ${state.ui.enrichBusy ? 'disabled' : ''}>${state.ui.enrichBusy ? `<span class="spinner"></span><span>${esc(state.ui.enrichBusy)}</span>` : 'Enriquecer con IA'}</button></div>` : '', `segWaiting-${seg.id}`, st.waiting) : ''}
    <div class="actions">
      <a class="btn btn-primary" href="#/segmento/${seg.id}">Ir a la lectura</a>
      ${seg.history.length ? '<button type="button" class="btn btn-secondary" data-action="triage-undo">Deshacer la última</button>' : ''}
    </div>
  </div>`;
}

/* ---------- Glosario ---------- */

const GL_FILTERS = [['all', 'Todas'], ['pending', 'Sin revisar'], ['known', 'La sé'], ['familiar', 'Me suena'], ['unknown', 'No la sé / en estudio'], ['learned', 'Aprendidas / dominadas'], ['skipped', 'Descartadas']];

function glossaryRows(seg) {
  const idx = studyIndex();
  const q = normalize(state.ui.glSearch || '');
  const f = state.ui.glFilter || 'all';
  const rows = rankedCands(seg).filter(c => {
    const st = candState(c, idx).key;
    if (f === 'unknown' && !(st === 'unknown' || st === 'studying')) return false;
    if (f === 'learned' && !(st === 'learned' || st === 'mastered')) return false;
    if (!['all', 'unknown', 'learned'].includes(f) && st !== f) return false;
    if (!q) return true;
    const w = studyWordFor(idx, c.lemma);
    return normalize(c.lemma).includes(q) || c.forms.some(x => x.includes(q)) || normalize(w?.translation || '').includes(q);
  });
  if (!rows.length) return '<p class="empty">No hay palabras que coincidan.</p>';
  return rows.slice(0, 400).map(c => {
    const st = candState(c, idx);
    const w = studyWordFor(idx, c.lemma);
    const meaning = w?.translation || state.lib.aiCache.get(c.lemma)?.content?.translation || '';
    return `<div class="list-row">
      <div class="stack-xs"><span class="list-word" title="${esc(c.forms.join(', '))}">${esc(w?.word || c.lemma)}</span><span class="muted small">${meaning ? esc(meaning) : '<i>—</i>'}</span></div>
      <div class="list-meta"><span class="chip ${st.cls}">${esc(st.label)}</span><span class="imp-badge sm t-${infoOf(c).tier.key}" title="${esc(infoOf(c).lang)}">${infoOf(c).tier.label}</span>${infoOf(c).skip ? `<span class="imp-flag hard">${esc(infoOf(c).flags.find(f => f.hard).label)}</span>` : ''}<span class="muted small">×${c.freq}${c.locs[0] ? ` · ${esc(c.locs[0])}` : ''}</span></div>
      <div class="list-actions">
        ${st.key === 'pending' || st.key === 'known' || st.key === 'skipped' ? `<button type="button" class="btn-link" data-action="gl-study" data-lemma="${esc(c.lemma)}">Estudiar</button>` : ''}
        ${st.key !== 'known' && st.key !== 'learned' && st.key !== 'mastered' ? `<button type="button" class="btn-link" data-action="gl-known" data-lemma="${esc(c.lemma)}">La sé</button>` : ''}
      </div>
    </div>`;
  }).join('') + (rows.length > 400 ? `<p class="hint">Mostrando 400 de ${rows.length}. Usa la búsqueda para encontrar más.</p>` : '');
}

function renderGlossary(id) {
  const seg = segmentById(id);
  if (!seg) return `<div class="page-head"><h1>Lectura no encontrada</h1></div>`;
  return `
  <div class="row between">
    <div class="page-head"><a class="btn-link" style="align-self:flex-start;padding-left:0" href="#/segmento/${seg.id}">← ${esc(seg.title)}</a><h1>Glosario de la lectura</h1></div>
    <button type="button" class="btn btn-secondary btn-sm" data-action="export-csv-seg" data-seg="${seg.id}">${icon('download', 18)}<span>CSV para Anki</span></button>
  </div>
  <div class="toolbar">
    <input type="search" class="input" placeholder="Buscar palabra o significado" aria-label="Buscar" data-bind="gl-search" value="${esc(state.ui.glSearch || '')}">
    <select class="input" aria-label="Filtrar por estado" data-bind="gl-filter">${GL_FILTERS.map(([k, l]) => `<option value="${k}" ${(state.ui.glFilter || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  <div class="card list" id="gl-list" data-seg="${seg.id}">${glossaryRows(seg)}</div>`;
}

/* ---------- Captura rápida ---------- */

function renderCapture() {
  const caps = state.data.captures;
  const segs = state.lib.segments.slice().sort((a, b) => b.createdAt - a.createdAt);
  const busy = state.ui.enrichBusy;
  return `
  <div class="capture">
    <div class="row between"><a class="btn-link" style="padding-left:0" href="#/lecturas">← Salir</a><span class="eyebrow">Captura rápida</span></div>
    <form class="capture-form" data-submit="capture-add" autocomplete="off">
      <input class="input big" name="w" placeholder="Palabra que encontraste" aria-label="Palabra" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" data-autofocus>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
    ${segs.length ? `<select class="input" aria-label="Lectura" data-bind="capture-seg">
      <option value="">Sin lectura</option>
      ${segs.map(s => `<option value="${s.id}" ${state.data.captureSeg === s.id ? 'selected' : ''}>${esc(bookTitle(s.bookId))} · ${esc(s.title)}</option>`).join('')}
    </select>` : ''}
    <div class="stack-sm">
      <h2>Para enriquecer después <span class="muted">(${caps.length})</span></h2>
      ${caps.length ? `<ul class="capture-list">${caps.slice().reverse().map(c => `<li><span>${esc(c.text)}</span>${c.segId && segmentById(c.segId) ? `<span class="hint">${esc(segmentById(c.segId).title)}</span>` : ''}<button type="button" class="icon-btn" data-action="capture-del" data-id="${c.id}" aria-label="Quitar ${esc(c.text)}">${icon('x', 18)}</button></li>`).join('')}</ul>`
        : '<p class="muted small">Escribe cada palabra desconocida sin detenerte a buscarla. Después la IA las completa todas juntas.</p>'}
    </div>
    ${caps.length ? `<div class="actions">
      ${hasKey() ? `<button type="button" class="btn btn-dark" data-action="process-captures" data-ai="1" ${busy ? 'disabled' : ''}>${busy ? `<span class="spinner"></span><span>${esc(busy)}</span>` : `${icon('sparkle', 18)}<span>Enriquecer y estudiar (${caps.length})</span>`}</button>` : `<a class="btn btn-secondary" href="#/ajustes">${icon('sparkle', 18)}<span>Conectar IA para completarlas</span></a>`}
      <button type="button" class="btn-link" data-action="process-captures" data-ai="0" ${busy ? 'disabled' : ''}>Pasar a Mis palabras sin IA</button>
    </div>` : ''}
  </div>`;
}

/* ---------- Prueba final y verificación ---------- */

function renderTestRoute(id) {
  const q = state.ui.quiz;
  if (state.ui.quizInfo?.error) return `<div class="card stack narrow">${banner('warn', 'No se puede hacer la prueba', esc(state.ui.quizInfo.error))}<a class="btn btn-secondary" href="#/segmento/${id}">Volver a la lectura</a></div>`;
  return q ? renderQuiz(q) : '';
}
function renderVerifyRoute(id) {
  const info = state.ui.quizInfo || {};
  if (info.loading) return `<div class="card stack narrow"><span class="row gap-sm"><span class="spinner"></span><b>Preparando la verificación…</b></span><span class="hint">Se buscan los significados con IA (o en la caché).</span></div>`;
  if (info.error) return `<div class="card stack narrow">${banner('err', 'No se pudo preparar la verificación', esc(info.error))}<a class="btn btn-secondary" href="#/triage/${id}">Volver</a></div>`;
  return state.ui.quiz ? renderQuiz(state.ui.quiz) : '';
}

QUIZ_DONE.final = q => {
  const seg = segmentById(q.segId);
  if (!seg) return;
  seg.tests.push({ at: Date.now(), score: quizScore(q), total: q.questions.length });
  seg.tests = seg.tests.slice(-20);
  libSaveSegment(seg);
};
QUIZ_RESULT.final = q => quizResultCard(q, 'Resultado de la prueba', `
  <div class="actions"><a class="btn btn-primary" href="#/segmento/${q.segId}">Volver a la lectura</a><button type="button" class="btn btn-secondary" data-action="retry-final" data-seg="${q.segId}">Repetir prueba</button></div>`);

// Las palabras que falles en la verificación pasan de "La sé" a estudio.
QUIZ_DONE.verify = q => {
  const seg = segmentById(q.segId);
  if (!seg) return;
  q.moved = [];
  for (const item of q.questions.filter(x => !x.ok)) {
    const cand = seg.candidates.find(c => c.lemma === item.w.lemma);
    if (!cand) continue;
    cand.status = 'unknown';
    libUnmarkKnown(cand.lemma);
    const w = addStudyWord(seg, cand, 1);
    applyContent(w, item.w);
    q.moved.push(w.word);
  }
  persist();
  seg.autoTop = computeAutoTop(seg);
  libSaveSegment(seg);
};
QUIZ_RESULT.verify = q => quizResultCard(q, 'Resultado de la verificación', `
  ${q.moved?.length ? banner('warn', `${plural(q.moved.length, 'palabra pasó', 'palabras pasaron')} a estudio`, esc(q.moved.join(', '))) : ''}
  <div class="actions"><a class="btn btn-primary" href="#/segmento/${q.segId}">Ir a la lectura</a></div>`);

/* ===================== 7. Acciones y registro ===================== */

state.ui.imp = { open: false, busy: false, progress: '', error: null };
state.ui.book = null;
state.data.captureSeg = state.data.captureSeg || '';

Object.assign(ROUTES, {
  lecturas: renderLibrary, libro: renderBook, segmento: renderSegment, triage: renderTriage,
  glosario: renderGlossary, captura: renderCapture, prueba: renderTestRoute, verificar: renderVerifyRoute,
});

Object.assign(ROUTE_ENTER, {
  libro: id => {
    const book = state.lib.books.find(b => b.id === id);
    if (!book || state.ui.book?.book.id === id) return;
    const bs = { book, units: [], loading: true, sel: null, preview: null, title: '', mode: 'relaxed', busy: false };
    state.ui.book = bs;
    loadUnits(id).then(units => {
      bs.units = units;
      bs.sel = defaultSelection(book, units);
      bs.loading = false;
      if (state.ui.book === bs) refreshIfOn('libro');
    });
  },
  segmento: () => { ensureFreq(); },
  triage: () => { state.ui.triageReveal = null; ensureFreq(); },
  glosario: id => { ensureFreq(); if (state.ui.glSeg !== id) { state.ui.glSeg = id; state.ui.glSearch = ''; state.ui.glFilter = 'all'; } },
  prueba: id => {
    const seg = segmentById(id);
    state.ui.quizInfo = null;
    if (state.ui.quiz?.context === 'final' && state.ui.quiz.segId === id && !state.ui.quiz.done) return;
    const words = seg ? segWords(seg).filter(isStudyReady) : [];
    if (words.length < 3) { state.ui.quiz = null; state.ui.quizInfo = { error: 'Necesitas al menos 3 palabras en estudio con significado en esta lectura.' }; return; }
    state.ui.quiz = buildQuiz(words, { size: Math.min(40, words.length), context: 'final', segId: id, title: `Prueba final · ${seg.title}` });
  },
  verificar: id => {
    const seg = segmentById(id);
    if (state.ui.quiz?.context === 'verify' && state.ui.quiz.segId === id && !state.ui.quiz.done) return;
    state.ui.quiz = null;
    if (!seg) return;
    const sample = shuffle(seg.candidates.filter(c => c.status === 'known')).slice(0, 10);
    if (sample.length < 3) { state.ui.quizInfo = { error: 'No hay suficientes palabras marcadas como «La sé».' }; return; }
    state.ui.quizInfo = { loading: true };
    enrichCached(sample.map(c => ({ word: c.lemma, lemma: c.lemma, context: c.examples[0]?.text || '' }))).then(({ results, error }) => {
      const temps = sample.filter(c => results.has(c.lemma)).map(c => {
        const content = results.get(c.lemma);
        return { ...createWord({ ...content, word: content.word || c.lemma }), id: 'tmp-' + c.lemma, lemma: c.lemma, forms: c.forms };
      });
      if (temps.length < 3) state.ui.quizInfo = { error: error ? errorText(error) : 'La IA no devolvió suficientes significados.' };
      else {
        state.ui.quizInfo = null;
        state.ui.quiz = buildQuiz(temps, { size: temps.length, context: 'verify', segId: id, kinds: ['mc'], title: 'Verificación de «La sé»' });
      }
      refreshIfOn('verificar');
    });
  },
});

async function handleBookFile(file) {
  const u = state.ui.imp;
  if (u.busy || !file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  u.busy = true; u.error = null; u.progress = 'Leyendo el archivo…';
  refreshIfOn('lecturas');
  try {
    let parsed;
    if (ext === 'pdf' || file.type === 'application/pdf') {
      parsed = await parsePdf(file, (i, n) => { u.progress = `Extrayendo texto: página ${i} de ${n}…`; const el = $('#imp-progress'); if (el) el.textContent = u.progress; });
    } else if (ext === 'epub') parsed = await parseEpub(file);
    else if (ext === 'docx') parsed = await parseDocx(file);
    else if (ext === 'txt' || file.type.startsWith('text/')) parsed = makeTextBook(await file.text(), stripExt(file.name), 'txt');
    else throw new ReadingError('Formato no soportado. Usa PDF, EPUB, DOCX o TXT.');
    const book = await saveBook(parsed);
    u.busy = false; u.open = false;
    go(`libro/${book.id}`);
    return;
  } catch (e) {
    console.error(e);
    u.error = e instanceof ReadingError ? e.message : `No se pudo leer el archivo: ${e?.message || e}`;
  }
  u.busy = false;
  refreshIfOn('lecturas');
}
FILE_INPUTS['book-file'] = handleBookFile;

// Arrastrar y soltar archivos sobre la zona de carga.
document.addEventListener('dragover', e => {
  const z = e.target.closest?.('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.add('over');
});
document.addEventListener('dragleave', e => e.target.closest?.('[data-drop]')?.classList.remove('over'));
document.addEventListener('drop', e => {
  const z = e.target.closest?.('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.remove('over');
  const file = e.dataTransfer?.files?.[0];
  if (file) (FILE_INPUTS[z.dataset.drop] || handleBookFile)(file);   // data-drop="import-file" → importar respaldo
});

const currentSeg = () => segmentById(currentRoute().param);

Object.assign(actions, {
  'imp-toggle': () => { state.ui.imp.open = !state.ui.imp.open; render(); },
  'imp-paste': async form => {
    const text = form.elements.text.value;
    if (!countWords(text)) { toast('Pega un texto primero.'); return; }
    try {
      const book = await saveBook(makeTextBook(text, form.elements.title.value.trim() || 'Texto pegado', 'paste'));
      state.ui.imp.open = false;
      go(`libro/${book.id}`);
    } catch (e) { toast(e.message, 'err'); }
  },
  'delete-book': el => {
    const book = state.lib.books.find(b => b.id === el.dataset.id);
    if (!book || !confirm(`¿Borrar «${book.title}» y sus lecturas? Las palabras en estudio y el vocabulario global se conservan.`)) return;
    for (const seg of state.lib.segments.filter(s => s.bookId === book.id)) deleteSegment(seg);
    state.lib.books = state.lib.books.filter(b => b.id !== book.id);
    libDelete('books', book.id);
    libDelete('texts', book.id);
    textCache.delete(book.id);
    if (state.ui.book?.book.id === book.id) state.ui.book = null;
    toast('Libro borrado');
    render();
  },

  /* Elegir segmento */
  'sel-all': () => {
    const bs = state.ui.book;
    const list = bs.book.kind === 'plain' ? chunkText(bs.units[0]?.text || '', bs.sel.blockSize) : bs.units;
    bs.sel.ids = list.map(u => u.id); bs.preview = null; render();
  },
  'sel-none': () => { const bs = state.ui.book; bs.sel.ids = []; bs.preview = null; render(); },
  analyze: () => {
    const bs = state.ui.book;
    if (!bs || bs.busy) return;
    const { units, title } = selectionUnits(bs);
    if (!units.reduce((n, u) => n + countWords(u.text), 0)) { toast('La selección no tiene texto. Elige al menos una parte.'); return; }
    bs.busy = true;
    refreshBookPanels();
    // Se deja pintar el indicador antes del análisis (que puede tardar en libros largos).
    setTimeout(() => {
      bs.preview = { analysis: analyzeUnits(units), title };
      bs.busy = false;
      refreshBookPanels();
      $('#seg-preview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 30);
  },
  'set-draft-mode': el => { const bs = state.ui.book; if (bs) { bs.mode = el.dataset.mode; refreshBookPanels(); } },
  'create-segment': () => {
    const bs = state.ui.book;
    if (!bs?.preview) return;
    const seg = createSegment(bs);
    bs.preview = null; bs.title = '';
    toast(`Lectura creada: ${plural(seg.candidates.length, 'palabra candidata', 'palabras candidatas')}`);
    go(`segmento/${seg.id}`);
  },

  /* Segmento */
  'set-seg-mode': el => {
    const seg = currentSeg();
    if (!seg) return;
    seg.mode = el.dataset.mode;
    seg.autoTop = computeAutoTop(seg);
    libSaveSegment(seg);
    render();
  },
  'enrich-seg': async el => {
    const seg = segmentById(el.dataset.seg);
    if (!seg || state.ui.enrichBusy) return;
    const words = segWords(seg).filter(w => !isStudyReady(w)).sort((a, b) => (b.freq || 0) - (a.freq || 0));
    if (!words.length) return;
    state.ui.enrichBusy = 'Completando…';
    render();
    const { done, error } = await enrichStudyWords(words, {
      onProgress: (i, n) => { state.ui.enrichBusy = `Tanda ${Math.floor(i / ENRICH_BATCH) + 1} de ${Math.ceil(n / ENRICH_BATCH)}…`; render(); },
    });
    state.ui.enrichBusy = '';
    toast(error ? `${errorText(error)}${done ? ` (se completaron ${done})` : ''}` : `Se completaron ${plural(done, 'palabra', 'palabras')}`, error ? 'err' : '');
    render();
  },
  'export-csv-seg': el => {
    const seg = segmentById(el.dataset.seg);
    const words = seg ? segWords(seg).filter(isStudyReady) : [];
    if (!words.length) { toast('Esta lectura no tiene palabras en estudio con significado.'); return; }
    downloadFile(`anki-${slug(seg.title)}.csv`, exportCSV(words, `${bookTitle(seg.bookId)} ${seg.title}`), 'text/csv;charset=utf-8');
  },
  'delete-segment': el => {
    const seg = segmentById(el.dataset.seg);
    if (!seg || !confirm(`¿Borrar la lectura «${seg.title}»? Las palabras en estudio se conservan.`)) return;
    deleteSegment(seg);
    toast('Lectura borrada');
    go('lecturas');
  },
  'retry-final': el => { state.ui.quiz = null; go(`prueba/${el.dataset.seg}`); },

  /* Triage */
  'triage-decide': el => {
    const seg = currentSeg();
    const cand = seg && nextPending(seg);
    if (!cand) return;
    triageDecide(seg, cand, el.dataset.decision);
    state.ui.triageReveal = null;
    render();
  },
  'triage-undo': () => { const seg = currentSeg(); if (seg) { triageUndo(seg); render(); } },
  'triage-reveal': el => { state.ui.triageReveal = el.dataset.lemma; render(); },

  /* Glosario */
  'gl-known': el => {
    const seg = currentSeg();
    const cand = seg?.candidates.find(c => c.lemma === el.dataset.lemma);
    if (!cand) return;
    cand.status = 'known';
    libMarkKnown(cand.lemma, 'known', 'triage');
    seg.autoTop = computeAutoTop(seg);
    libSaveSegment(seg);
    $('#gl-list').innerHTML = glossaryRows(seg);
  },
  'gl-study': el => {
    const seg = currentSeg();
    const cand = seg?.candidates.find(c => c.lemma === el.dataset.lemma);
    if (!cand) return;
    libUnmarkKnown(cand.lemma);
    cand.status = 'unknown';
    addStudyWord(seg, cand, 1);
    seg.autoTop = computeAutoTop(seg);
    libSaveSegment(seg);
    $('#gl-list').innerHTML = glossaryRows(seg);
  },

  /* Captura rápida */
  'capture-add': form => {
    const text = form.elements.w.value.trim().replace(/\s+/g, ' ');
    if (!text) return;
    if (state.data.captures.some(c => normalize(c.text) === normalize(text))) { toast('Ya está en la lista.'); form.elements.w.value = ''; return; }
    state.data.captures.push({ id: uid(), text: text.slice(0, 60), segId: state.data.captureSeg || null, at: Date.now() });
    persist();
    render();
  },
  'capture-del': el => { state.data.captures = state.data.captures.filter(c => c.id !== el.dataset.id); persist(); render(); },
  'process-captures': async el => {
    if (state.ui.enrichBusy) return;
    const caps = state.data.captures.slice();
    if (!caps.length) return;
    const idx = studyIndex();
    const words = caps.map(c => {
      const lemma = normalize(c.text);
      let w = studyWordFor(idx, lemma);
      if (!w) {
        w = createWord({ word: c.text, lemma });
        w.source = 'capture';
        state.data.words.push(w);
        idx.set(lemma, w);
      }
      if (c.segId && segmentById(c.segId) && !w.segIds.includes(c.segId)) w.segIds.push(c.segId);
      return w;
    });
    state.data.captures = [];
    persist();
    if (el.dataset.ai !== '1') { toast(`${plural(words.length, 'palabra pasó', 'palabras pasaron')} a Mis palabras (esperan significado)`); render(); return; }
    state.ui.enrichBusy = 'Completando…';
    render();
    const { done, error } = await enrichStudyWords(words.filter(w => !isStudyReady(w)), {
      onProgress: (i, n) => { state.ui.enrichBusy = `Completando ${i} de ${n}…`; refreshIfOn('captura'); },
    });
    state.ui.enrichBusy = '';
    toast(error ? `${errorText(error)} Las palabras quedaron en Mis palabras.` : `${plural(done, 'palabra lista', 'palabras listas')} para estudiar`, error ? 'err' : '');
    render();
  },
});

Object.assign(bindings, {
  'sel-from': el => { const bs = state.ui.book; const n = parseInt(el.value, 10); if (!bs || !Number.isFinite(n)) return; bs.sel.from = n; if (bs.sel.to < n) bs.sel.to = n; bs.preview = null; refreshBookPanels(); },
  'sel-to': el => { const bs = state.ui.book; const n = parseInt(el.value, 10); if (!bs || !Number.isFinite(n)) return; bs.sel.to = n; bs.preview = null; refreshBookPanels(); },
  'sel-unit': el => {
    const bs = state.ui.book;
    if (!bs) return;
    bs.sel.ids = el.checked ? [...new Set([...bs.sel.ids, el.value])] : bs.sel.ids.filter(id => id !== el.value);
    bs.preview = null;
    refreshBookPanels();
  },
  'sel-block': el => {
    const bs = state.ui.book;
    const n = parseInt(el.value, 10);
    if (!bs || !Number.isFinite(n) || n < 300) return;
    bs.sel.blockSize = Math.min(20000, n);
    bs.sel.ids = ['b0'];
    bs.preview = null;
    const list = $('#unit-list');
    if (list) list.innerHTML = unitList(bs);
    refreshBookPanels();
  },
  'sel-fragment': el => { const bs = state.ui.book; if (!bs) return; bs.sel.fragment = el.value; bs.preview = null; refreshBookPanels(); },
  'sel-title': el => { if (state.ui.book) state.ui.book.title = el.value; },
  'gl-search': el => { state.ui.glSearch = el.value; const seg = currentSeg(); if (seg) $('#gl-list').innerHTML = glossaryRows(seg); },
  'gl-filter': el => { state.ui.glFilter = el.value; const seg = currentSeg(); if (seg) $('#gl-list').innerHTML = glossaryRows(seg); },
  'capture-seg': el => { state.data.captureSeg = el.value; persist(); },
});

// Atajos del triage: 1 = La sé, 2 = Me suena, 3 = No la sé, 4 = No vale la pena, Z = deshacer.
KEY_HANDLERS.push((e, route) => {
  if (route !== 'triage') return false;
  const decision = { 1: 'known', 2: 'familiar', 3: 'unknown', 4: 'skipped' }[e.key];
  if (decision) { view.querySelector(`[data-decision="${decision}"]`)?.click(); e.preventDefault(); return true; }
  if (e.key === 'z' || e.key === 'Z') { actions['triage-undo'](); e.preventDefault(); return true; }
  return false;
});
