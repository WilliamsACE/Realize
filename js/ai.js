'use strict';
/* Cliente de IA (Gemini, DeepSeek u OpenAI) con caché. */

/* ===================== 6. Cliente de IA (Gemini, DeepSeek u OpenAI) ===================== */

class AIError extends Error {
  constructor(code, message) { super(message); this.name = 'AIError'; this.code = code; }
}

const aiProvider = (settings = state.data.settings) => AI_PROVIDERS[settings.provider] || AI_PROVIDERS.gemini;
const providerKey = (settings = state.data.settings) => (settings[aiProvider(settings).keySetting] || '').trim();
const providerModel = (settings = state.data.settings) => cleanModel(settings[aiProvider(settings).modelSetting]) || aiProvider(settings).defaultModel;
const hasKey = () => !!providerKey();

/**
 * Pide JSON al proveedor elegido en Ajustes. Devuelve el objeto ya parseado o lanza
 * AIError con un mensaje en español listo para mostrar.
 */
async function callAI(req, settings = state.data.settings) {
  const p = aiProvider(settings);
  if (!providerKey(settings)) throw new AIError('NO_KEY', `Falta la ${p.keyLabel}. Agrégala en Ajustes para usar la IA.`);
  if (navigator.onLine === false) throw new AIError('OFFLINE', 'No tienes conexión a internet. Puedes seguir usando la app sin IA.');
  if (settings.provider === 'deepseek') return callChatCompletions(req, settings, DEEPSEEK_ENDPOINT, 'DeepSeek');
  if (settings.provider === 'openai') return callChatCompletions(req, settings, OPENAI_ENDPOINT, 'OpenAI');
  return callGemini(req, settings);
}

// fetch con tiempo límite; los fallos de red salen como AIError.
async function aiFetch(url, init, name) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const payload = await res.json().catch(() => null);
    return { res, payload };
  } catch (e) {
    if (e.name === 'AbortError') throw new AIError('TIMEOUT', `${name} tardó demasiado en responder. Intenta de nuevo.`);
    throw new AIError('NETWORK', `No se pudo conectar con ${name}. Revisa tu conexión a internet.`);
  } finally {
    clearTimeout(timer);
  }
}

// Gemini: generateContent con JSON y, si se puede, esquema de respuesta.
async function callGemini({ system, prompt, schema }, settings) {
  const model = providerModel(settings);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) },
  };
  const { res, payload } = await aiFetch(`${GEMINI_ENDPOINT}${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': providerKey(settings) },
    body: JSON.stringify(body),
  }, 'Gemini');

  if (!res.ok) {
    const err = httpError(res.status, payload, model, 'Gemini');
    // Si el modelo no acepta el esquema, reintenta una vez sin él (el prompt ya describe el JSON).
    if (err.code === 'BAD_REQUEST' && schema && /schema|generation_?config|invalid json payload/i.test(err.raw)) {
      return callGemini({ system, prompt, schema: null }, settings);
    }
    throw err;
  }
  return extractGeminiJSON(payload);
}

// DeepSeek y OpenAI: API de chat completions. Se usa el modo JSON en vez de esquemas
// (los prompts ya describen el JSON esperado y mencionan "JSON", como exige la API).
async function callChatCompletions({ system, prompt }, settings, endpoint, name, jsonMode = true) {
  const model = providerModel(settings);
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    // OpenAI ya no acepta max_tokens en sus modelos nuevos.
    ...(name === 'OpenAI' ? { max_completion_tokens: 8192 } : { max_tokens: 8192 }),
    stream: false,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  const { res, payload } = await aiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerKey(settings)}` },
    body: JSON.stringify(body),
  }, name);

  if (!res.ok) {
    const err = httpError(res.status, payload, model, name);
    // Algunos modelos no admiten el modo JSON: reintenta una vez sin él.
    if (err.code === 'BAD_REQUEST' && jsonMode && /response_format|json/i.test(err.raw)) {
      return callChatCompletions({ system, prompt }, settings, endpoint, name, false);
    }
    throw err;
  }
  const choice = payload?.choices?.[0];
  const text = String(choice?.message?.content || '').trim();
  if (!text) throw new AIError('EMPTY', `${name} devolvió una respuesta vacía. Intenta de nuevo.`);
  return parseJSONText(text, choice.finish_reason === 'length');
}

