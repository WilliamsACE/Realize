'use strict';
/* Palabras de ejemplo para la primera visita. */

/* ===================== 2. Palabras de ejemplo ===================== */

// Cinco palabras con contenido ya generado, en etapas distintas para que la
// primera sesión muestre todos los tipos de ejercicio sin necesidad de API key.
function sampleWords(now = Date.now()) {
  const seeds = [
    {
      stage: 5, srs: { stability: 3, difficulty: 5, interval: 3, reps: 2, lapses: 0, due: now, last: now - 3 * DAY },
      word: 'reluctant', ipa: '/rɪˈlʌktənt/', pos: 'adjective', translation: 'reacio, renuente',
      definition: 'Not wanting to do something, so you are slow or unwilling to do it.',
      examples: ['She was reluctant to admit she was wrong.', 'He gave a reluctant smile when they asked him to sing.', 'Many companies are reluctant to hire people without experience.'],
      collocations: ['reluctant to admit', 'reluctant hero', 'highly reluctant'],
      family: ['reluctantly (adverb)', 'reluctance (noun)'],
      mnemonic: 'Suena a "re-lucha": alguien que lucha por no hacer algo, como ir al dentista.',
      distractors: ['entusiasmado', 'agradecido', 'cansado'],
    },
    {
      stage: 4, srs: { stability: 3, difficulty: 5, interval: 3, reps: 2, lapses: 0, due: now, last: now - 3 * DAY },
      word: 'thrive', ipa: '/θraɪv/', pos: 'verb', translation: 'prosperar, florecer',
      definition: 'To grow, develop, or be successful.',
      examples: ['Plants thrive in warm, humid conditions.', 'Some people thrive under pressure.', 'Her small bakery is thriving in the city center.'],
      collocations: ['thrive on', 'thrive in', 'thriving business'],
      family: ['thriving (adjective)', 'thrived / throve (past)'],
      mnemonic: 'Thrive suena a "tres vive": una planta que saca tres hojas nuevas porque vive y crece.',
      distractors: ['rendirse', 'esconderse', 'quejarse'],
    },
    {
      stage: 3, srs: { stability: 1.2, difficulty: 5, interval: 1, reps: 1, lapses: 0, due: now, last: now - DAY },
      word: 'overwhelm', ipa: '/ˌoʊvərˈwɛlm/', pos: 'verb', translation: 'abrumar, agobiar',
      definition: 'To affect someone so strongly that they cannot think or act normally.',
      examples: ['The amount of homework overwhelmed him.', 'She was overwhelmed by the kindness of strangers.', "Don't let small problems overwhelm you."],
      collocations: ['completely overwhelmed', 'overwhelmed by', 'overwhelming majority'],
      family: ['overwhelming (adjective)', 'overwhelmingly (adverb)', 'overwhelmed (adjective)'],
      mnemonic: 'Over (encima) + whelm: una ola que te cae encima y te tapa por completo.',
      distractors: ['aburrir', 'tranquilizar', 'convencer'],
    },
    {
      stage: 2, srs: { stability: 0.5, difficulty: 6, interval: 0, reps: 1, lapses: 0, due: now, last: now - DAY },
      word: 'cumbersome', ipa: '/ˈkʌmbərsəm/', pos: 'adjective', translation: 'engorroso, aparatoso',
      definition: 'Large, heavy, or complicated, and therefore difficult to carry, use, or do.',
      examples: ['The old computers were cumbersome and slow.', 'Filling out this form is a cumbersome process.', 'He carried a cumbersome suitcase up the stairs.'],
      collocations: ['cumbersome process', 'cumbersome equipment', 'slow and cumbersome'],
      family: ['cumbersomely (adverb)', 'cumbersomeness (noun)'],
      mnemonic: 'Cumber suena a "cumbre": subir algo pesado hasta la cumbre es engorroso.',
      distractors: ['ligero', 'práctico', 'elegante'],
    },
    {
      stage: 1, srs: null,
      word: 'endeavor', ipa: '/ɪnˈdɛvər/', pos: 'noun, verb', translation: 'esfuerzo, empeño; esforzarse',
      definition: 'A serious attempt to do something difficult; to try very hard to do something.',
      examples: ['Climbing Everest is a dangerous endeavor.', 'We will endeavor to answer every email within a day.', 'Good luck in all your future endeavors.'],
      collocations: ['a new endeavor', 'endeavor to do something', 'human endeavor'],
      family: ['endeavors (plural)', 'endeavored (past)', 'endeavour (British spelling)'],
      mnemonic: 'En-deber: lo que haces con empeño porque sientes que es tu deber.',
      distractors: ['descanso', 'fracaso', 'costumbre'],
    },
  ];
  return seeds.map(({ stage, srs, ...content }) => {
    const w = createWord(content);
    w.stage = stage;
    if (srs) { w.srs = srs; w.introducedAt = now - 3 * DAY; }
    return w;
  });
}