function httpError(status, payload, model, name) {
  const msg = payload?.error?.message || '';
  const detail = msg + ' ' + JSON.stringify(payload?.error?.details || '');
  let err;
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(detail)) {
    err = new AIError('INVALID_KEY', 'La clave de la IA no es válida. Revísala en Ajustes.');
  } else if (status === 401 || status === 403) {
    err = new AIError('INVALID_KEY', `La clave de la IA no es válida o no tiene permiso para usar ${name}. Revísala en Ajustes.`);
  } else if (status === 402) {
    err = new AIError('BALANCE', `Tu cuenta de ${name} no tiene saldo suficiente. Recarga créditos e intenta de nuevo.`);
  } else if (status === 404 || /model not exist|model_not_found|does not exist/i.test(msg + ' ' + (payload?.error?.code || ''))) {
    err = new AIError('MODEL', `No se encontró el modelo «${model}». Cambia el nombre del modelo en Ajustes.`);
  } else if (status === 429) {
    err = new AIError('RATE_LIMIT', `Llegaste al límite de uso de ${name} (peticiones por minuto o cuota diaria). Espera un momento e intenta de nuevo.`);
  } else if (status >= 500) {
    err = new AIError('SERVER', `${name} no está disponible en este momento (error ${status}). Intenta en unos minutos.`);
  } else {
    err = new AIError('BAD_REQUEST', `${name} rechazó la solicitud${msg ? ': ' + msg.slice(0, 180) : ` (error ${status}).`}`);
  }
  err.raw = detail;
  return err;
}

function extractGeminiJSON(payload) {
  const cand = payload?.candidates?.[0];
  if (!cand) {
    const block = payload?.promptFeedback?.blockReason;
    throw new AIError('BLOCKED', block ? `Gemini bloqueó la solicitud (${block}). Prueba con otro texto.` : 'Gemini no devolvió ninguna respuesta. Intenta de nuevo.');
  }
  // Ignora las partes de "pensamiento" de los modelos que razonan.
  const text = (cand.content?.parts || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
  if (!text) {
    if (cand.finishReason === 'SAFETY') throw new AIError('BLOCKED', 'Gemini bloqueó la respuesta por seguridad. Prueba con otro texto.');
    throw new AIError('EMPTY', 'Gemini devolvió una respuesta vacía. Intenta de nuevo.');
  }
  return parseJSONText(text, cand.finishReason === 'MAX_TOKENS');
}

// Parsea el JSON de la respuesta, tolerando ```json ... ``` o texto alrededor.
function parseJSONText(text, truncated) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { /* se intenta rescatar abajo */ }
  const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { /* inválido */ } }
  throw new AIError('BAD_JSON', truncated
    ? 'La respuesta de la IA se cortó antes de terminar. Prueba con menos palabras a la vez.'
    : 'La IA devolvió una respuesta que no se pudo leer. Intenta de nuevo.');
}

const S = { type: 'STRING' };
const SA = { type: 'ARRAY', items: S };
const CARD_FIELDS = ['word', 'definition', 'translation', 'ipa', 'pos', 'examples', 'collocations', 'family', 'mnemonic', 'distractors', 'otherMeanings', 'noteFeedback'];
const ENRICH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { word: S, definition: S, translation: S, ipa: S, pos: S, examples: SA, collocations: SA, family: SA, mnemonic: S, distractors: SA, otherMeanings: SA, noteFeedback: S },
        required: CARD_FIELDS,
      },
    },
  },
  required: ['items'],
};

const ENRICH_SYSTEM = 'You are an expert lexicographer who writes vocabulary cards for Spanish-speaking learners of English (B1-B2 level). You always answer with valid JSON only.';

// Clave de caché: la misma palabra con otro comentario es otra tarjeta ("lads ((amigos))").
const enrichKey = (base, note) => (note ? `${base} ((${normalize(note)}))` : base);

/* items: [{ word, note?, context? }]. El contexto es la oración del libro y la nota, el
   comentario del usuario; ambos sirven para elegir el sentido correcto. */
function enrichPrompt(items) {
  return `Create one vocabulary card for each of these English words or expressions, in the same order:
${items.map((it, i) => `${i + 1}. ${it.word}${it.note ? ` — learner's note (the meaning they want to remember): "${it.note.slice(0, 120)}"` : ''}${it.context ? ` — context: "${it.context.slice(0, 300)}"` : ''}`).join('\n')}

Return JSON: {"items": [{"word", "definition", "translation", "ipa", "pos", "examples", "collocations", "family", "mnemonic", "distractors", "otherMeanings", "noteFeedback"}]}
Rules for each item:
- word: the dictionary form of the word (fix obvious misspellings; e.g. "thriving" -> "thrive" unless the -ing form is its own word).
- Multi-word items (phrasal verbs like "kick off", idioms like "to boot") are ONE expression: keep it whole in "word" and define its idiomatic meaning in that context, not the meaning of each word (e.g. "to boot" = "además, para colmo"). The examples must use the whole expression.
- If a context sentence is given, the definition, translation, part of speech and distractors must match the meaning used in THAT sentence (words can have several meanings).
- If the learner gives a note, the card is about the meaning closest to that note: "translation" must START with the Spanish word closest to the note, and the definition, part of speech, examples and distractors must match that meaning.
- definition: a simple English definition, max 20 words, without using the word itself.
- translation: the 1-3 most common Spanish translations for that meaning, comma separated.
- ipa: General American IPA between slashes, e.g. /rɪˈlʌktənt/.
- pos: part of speech in English (noun, verb, adjective, adverb, phrasal verb...).
- examples: exactly 3 natural, everyday sentences of your own (do NOT copy the context); each one must contain the word or an inflected form of it.
- collocations: exactly 3 common collocations.
- family: related word forms, each followed by its part of speech in parentheses, e.g. "reluctance (noun)".
- mnemonic: a short memory trick written in Spanish, max 25 words.
- distractors: exactly 3 Spanish words or short phrases with the same part of speech that are plausible but WRONG translations (not synonyms of the correct one), for a multiple-choice quiz.
- otherMeanings: up to 3 OTHER common meanings of the word, different from the main one, each written in Spanish as "significado (nota breve de uso)", e.g. "chicos (informal, británico)". Empty array if it has no other common meanings.
- noteFeedback: only if the learner gave a note: in Spanish, max 30 words, say whether the note fits the word and add any useful nuance (register, region, typical use, other meanings to watch for). Empty string if there is no note.`;
}

/* ---------- Rescate de palabras difíciles ---------- */

const RESCUE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mnemonic: S, why: S,
    confusables: { type: 'ARRAY', items: { type: 'OBJECT', properties: { word: S, meaning: S, difference: S }, required: ['word', 'meaning', 'difference'] } },
    contrast: { type: 'ARRAY', items: { type: 'OBJECT', properties: { sentence: S, answer: S }, required: ['sentence', 'answer'] } },
  },
  required: ['mnemonic', 'why', 'confusables', 'contrast'],
};

function rescuePrompt(w) {
  const ctx = w.contexts?.[0]?.text;
  return `A Spanish-speaking learner (B1-B2) keeps forgetting the English word "${w.word}"${w.pos ? ` (${w.pos})` : ''}, which means "${w.translation}"${w.definition ? ` (${w.definition})` : ''}.
${ctx ? `It appears in the book they are reading: "${ctx.slice(0, 300)}"\n` : ''}${w.mistakes?.length ? `Their wrong answers so far: ${w.mistakes.map(m => `"${m}"`).join(', ')}.\n` : ''}${w.mnemonic ? `This memory trick did NOT work for them: "${w.mnemonic}".\n` : ''}
Return JSON: {"mnemonic", "why", "confusables", "contrast"}
- mnemonic: a NEW memory trick in Spanish (max 30 words), different from the one that failed. Prefer the keyword method: a Spanish word that sounds like "${w.word}" linked to its meaning in one concrete, vivid, even absurd mental image.
- why: in Spanish, max 25 words: the most likely reason this word is hard for them (false friend, similar spelling to another word, abstract meaning...).
- confusables: 2 or 3 English words they are likely to confuse with "${w.word}" (similar spelling, sound or meaning; include their wrong answers if those are English words). Each one: word, meaning (Spanish, 1-3 words), difference (Spanish, max 20 words: how to tell it apart from "${w.word}").
- contrast: 4 short, natural English sentences, each with "___" in place of exactly ONE word. Exactly 2 must be completed by "${w.word}" and the others by one of the confusables. Only one of the words must fit each sentence. answer: the word that fills the gap, as written in the sentence.`;
}

async function fetchRescueAid(w, settings = state.data.settings) {
  const raw = await callAI({ system: ENRICH_SYSTEM, prompt: rescuePrompt(w), schema: RESCUE_SCHEMA }, settings);
  const str = v => String(v ?? '').trim();
  const confusables = (Array.isArray(raw?.confusables) ? raw.confusables : [])
    .map(c => ({ word: str(c?.word), meaning: str(c?.meaning), difference: str(c?.difference) }))
    .filter(c => c.word && normalize(c.word) !== normalize(w.word)).slice(0, 3);
  const contrast = (Array.isArray(raw?.contrast) ? raw.contrast : [])
    .map(c => ({ sentence: str(c?.sentence), answer: str(c?.answer) }))
    .filter(c => /_{2,}/.test(c.sentence) && c.answer).slice(0, 5);
  return { mnemonic: str(raw?.mnemonic), why: str(raw?.why), confusables, contrast, at: Date.now() };
}

/* ---------- Grupos de palabras ---------- */

const GROUP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    theme: S,
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { word: S, short: S }, required: ['word', 'short'] } },
  },
  required: ['theme', 'items'],
};

// words: [{ word, meaning? }] (meaning: la traducción o el comentario del usuario, para elegir el sentido).
function groupPrompt(words, type) {
  const meaning = type === 'meaning';
  return `A Spanish-speaking learner (B1-B2) put these English words in one group because they ${meaning ? 'mean almost the same thing' : 'look or sound alike and they mix them up'}:
${words.map((w, i) => `${i + 1}. ${w.word}${w.meaning ? ` — the meaning they study: "${String(w.meaning).slice(0, 120)}"` : ''}`).join('\n')}

Return JSON: {"theme", "items": [{"word", "short"}]} with one item per word, in the same order.
- theme: ${meaning ? 'the idea they share, in Spanish, 1-3 lowercase words (e.g. "tristeza", "hablar mucho")' : 'an empty string'}.
- short: a very short, simple English definition of that word: max 8 words, only the essential idea${meaning ? ', plus what makes it different from the other words of the group (intensity, manner, register, who or what it applies to)' : ''}. Never use the word itself or another word of the group. Each definition must fit ONLY its own word, so the learner can match them without doubt. No final period.`;
}

async function fetchGroupDefs(words, type, settings = state.data.settings) {
  const raw = await callAI({ system: ENRICH_SYSTEM, prompt: groupPrompt(words, type), schema: GROUP_SCHEMA }, settings);
  const out = Array.isArray(raw?.items) ? raw.items : [];
  if (!out.length) throw new AIError('BAD_JSON', 'La IA no devolvió las definiciones del grupo. Intenta de nuevo.');
  const str = v => String(v ?? '').trim().replace(/\.$/, '');
  return {
    theme: type === 'meaning' ? str(raw?.theme) : '',
    defs: words.map((w, i) => str((out.find(o => normalize(o?.word) === normalize(w.word)) || out[i])?.short)),
  };
}

// Grupos que la IA propone a partir de tu lista (Mis palabras → Grupos).
const SUGGEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    groups: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { type: { type: 'STRING', format: 'enum', enum: ['meaning', 'spelling'] }, theme: S, words: SA, defs: SA },
        required: ['type', 'theme', 'words', 'defs'],
      },
    },
  },
  required: ['groups'],
};

// words: [{ word, meaning }]; existing: listas de palabras de los grupos que ya tiene.
function suggestPrompt(words, existing) {
  return `A Spanish-speaking learner (B1-B2) is studying these English words (word — Spanish meaning):
${words.map(w => `- ${w.word}${w.meaning ? ` — ${String(w.meaning).slice(0, 60)}` : ''}`).join('\n')}
${existing.length ? `\nThey already practise these groups, do not repeat them: ${existing.map(g => g.join(', ')).join(' | ')}\n` : ''}
Find groups of words FROM THIS LIST that are worth practising together because they are easy to mix up:
- "meaning": 2-6 words that mean almost the same thing or share the same idea (e.g. bawl, blubber, sob → crying).
- "spelling": 2-4 words that look or sound alike (e.g. dazzled, gazed).
Return JSON: {"groups": [{"type", "theme", "words", "defs"}]} with at most 8 groups, the most useful first.
- words: copied exactly from the list. Never add words that are not in the list. Each word in at most one group.
- theme: for "meaning", the shared idea in Spanish, 1-3 lowercase words; for "spelling", an empty string.
- defs: one very short English definition per word (max 8 words), in the same order as "words", showing what makes it different from the others. Never use the word itself.
Only include groups that really help; return {"groups": []} if there are none.`;
}

async function fetchGroupSuggestions(words, existing, settings = state.data.settings) {
  const raw = await callAI({ system: ENRICH_SYSTEM, prompt: suggestPrompt(words, existing), schema: SUGGEST_SCHEMA }, settings);
  const str = v => String(v ?? '').trim().replace(/\.$/, '');
  return (Array.isArray(raw?.groups) ? raw.groups : []).map(g => ({
    type: g?.type === 'spelling' ? 'spelling' : 'meaning',
    theme: str(g?.theme),
    words: (Array.isArray(g?.words) ? g.words : []).map(str).filter(Boolean),
    defs: (Array.isArray(g?.defs) ? g.defs : []).map(str),
  }));
}

async function enrichWords(list, settings = state.data.settings) {
  const items = list.map(it => (typeof it === 'string' ? { word: it } : it));
  const raw = await callAI({ system: ENRICH_SYSTEM, prompt: enrichPrompt(items), schema: ENRICH_SCHEMA }, settings);
  const out = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : null;
  if (!out) throw new AIError('BAD_JSON', 'La IA devolvió una respuesta sin la lista de palabras. Intenta de nuevo.');
  // Empareja cada palabra pedida con su resultado: primero por texto, luego por posición.
  return items.map((it, i) => {
    const match = out.find(o => normalize(o?.word) === normalize(it.word)) || out[i];
    if (!match || typeof match !== 'object') return { ...cleanContent({ word: it.word }), _aiMissing: true };
    const c = cleanContent(match);
    if (!c.word) c.word = it.word;
    return c;
  });
}

/* Enriquecimiento con caché en IndexedDB: cada palabra se pide a la IA una sola vez.
   items: [{ word, lemma, context? }]. Devuelve { results: Map(lemma → contenido), error }
   para conservar lo que sí se completó aunque falle una tanda. */
async function enrichCached(items, { onProgress } = {}) {
  const results = new Map();
  const todo = [];
  for (const it of items) {
    const hit = state.lib.aiCache.get(it.lemma);
    if (hit) results.set(it.lemma, hit.content);
    else if (!todo.some(t => t.lemma === it.lemma)) todo.push(it);
  }
  let error = null;
  try {
    for (let i = 0; i < todo.length; i += ENRICH_BATCH) {
      onProgress?.(i, todo.length);
      const batch = todo.slice(i, i + ENRICH_BATCH);
      const res = await enrichWords(batch);
      res.forEach((c, j) => {
        if (c._aiMissing) return;
        libCachePut(batch[j].lemma, c);
        results.set(batch[j].lemma, c);
      });
    }
  } catch (e) {
    error = e;
  }
  return { results, error };
}

// Copia el contenido de la IA a una palabra en estudio (sin tocar su progreso ni sus oraciones del libro).
function applyContent(w, c) {
  for (const k of ['definition', 'translation', 'ipa', 'pos', 'mnemonic', 'noteFeedback']) if (c[k]) w[k] = c[k];
  for (const k of ['examples', 'collocations', 'family', 'distractors', 'otherMeanings']) if (c[k]?.length) w[k] = c[k].slice();
  if (c.word && w.source !== 'manual' && normalize(c.word) !== normalize(w.word) && !wordExists(c.word, w.id)) {
    if (!w.forms.includes(normalize(w.word))) w.forms.push(normalize(w.word));
    w.word = c.word;
  }
}

// Enriquece palabras en estudio que no tienen significado. Devuelve cuántas se completaron.
async function enrichStudyWords(words, opts = {}) {
  const items = words.map(w => ({ word: w.word, note: w.note, lemma: enrichKey(lemmaOf(w), w.note), context: w.contexts[0]?.text || '' }));
  const { results, error } = await enrichCached(items, opts);
  let n = 0;
  for (const w of words) {
    const c = results.get(enrichKey(lemmaOf(w), w.note));
    if (c) { applyContent(w, c); n++; }
  }
  persist();
  return { done: n, error };
}

const FEEDBACK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', format: 'enum', enum: ['correcto', 'casi', 'incorrecto'] },
    errors: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { fragment: S, correction: S, explanation: S }, required: ['fragment', 'correction', 'explanation'] },
    },
    corrected: S,
    natural: S,
    explanation: S,
    sense: S,
    sameSense: { type: 'BOOLEAN' },
  },
  required: ['verdict', 'errors', 'corrected', 'natural', 'explanation', 'sense', 'sameSense'],
};

function feedbackSystem(word) {
  return `Eres un tutor de inglés para un hispanohablante. Evalúa si la palabra "${word}" se usó correctamente en el contexto, con cualquiera de sus significados reales. Sé preciso, amable y breve. Responde solo con JSON válido.`;
}

// Lo que el usuario eligió no corregir en sus oraciones (Ajustes → Estudio).
function ignoredAspects(s = state.data.settings) {
  return [
    s.ignoreCase && 'mayúsculas y minúsculas',
    s.ignorePunct && 'signos de puntuación (puntos, comas, signos de pregunta o exclamación, comillas)',
    s.ignoreApostrophes && 'apóstrofos en contracciones y posesivos (dont / don\'t)',
  ].filter(Boolean);
}
// ¿El error solo cambia cosas que el usuario pidió ignorar? ("london" → "London")
function onlyIgnored(e, s) {
  let a = e.fragment, b = e.correction;
  if (s.ignoreCase) { a = a.toLowerCase(); b = b.toLowerCase(); }
  if (s.ignoreApostrophes) { a = a.replace(/['’]/g, ''); b = b.replace(/['’]/g, ''); }
  if (s.ignorePunct) { const p = /[.,;:!?¡¿"“”«»()…–—]/g; a = a.replace(p, ''); b = b.replace(p, ''); }
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

function feedbackPrompt(w, sentence, settings = state.data.settings) {
  const ignored = ignoredAspects(settings);
  const studied = [w.translation && `«${w.translation}»`, w.definition && `(${w.definition})`].filter(Boolean).join(' ');
  return `Palabra objetivo: "${w.word}"${w.pos ? ` (${w.pos})` : ''}
Significado que el estudiante está aprendiendo: ${studied || 'no indicado'}${w.otherMeanings?.length ? `
Otros significados de la palabra: ${w.otherMeanings.join('; ')}` : ''}
Oración del estudiante: """${sentence}"""

Primero identifica con qué significado usó el estudiante "${w.word}" EN SU ORACIÓN. No supongas que es el que está aprendiendo: una palabra puede tener varios significados reales (p. ej. "dazzle" = impresionar o deslumbrar con luz).

Devuelve JSON con estos campos:
- sense: el significado con el que la usó en esta oración, en español, de 1 a 4 palabras (p. ej. "deslumbrar (con luz)").
- sameSense: true si coincide con el significado que está aprendiendo; false si es otro significado real de la palabra.
- verdict: "correcto" si la palabra se usa con un significado real y la función gramatical adecuada y la oración no tiene errores (usar otro significado real NO es un error); "casi" si la palabra está bien usada pero hay errores de gramática u ortografía o una colocación poco natural; "incorrecto" si la palabra se usa con un significado que no tiene, en una función gramatical incorrecta o no aparece.
- errors: lista de errores. "fragment" es el texto EXACTO copiado de la oración del estudiante (lo más corto posible), "correction" es el reemplazo y "explanation" una explicación muy breve en español. Lista vacía si no hay errores.
- corrected: la oración con los mínimos cambios necesarios para que sea correcta (igual a la original si ya lo es).
- natural: una versión más natural, como la diría un hablante nativo, manteniendo la idea.
- explanation: explicación breve en español, máximo 3 líneas, enfocada en el uso de "${w.word}" con el significado que el estudiante USÓ (sense). Nunca expliques la oración como si tuviera el significado que está aprendiendo si no lo tiene; si sameSense es false, dilo con claridad.${ignored.length ? `

IMPORTANTE: el estudiante pidió ignorar ${ignored.join('; ')}. No los cuentes como errores, no los incluyas en "errors", no bajes el veredicto por ellos y no los cambies en "corrected".` : ''}`;
}

function normalizeFeedback(raw, sentence, settings = state.data.settings) {
  if (!raw || typeof raw !== 'object') throw new AIError('BAD_JSON', 'La IA devolvió una respuesta que no se pudo leer. Intenta de nuevo.');
  const v = normalize(raw.verdict);
  const verdict = /^(correcto|correct)$/.test(v) ? 'correcto' : /^(casi|almost|nearly)/.test(v) ? 'casi' : /incorrect/.test(v) ? 'incorrecto' : null;
  if (!verdict) throw new AIError('BAD_JSON', 'La IA no indicó un veredicto válido. Intenta de nuevo.');
  const errors = (Array.isArray(raw.errors) ? raw.errors : [])
    .filter(e => e && typeof e.fragment === 'string' && e.fragment.trim())
    .map(e => ({ fragment: e.fragment.trim(), correction: String(e.correction || '').trim(), explanation: String(e.explanation || '').trim() }))
    .slice(0, 8);
  // Por si la IA igual marcó algo que el usuario pidió ignorar: se descarta, y si solo
  // había errores de ese tipo, la oración cuenta como correcta.
  const kept = errors.filter(e => !onlyIgnored(e, settings));
  const finalVerdict = verdict === 'casi' && errors.length && !kept.length ? 'correcto' : verdict;
  const explanation = String(raw.explanation || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3).join('\n');
  const corrected = String(raw.corrected || sentence).trim();
  // Significado con el que se usó la palabra en la oración (puede no ser el que se estudia).
  const sense = String(raw.sense || '').trim().replace(/\.$/, '');
  return { verdict: finalVerdict, errors: kept, corrected, natural: String(raw.natural || corrected).trim(), explanation, sense, sameSense: raw.sameSense !== false || !sense };
}

async function evaluateSentence(w, sentence, settings = state.data.settings) {
  const raw = await callAI({ system: feedbackSystem(w.word), prompt: feedbackPrompt(w, sentence, settings), schema: FEEDBACK_SCHEMA }, settings);
  return normalizeFeedback(raw, sentence, settings);
}

function errorText(e) {
  return e instanceof AIError ? e.message : `Ocurrió un error inesperado: ${e?.message || e}`;
}
