'use strict';

/* ------------------------------------------------------------------
   Expression engine
   Tokens are numbers and the four operators. Expressions are parsed
   with a tiny recursive-descent parser, never with eval().
   ------------------------------------------------------------------ */

const OPERATORS = ['+', '\u2212', '\u00d7', '\u00f7']; // + − × ÷
const OP_TEST = /[+\u2212\u00d7\u00f7]/;
const MAX_INPUT_DIGITS = 12;

/* Words used for spoken feedback. */
const SPOKEN = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  '.': 'point',
  '+': 'plus',
  '\u2212': 'minus',
  '\u00d7': 'times',
  '\u00f7': 'divided by',
};

function isOperator(ch) {
  return OPERATORS.includes(ch);
}

function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ') {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let raw = '';
      while (i < input.length && /[0-9.]/.test(input[i])) {
        raw += input[i];
        i += 1;
      }
      if (raw === '.' || (raw.match(/\./g) || []).length > 1) return null;
      tokens.push({ type: 'number', value: Number(raw) });
      continue;
    }

    if (isOperator(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i += 1;
      continue;
    }

    return null; // unknown character
  }

  return tokens;
}

function evaluate(input) {
  const tokens = tokenize(input);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  const peek = () => tokens[pos];

  function parseFactor() {
    const token = peek();
    if (!token) return null;

    if (token.type === 'operator' && (token.value === '\u2212' || token.value === '+')) {
      pos += 1; // unary sign
      const value = parseFactor();
      if (value === null) return null;
      return token.value === '\u2212' ? -value : value;
    }

    if (token.type === 'number') {
      pos += 1;
      return token.value;
    }

    return null;
  }

  function parseTerm() {
    let value = parseFactor();
    if (value === null) return null;

    while (peek() && peek().type === 'operator' && (peek().value === '\u00d7' || peek().value === '\u00f7')) {
      const op = tokens[pos].value;
      pos += 1;
      const rhs = parseFactor();
      if (rhs === null) return null;
      if (op === '\u00d7') {
        value *= rhs;
      } else {
        if (rhs === 0) return null; // division by zero
        value /= rhs;
      }
    }

    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    if (value === null) return null;

    while (peek() && peek().type === 'operator' && (peek().value === '+' || peek().value === '\u2212')) {
      const op = tokens[pos].value;
      pos += 1;
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === '+' ? value + rhs : value - rhs;
    }

    return value;
  }

  const result = parseExpression();
  if (result === null || pos !== tokens.length) return null;
  if (!Number.isFinite(result)) return null;
  return result;
}

/* Display helpers ------------------------------------------------- */

function format(value) {
  if (!Number.isFinite(value)) return 'Error';
  if (value === 0 || Object.is(value, -0)) return '0';

  const abs = Math.abs(value);

  if (abs >= 1e12 || abs < 1e-9) {
    return value
      .toExponential(6)
      .replace(/\.?0+e/, 'e')
      .replace('e+', 'e');
  }

  // toPrecision(12) trims floating point noise such as 0.1 + 0.2.
  return String(Number(value.toPrecision(12)));
}

function normalize(text) {
  return text
    .replace(/\u2212/g, '-')
    .replace(/\u00d7/g, '*')
    .replace(/\u00f7/g, '/');
}

/** Plain decimal text, so results in scientific notation stay editable. */
function toPlainString(value) {
  const text = String(value);
  if (!/e/i.test(text)) return text;

  if (Math.abs(value) < 1) {
    return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
  }

  try {
    return BigInt(Math.round(value)).toString();
  } catch {
    return text;
  }
}

/** Round a result for speech so long decimals don't get read out digit by digit. */
function spokenAmount(text) {
  const value = Number(text);
  if (!Number.isFinite(value)) return spokenNumber(text);
  return spokenNumber(String(Number(value.toPrecision(4))));
}

/** Human unit name for speech, e.g. "degrees Celsius", "square feet". */
function spokenUnitName(category, unit) {
  const base = unit.label.replace(/\s*\([^)]*\)/g, '').trim();
  if (category.temperature) {
    return unit.id === 'k' ? 'kelvin' : 'degrees ' + base;
  }
  return base;
}

/** Turn a result string into something a speech voice reads naturally. */
function spokenNumber(text) {
  if (!text) return '';
  return text
    .replace(/\u2212/g, '-')
    .replace(/-/g, ' minus ')
    .replace(/e([+-]?\d+)$/, ' times ten to the $1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------
   Unit conversion
   Linear units store a factor to their category's base unit.
   Temperature is affine, so it converts through Celsius instead.
   ------------------------------------------------------------------ */

const UNIT_CATEGORIES = [
  {
    id: 'length',
    label: 'Length',
    defaults: ['m', 'ft'],
    units: [
      { id: 'mm', label: 'Millimeters', symbol: 'mm', factor: 0.001 },
      { id: 'cm', label: 'Centimeters', symbol: 'cm', factor: 0.01 },
      { id: 'm', label: 'Meters', symbol: 'm', factor: 1 },
      { id: 'km', label: 'Kilometers', symbol: 'km', factor: 1000 },
      { id: 'in', label: 'Inches', symbol: 'in', factor: 0.0254 },
      { id: 'ft', label: 'Feet', symbol: 'ft', factor: 0.3048 },
      { id: 'yd', label: 'Yards', symbol: 'yd', factor: 0.9144 },
      { id: 'mi', label: 'Miles', symbol: 'mi', factor: 1609.344 },
      { id: 'nmi', label: 'Nautical miles', symbol: 'nmi', factor: 1852 },
    ],
  },
  {
    id: 'mass',
    label: 'Mass',
    defaults: ['kg', 'lb'],
    units: [
      { id: 'mg', label: 'Milligrams', symbol: 'mg', factor: 0.001 },
      { id: 'g', label: 'Grams', symbol: 'g', factor: 1 },
      { id: 'kg', label: 'Kilograms', symbol: 'kg', factor: 1000 },
      { id: 't', label: 'Metric tons', symbol: 't', factor: 1000000 },
      { id: 'oz', label: 'Ounces', symbol: 'oz', factor: 28.349523125 },
      { id: 'lb', label: 'Pounds', symbol: 'lb', factor: 453.59237 },
      { id: 'st', label: 'Stone', symbol: 'st', factor: 6350.29318 },
      { id: 'ton', label: 'US tons', symbol: 'ton', factor: 907184.74 },
    ],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    defaults: ['c', 'f'],
    temperature: true,
    units: [
      { id: 'c', label: 'Celsius', symbol: '\u00b0C' },
      { id: 'f', label: 'Fahrenheit', symbol: '\u00b0F' },
      { id: 'k', label: 'Kelvin', symbol: 'K' },
      { id: 'r', label: 'Rankine', symbol: '\u00b0R' },
    ],
  },
  {
    id: 'volume',
    label: 'Volume',
    defaults: ['l', 'gal'],
    units: [
      { id: 'ml', label: 'Milliliters', symbol: 'mL', factor: 0.001 },
      { id: 'l', label: 'Liters', symbol: 'L', factor: 1 },
      { id: 'm3', label: 'Cubic meters', symbol: 'm\u00b3', factor: 1000 },
      { id: 'tsp', label: 'Teaspoons (US)', symbol: 'tsp', factor: 0.00492892159375 },
      { id: 'tbsp', label: 'Tablespoons (US)', symbol: 'tbsp', factor: 0.01478676478125 },
      { id: 'floz', label: 'Fluid ounces (US)', symbol: 'fl oz', factor: 0.0295735295625 },
      { id: 'cup', label: 'Cups (US)', symbol: 'cup', factor: 0.2365882365 },
      { id: 'pt', label: 'Pints (US)', symbol: 'pt', factor: 0.473176473 },
      { id: 'qt', label: 'Quarts (US)', symbol: 'qt', factor: 0.946352946 },
      { id: 'gal', label: 'Gallons (US)', symbol: 'gal', factor: 3.785411784 },
      { id: 'ukgal', label: 'Gallons (UK)', symbol: 'imp gal', factor: 4.54609 },
    ],
  },
  {
    id: 'area',
    label: 'Area',
    defaults: ['m2', 'ft2'],
    units: [
      { id: 'mm2', label: 'Square millimeters', symbol: 'mm\u00b2', factor: 0.000001 },
      { id: 'cm2', label: 'Square centimeters', symbol: 'cm\u00b2', factor: 0.0001 },
      { id: 'm2', label: 'Square meters', symbol: 'm\u00b2', factor: 1 },
      { id: 'ha', label: 'Hectares', symbol: 'ha', factor: 10000 },
      { id: 'acre', label: 'Acres', symbol: 'acre', factor: 4046.8564224 },
      { id: 'km2', label: 'Square kilometers', symbol: 'km\u00b2', factor: 1000000 },
      { id: 'in2', label: 'Square inches', symbol: 'in\u00b2', factor: 0.00064516 },
      { id: 'ft2', label: 'Square feet', symbol: 'ft\u00b2', factor: 0.09290304 },
      { id: 'yd2', label: 'Square yards', symbol: 'yd\u00b2', factor: 0.83612736 },
      { id: 'mi2', label: 'Square miles', symbol: 'mi\u00b2', factor: 2589988.110336 },
    ],
  },
  {
    id: 'speed',
    label: 'Speed',
    defaults: ['kmh', 'mph'],
    units: [
      { id: 'ms', label: 'Meters per second', symbol: 'm/s', factor: 1 },
      { id: 'kmh', label: 'Kilometers per hour', symbol: 'km/h', factor: 1 / 3.6 },
      { id: 'mph', label: 'Miles per hour', symbol: 'mph', factor: 0.44704 },
      { id: 'knot', label: 'Knots', symbol: 'kn', factor: 1852 / 3600 },
      { id: 'fts', label: 'Feet per second', symbol: 'ft/s', factor: 0.3048 },
    ],
  },
  {
    id: 'time',
    label: 'Time',
    defaults: ['h', 'min'],
    units: [
      { id: 'ms', label: 'Milliseconds', symbol: 'ms', factor: 0.001 },
      { id: 's', label: 'Seconds', symbol: 's', factor: 1 },
      { id: 'min', label: 'Minutes', symbol: 'min', factor: 60 },
      { id: 'h', label: 'Hours', symbol: 'h', factor: 3600 },
      { id: 'day', label: 'Days', symbol: 'day', factor: 86400 },
      { id: 'week', label: 'Weeks', symbol: 'week', factor: 604800 },
      { id: 'month', label: 'Months (average)', symbol: 'mo', factor: 2629800 },
      { id: 'year', label: 'Years (365.25 days)', symbol: 'yr', factor: 31557600 },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    defaults: ['mb', 'mib'],
    units: [
      { id: 'bit', label: 'Bits', symbol: 'bit', factor: 0.125 },
      { id: 'byte', label: 'Bytes', symbol: 'B', factor: 1 },
      { id: 'kb', label: 'Kilobytes', symbol: 'KB', factor: 1e3 },
      { id: 'mb', label: 'Megabytes', symbol: 'MB', factor: 1e6 },
      { id: 'gb', label: 'Gigabytes', symbol: 'GB', factor: 1e9 },
      { id: 'tb', label: 'Terabytes', symbol: 'TB', factor: 1e12 },
      { id: 'kib', label: 'Kibibytes', symbol: 'KiB', factor: 1024 },
      { id: 'mib', label: 'Mebibytes', symbol: 'MiB', factor: 1048576 },
      { id: 'gib', label: 'Gibibytes', symbol: 'GiB', factor: 1073741824 },
      { id: 'tib', label: 'Tebibytes', symbol: 'TiB', factor: 1099511627776 },
    ],
  },
];

function toCelsius(value, unitId) {
  switch (unitId) {
    case 'f':
      return ((value - 32) * 5) / 9;
    case 'k':
      return value - 273.15;
    case 'r':
      return ((value - 491.67) * 5) / 9;
    default:
      return value;
  }
}

function fromCelsius(value, unitId) {
  switch (unitId) {
    case 'f':
      return (value * 9) / 5 + 32;
    case 'k':
      return value + 273.15;
    case 'r':
      return ((value + 273.15) * 9) / 5;
    default:
      return value;
  }
}

function findUnit(category, unitId) {
  return category.units.find((unit) => unit.id === unitId) || category.units[0];
}

function convertAmount(category, value, fromId, toId) {
  const from = category.units.find((unit) => unit.id === fromId);
  const to = category.units.find((unit) => unit.id === toId);
  if (!from || !to || !Number.isFinite(value)) return null;

  if (category.temperature) {
    return fromCelsius(toCelsius(value, fromId), toId);
  }

  return (value * from.factor) / to.factor;
}

/** Strict numeric input: "12", "-4.5", ".25", "1e3". */
function parseAmount(text) {
  const trimmed = String(text).trim();
  if (trimmed === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/* UI -------------------------------------------------------------- */

function initApp(doc) {
  const el = {
    display: doc.getElementById('display'),
    expr: doc.getElementById('expr'),
    preview: doc.getElementById('preview'),
    keys: doc.getElementById('keys'),
    voice: doc.getElementById('voice'),
    historyList: doc.getElementById('history'),
    historyEmpty: doc.getElementById('history-empty'),
    historyCount: doc.getElementById('history-count'),
    historyClear: doc.getElementById('history-clear'),
    historyToggle: doc.getElementById('history-toggle'),
    modes: doc.querySelector('.modes'),
    tabCalc: doc.getElementById('tab-calc'),
    tabConvert: doc.getElementById('tab-convert'),
    tabAi: doc.getElementById('tab-ai'),
    panelCalc: doc.getElementById('panel-calc'),
    panelConvert: doc.getElementById('panel-convert'),
    panelAi: doc.getElementById('panel-ai'),
    panelHistory: doc.getElementById('panel-history'),
    categories: doc.getElementById('categories'),
    convInput: doc.getElementById('conv-input'),
    convFrom: doc.getElementById('conv-from'),
    convTo: doc.getElementById('conv-to'),
    convResult: doc.getElementById('conv-result'),
    convRate: doc.getElementById('conv-rate'),
    convSwap: doc.getElementById('conv-swap'),
    convAnnounce: doc.getElementById('conv-announce'),
    convFromButton: doc.getElementById('conv-from-button'),
    convFromLabel: doc.getElementById('conv-from-label'),
    convToButton: doc.getElementById('conv-to-button'),
    convToLabel: doc.getElementById('conv-to-label'),
  };

  const state = {
    expr: '',
    evaluated: false,
    error: false,
    history: [],
  };

  const HISTORY_LIMIT = 100;

  /* --- spoken feedback --- */

  const view = doc.defaultView;
  const VOICE_KEY = 'calculator.voice';
  let voiceOn = true;
  let speakTimer = 0;
  let silent = false; // keyboard auto-repeat, so holding a key doesn't babble
  let audioCtx = null;
  let audioOut = null;

  try {
    voiceOn = view.localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    /* storage blocked: keep the default */
  }

  function getNativeSpeech() {
    try {
      const capacitor = view.Capacitor;
      if (
        !capacitor ||
        typeof capacitor.isNativePlatform !== 'function' ||
        !capacitor.isNativePlatform()
      ) {
        return null;
      }

      return capacitor.Plugins && capacitor.Plugins.NativeSpeech
        ? capacitor.Plugins.NativeSpeech
        : null;
    } catch {
      return null;
    }
  }

  // Start the Android TTS engine early so the first key press is not delayed.
  const warmupNativeSpeech = getNativeSpeech();
  if (warmupNativeSpeech) {
    try {
      const result = warmupNativeSpeech.isAvailable();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      /* speech is unavailable */
    }
  }

  function speak(text, delay = 30) {
    if (silent || !voiceOn || !text) return;

    const nativeSpeech = getNativeSpeech();
    const synthesis = view.speechSynthesis;

    if (nativeSpeech) {
      try {
        view.clearTimeout(speakTimer);
        if (synthesis) {
          try {
            synthesis.cancel();
          } catch {
            /* speech is unavailable */
          }
        }

        speakTimer = view.setTimeout(() => {
          try {
            const result = nativeSpeech.speak({
              text: String(text),
              lang: 'en-US',
              rate: 1.1,
              pitch: 1.0,
            });
            if (result && typeof result.catch === 'function') {
              result.catch(() => {});
            }
          } catch {
            /* speech is unavailable */
          }
        }, delay);
      } catch {
        /* speech is unavailable */
      }
      return;
    }

    if (!synthesis) return;

    try {
      view.clearTimeout(speakTimer);
      synthesis.cancel();
      // A short delay after cancel() keeps Chrome from dropping the new phrase.
      speakTimer = view.setTimeout(() => {
        try {
          const utterance = new view.SpeechSynthesisUtterance(text);
          utterance.lang = 'en-US';
          utterance.rate = 1.1;
          utterance.pitch = 1;
          utterance.volume = 1;
          synthesis.speak(utterance);
        } catch {
          /* speech is unavailable */
        }
      }, delay);
    } catch {
      /* speech is unavailable */
    }
  }

  doc.addEventListener('calculator:speak', (event) => {
    const detail = event.detail || {};
    if (typeof detail.text !== 'string' || !detail.text.trim()) return;
    const delay = Number.isFinite(detail.delay) ? detail.delay : 30;
    speak(detail.text, delay);
  });

  doc.addEventListener('calculator:success-prime', () => {
    primeSuccessAudio();
  });

  doc.addEventListener('calculator:success', () => {
    playSuccess();
  });

  /* --- success fanfare (Web Audio, no sound files) --- */

  function ensureAudio() {
    if (!voiceOn) return null;

    const AudioCtor = view.AudioContext || view.webkitAudioContext;
    if (!AudioCtor) return null;

    try {
      if (!audioCtx) {
        audioCtx = new AudioCtor();
        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 18;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        audioOut = audioCtx.createGain();
        audioOut.gain.value = 0.26;
        audioOut.connect(compressor);
        compressor.connect(audioCtx.destination);
      }

      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    } catch {
      return null;
    }
  }

  function primeSuccessAudio() {
    ensureAudio();
  }

  function playSuccess() {
    const ctx = ensureAudio();
    if (!ctx) return;

    try {
      scheduleFanfare(ctx);
    } catch {
      /* audio is unavailable */
    }
  }

  function scheduleFanfare(ctx) {
    const out = audioOut || ctx.destination;
    const t0 = ctx.currentTime + 0.03;

    const note = (freq, start, duration, peak, type = 'triangle') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    };

    // "ta-da": pickup step, then a ringing A-major chord.
    note(587.33, t0, 0.11, 0.5); // D5
    note(880.0, t0 + 0.1, 0.13, 0.5); // A5
    note(880.0, t0 + 0.21, 0.62, 0.42); // A5
    note(1108.73, t0 + 0.21, 0.62, 0.34); // C#6
    note(1318.51, t0 + 0.21, 0.62, 0.26); // E6
    note(440.0, t0 + 0.21, 0.56, 0.16, 'sine'); // A4 body
  }

  function applyVoiceState() {
    el.voice.classList.toggle('is-muted', !voiceOn);
    el.voice.setAttribute('aria-pressed', String(voiceOn));
    el.voice.setAttribute('aria-label', voiceOn ? 'Mute sound' : 'Enable sound');
    el.voice.title = voiceOn ? 'Sound on' : 'Sound off';

    if (!voiceOn) {
      try {
        view.speechSynthesis.cancel();
      } catch {
        /* speech is unavailable */
      }

      const nativeSpeech = getNativeSpeech();
      if (nativeSpeech) {
        try {
          const result = nativeSpeech.stop();
          if (result && typeof result.catch === 'function') {
            result.catch(() => {});
          }
        } catch {
          /* speech is unavailable */
        }
      }
    }
  }

  /* --- unit converter --- */

  let mode = 'calc';
  let pageBeforeHistory = 'calc';
  let openPicker = null;
  let category = UNIT_CATEGORIES[0];
  const unitMemory = {};

  function buildCategories() {
    el.categories.textContent = '';
    UNIT_CATEGORIES.forEach((item) => {
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.category = item.id;
      chip.textContent = item.label;
      chip.addEventListener('click', () => selectCategory(item.id));
      el.categories.append(chip);
    });
  }

  function renderCategories() {
    Array.from(el.categories.children).forEach((chip) => {
      const active = chip.dataset.category === category.id;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  }

  function fillUnits(select, selectedId) {
    select.textContent = '';
    category.units.forEach((unit) => {
      const option = doc.createElement('option');
      option.value = unit.id;
      option.textContent = unit.label + ' (' + unit.symbol + ')';
      select.append(option);
    });
    select.value = selectedId;
  }

  function updateConversion() {
    const fromId = el.convFrom.value;
    const toId = el.convTo.value;
    const fromUnit = findUnit(category, fromId);
    const toUnit = findUnit(category, toId);
    const value = parseAmount(el.convInput.value);

    if (value === null) {
      el.convResult.textContent = '\u2014';
    } else {
      const converted = convertAmount(category, value, fromId, toId);
      el.convResult.textContent = converted === null || !Number.isFinite(converted)
        ? '\u2014'
        : format(converted);
    }

    const one = convertAmount(category, 1, fromId, toId);
    el.convRate.textContent = one === null || !Number.isFinite(one)
      ? ''
      : '1 ' + fromUnit.symbol + ' = ' + format(one) + ' ' + toUnit.symbol;

    unitMemory[category.id] = { from: fromId, to: toId };
    syncUnitLabels();
  }

  function syncUnitLabels() {
    [
      [el.convFrom, el.convFromLabel],
      [el.convTo, el.convToLabel],
    ].forEach(([select, label]) => {
      const option = select.options[select.selectedIndex];
      label.textContent = option ? option.textContent : '';
    });
  }

  function selectCategory(id) {
    const next = UNIT_CATEGORIES.find((item) => item.id === id);
    if (!next) return;

    category = next;
    const remembered = unitMemory[next.id] || { from: next.defaults[0], to: next.defaults[1] };
    fillUnits(el.convFrom, remembered.from);
    fillUnits(el.convTo, remembered.to);
    renderCategories();
    updateConversion();
  }

  /* --- unit dropdown (custom, so the list is always visible) --- */

  function createUnitPicker(select, trigger, label) {
    const picker = {
      select,
      trigger,
      label,
      id: select.id + '-list',
      menu: null,
      items: null,
      options: null,
      active: -1,
    };

    trigger.setAttribute('aria-controls', picker.id);

    trigger.addEventListener('click', () => {
      trigger.focus();
      if (openPicker === picker) closeUnitPicker(true);
      else openUnitPicker(picker);
    });

    trigger.addEventListener('keydown', (event) => {
      const isOpen = openPicker === picker;
      const key = event.key;

      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        if (!isOpen) {
          openUnitPicker(picker);
        } else {
          setUnitActive(picker, picker.active + (key === 'ArrowDown' ? 1 : -1));
        }
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (isOpen) chooseUnitOption(picker, picker.active);
        else openUnitPicker(picker);
      } else if (key === 'Home' || key === 'End') {
        if (!isOpen) return;
        event.preventDefault();
        setUnitActive(picker, key === 'Home' ? 0 : picker.items.length - 1);
      } else if (key === 'Tab' && isOpen) {
        closeUnitPicker(false);
      }
    });

    return picker;
  }

  function openUnitPicker(picker) {
    if (openPicker === picker) return;
    if (openPicker) closeUnitPicker(false);

    const { select, trigger } = picker;
    const options = Array.from(select.options);
    if (!options.length) return;

    const menu = doc.createElement('div');
    menu.className = 'unit-menu';
    menu.id = picker.id;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Unit');

    picker.options = options;
    picker.items = options.map((option, index) => {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'unit-menu__item';
      item.id = picker.id + '-option-' + index;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === select.selectedIndex));
      item.tabIndex = -1;

      const text = doc.createElement('span');
      text.className = 'unit-menu__text';
      text.textContent = option.textContent;
      item.append(text);

      item.addEventListener('pointerdown', (event) => event.preventDefault());
      item.addEventListener('click', () => chooseUnitOption(picker, index));
      item.addEventListener('mousemove', () => {
        if (picker.active !== index) setUnitActive(picker, index, false);
      });

      menu.append(item);
      return item;
    });

    picker.menu = menu;
    picker.active = -1;
    openPicker = picker;
    trigger.setAttribute('aria-expanded', 'true');

    doc.body.append(menu);
    setUnitActive(picker, Math.max(0, select.selectedIndex), false);
    positionUnitMenu(picker);
    setUnitActive(picker, picker.active, true);
    menu.style.visibility = 'visible';
  }

  function positionUnitMenu(picker) {
    const menu = picker.menu;
    const rect = picker.trigger.getBoundingClientRect();
    const vw = view.innerWidth;
    const vh = view.innerHeight;

    const width = Math.min(Math.max(rect.width, 200), vw - 16);
    menu.style.width = width + 'px';
    menu.style.maxHeight = '280px';

    const natural = menu.offsetHeight;
    const below = vh - rect.bottom - 10;
    const above = rect.top - 10;
    const openUp = below < 160 && above > below;
    const space = Math.max(80, Math.min(280, (openUp ? above : below) - 4));
    menu.style.maxHeight = Math.min(natural, space) + 'px';

    const height = menu.offsetHeight;
    const top = openUp
      ? Math.max(8, rect.top - height - 6)
      : Math.min(vh - height - 8, rect.bottom + 6);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function setUnitActive(picker, index, scroll = true) {
    if (!picker.items || !picker.items.length) return;

    const count = picker.items.length;
    picker.active = ((index % count) + count) % count;
    picker.items.forEach((item, i) => item.classList.toggle('is-active', i === picker.active));

    const active = picker.items[picker.active];
    picker.trigger.setAttribute('aria-activedescendant', active.id);

    if (scroll && picker.menu) {
      const top = active.offsetTop;
      const bottom = top + active.offsetHeight;
      if (top < picker.menu.scrollTop) picker.menu.scrollTop = top - 6;
      else if (bottom > picker.menu.scrollTop + picker.menu.clientHeight) {
        picker.menu.scrollTop = bottom - picker.menu.clientHeight + 6;
      }
    }
  }

  function chooseUnitOption(picker, index) {
    const option = picker.options && picker.options[index];
    if (!option) {
      closeUnitPicker(true);
      return;
    }

    if (picker.select.value !== option.value) {
      picker.select.value = option.value;
      picker.select.dispatchEvent(new view.Event('change', { bubbles: true }));
    }

    syncUnitLabels();
    closeUnitPicker(true);
  }

  function closeUnitPicker(focusTrigger = false) {
    if (!openPicker) return;

    const picker = openPicker;
    openPicker = null;

    if (picker.menu) picker.menu.remove();
    picker.menu = null;
    picker.items = null;
    picker.options = null;
    picker.active = -1;

    picker.trigger.setAttribute('aria-expanded', 'false');
    picker.trigger.removeAttribute('aria-activedescendant');
    if (focusTrigger) picker.trigger.focus();
  }

  function clearHistory() {
    if (state.history.length === 0) return;

    state.history = [];
    renderHistory();
    if (mode === 'history') el.historyToggle.focus();
  }

  function setMode(next, focusInput = false) {
    if (openPicker) closeUnitPicker(false);
    if (next === 'history' && mode !== 'history') pageBeforeHistory = mode;

    const wasAi = mode === 'ai';
    mode = next === 'convert' || next === 'history' || next === 'ai' ? next : 'calc';
    const isCalc = mode === 'calc';
    const isConvert = mode === 'convert';
    const isHistory = mode === 'history';
    const isAi = mode === 'ai';

    el.panelCalc.hidden = !isCalc;
    el.panelConvert.hidden = !isConvert;
    el.panelAi.hidden = !isAi;
    el.panelHistory.hidden = !isHistory;

    el.historyToggle.setAttribute('aria-pressed', String(isHistory));
    el.historyToggle.setAttribute('aria-label', isHistory ? 'Hide history' : 'Show history');
    el.historyToggle.title = isHistory ? 'Hide history' : 'History';

    const modeTabs = { calc: el.tabCalc, convert: el.tabConvert, ai: el.tabAi };
    const activeTab = modeTabs[mode] || null;
    const reachableTab = isHistory ? modeTabs[pageBeforeHistory] || el.tabCalc : activeTab;

    [el.tabCalc, el.tabConvert, el.tabAi].forEach((tab) => {
      const active = tab === activeTab;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = tab === reachableTab ? 0 : -1;
    });

    if (isConvert) {
      updateConversion();
      if (focusInput) el.convInput.focus();
      el.panelConvert.scrollTop = 0;
    } else if (isHistory) {
      el.historyList.scrollTop = 0;
    }

    if (isAi) {
      el.panelAi.dispatchEvent(
        new view.CustomEvent('calculator:ai-show', {
          detail: { focus: Boolean(focusInput) },
        })
      );
    } else if (wasAi) {
      el.panelAi.dispatchEvent(new view.CustomEvent('calculator:ai-hide'));
    }
  }

  function announceConversion(explicit = true) {
    if (!voiceOn) return;

    const value = parseAmount(el.convInput.value);
    if (value === null) {
      if (explicit) speak('error');
      return;
    }

    const converted = convertAmount(category, value, el.convFrom.value, el.convTo.value);
    if (converted === null || !Number.isFinite(converted)) {
      if (explicit) speak('error');
      return;
    }

    const resultText = format(converted);
    const toUnit = findUnit(category, el.convTo.value);

    playSuccess();
    speak(spokenAmount(resultText) + ' ' + spokenUnitName(category, toUnit), 420);
  }

  /* --- input primitives --- */

  function lastNumber() {
    const match = state.expr.match(/(\d*\.?\d*)$/);
    return match ? match[1] : '';
  }

  function beginEdit() {
    state.error = false;
    if (state.evaluated) {
      state.expr = '';
      state.evaluated = false;
    }
  }

  function inputDigit(digit) {
    beginEdit();
    const segment = lastNumber();
    if (segment === '0') {
      state.expr = state.expr.slice(0, -1) + digit;
      return;
    }
    if (segment.replace('.', '').length >= MAX_INPUT_DIGITS) return;
    state.expr += digit;
  }

  function inputDot() {
    beginEdit();
    const segment = lastNumber();
    if (segment.includes('.')) return;
    state.expr += segment === '' ? '0.' : '.';
  }

  function inputOperator(op) {
    state.error = false;

    if (state.evaluated) {
      state.expr = toPlainString(Number(state.expr));
      state.evaluated = false;
    }

    if (state.expr === '') {
      if (op === '\u2212') state.expr = op; // start a negative number
      return;
    }

    const last = state.expr.slice(-1);
    if (last === '.') state.expr = state.expr.slice(0, -1);

    if (isOperator(last)) {
      state.expr = state.expr.slice(0, -1) + op;
      return;
    }

    state.expr += op;
  }

  function backspace() {
    if (state.evaluated) {
      clearAll();
      return;
    }
    state.error = false;
    state.expr = state.expr.slice(0, -1);
  }

  function clearAll() {
    state.expr = '';
    state.evaluated = false;
    state.error = false;
    render();
  }

  function toggleSign() {
    if (state.expr === '') return;
    state.error = false;

    if (state.evaluated) {
      state.expr = toPlainString(Number(state.expr));
      state.evaluated = false;
    }

    const match = state.expr.match(/(\d*\.?\d+)$/);
    if (!match) return;

    const before = state.expr.slice(0, match.index);
    const number = match[1];
    const last = before.slice(-1);
    const beforeLast = before.slice(-2, -1);
    const lastIsUnary = last === '\u2212' && (before.length === 1 || isOperator(beforeLast));

    if (lastIsUnary) {
      state.expr = before.slice(0, -1) + number;
    } else if (last === '\u2212') {
      state.expr = before.slice(0, -1) + '+' + number;
    } else if (last === '+') {
      state.expr = before.slice(0, -1) + '\u2212' + number;
    } else if (last === '') {
      state.expr = '\u2212' + number;
    } else {
      state.expr = before + '\u2212' + number; // after × or ÷
    }
  }

  function percent() {
    state.error = false;

    if (state.expr === '') return;

    if (state.evaluated) {
      state.expr = format(Number(state.expr) / 100);
      state.evaluated = false;
      return;
    }

    const match = state.expr.match(/(\d*\.?\d+)$/);
    if (!match) return;

    const before = state.expr.slice(0, match.index);
    const number = Number(match[1]);
    const last = before.slice(-1);

    // "200 + 10%" means 10% of 200, while "200 x 10%" is just 0.1.
    if (last === '+' || last === '\u2212') {
      const left = evaluate(before.slice(0, -1));
      if (left === null) return;
      state.expr = before + format((left * number) / 100);
    } else {
      state.expr = before + format(number / 100);
    }
  }

  function equals() {
    if (state.expr === '') return null;

    const result = evaluate(state.expr);
    if (result === null) {
      state.error = true;
      render();
      return null;
    }

    const resultText = format(result);
    state.history.unshift({ expr: state.expr, result: resultText });
    state.history = state.history.slice(0, HISTORY_LIMIT);
    renderHistory();

    state.expr = resultText;
    state.evaluated = true;
    state.error = false;
    return resultText;
  }

  /* --- rendering --- */

  function render() {
    const text = state.expr || '0';
    el.expr.textContent = text;

    el.expr.style.fontSize = '';
    if (text.length > 18) el.expr.style.fontSize = '1.35rem';
    else if (text.length > 13) el.expr.style.fontSize = '1.8rem';
    else if (text.length > 9) el.expr.style.fontSize = '2.2rem';

    el.display.classList.toggle('display--error', state.error);

    let preview = '';
    if (state.error) {
      preview = 'Error';
    } else if (!state.evaluated && OP_TEST.test(state.expr)) {
      const result = evaluate(state.expr);
      if (result !== null) {
        const resultText = format(result);
        if (normalize(state.expr) !== resultText) preview = '= ' + resultText;
      }
    }
    el.preview.textContent = preview;
  }

  function renderHistory() {
    const count = state.history.length;

    el.historyList.textContent = '';
    el.historyList.hidden = count === 0;
    el.historyEmpty.hidden = count > 0;
    el.historyClear.hidden = count === 0;
    el.historyCount.textContent =
      count === 0 ? 'No calculations' : count + (count === 1 ? ' calculation' : ' calculations');

    state.history.forEach((entry) => {
      const item = doc.createElement('li');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'history__item';
      button.title = 'Load this result';
      button.setAttribute('aria-label', 'Load ' + entry.expr + ' = ' + entry.result);

      const expression = doc.createElement('span');
      expression.className = 'history__expr';
      expression.textContent = entry.expr + ' =';

      const result = doc.createElement('span');
      result.className = 'history__result';
      result.textContent = entry.result;

      button.append(expression, result);
      button.addEventListener('click', () => {
        state.expr = entry.result;
        state.evaluated = true;
        state.error = false;
        speak(spokenNumber(entry.result));
        render();
        setMode('calc', false);
        el.tabCalc.focus();
      });

      item.append(button);
      el.historyList.append(item);
    });
  }

  /* --- events --- */

  function pressKey(value) {
    if (/^[0-9]$/.test(value)) {
      inputDigit(value);
      speak(SPOKEN[value]);
    } else if (value === '.') {
      inputDot();
      speak(SPOKEN['.']);
    } else if (isOperator(value)) {
      inputOperator(value);
      speak(SPOKEN[value]);
    }
    render();
  }

  function runAction(name) {
    switch (name) {
      case 'clear':
        clearAll();
        speak('clear');
        break;
      case 'backspace':
        backspace();
        speak('delete');
        render();
        break;
      case 'sign':
        toggleSign();
        speak('negative');
        render();
        break;
      case 'percent':
        percent();
        speak('percent');
        render();
        break;
      case 'equals': {
        const result = equals();
        if (result !== null) {
          playSuccess();
          // Let the fanfare land before announcing the answer.
          speak(spokenNumber(result), 420);
        } else if (state.error) {
          speak('error');
        }
        render();
        break;
      }
      default:
        break;
    }
  }

  function flashKey(selector) {
    const button = el.keys.querySelector(selector);
    if (!button) return;
    button.classList.add('is-active');
    setTimeout(() => button.classList.remove('is-active'), 130);
  }

  el.keys.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    // A real pointer click leaves focus on the key, which would make the next
    // Enter press re-trigger it instead of evaluating. Drop focus for pointers;
    // keyboard navigation keeps its focus ring and native activation.
    if (event.detail > 0) button.blur();

    if (button.dataset.action) {
      runAction(button.dataset.action);
    } else if (button.dataset.value !== undefined) {
      pressKey(button.dataset.value);
    }
  });

  doc.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // The AI panel has its own text fields and keyboard handling.
    if (event.target && event.target.closest && event.target.closest('.ai-panel')) return;

    if (event.key === 'Escape' && openPicker) {
      event.preventDefault();
      closeUnitPicker(true);
      return;
    }

    if (event.key === 'Escape' && mode === 'history') {
      event.preventDefault();
      setMode(pageBeforeHistory, false);
      el.historyToggle.focus();
      return;
    }

    if (mode !== 'calc') return;

    // Let a focused button activate natively on Enter/Space.
    const active = doc.activeElement;
    if ((event.key === 'Enter' || event.key === ' ') && active && active.tagName === 'BUTTON') return;

    silent = event.repeat;

    const key = event.key;
    let handled = true;

    if (/^[0-9]$/.test(key)) {
      pressKey(key);
      flashKey(`[data-value="${key}"]`);
    } else if (key === '.' || key === ',') {
      pressKey('.');
      flashKey('[data-value="."]');
    } else if (key === '+') {
      pressKey('+');
      flashKey('[data-value="+"]');
    } else if (key === '-') {
      pressKey('\u2212');
      flashKey('[data-value="\u2212"]');
    } else if (key === '*' || key === 'x' || key === 'X') {
      pressKey('\u00d7');
      flashKey('[data-value="\u00d7"]');
    } else if (key === '/') {
      pressKey('\u00f7');
      flashKey('[data-value="\u00f7"]');
    } else if (key === '%') {
      runAction('percent');
      flashKey('[data-action="percent"]');
    } else if (key === 'Enter' || key === '=') {
      runAction('equals');
      flashKey('[data-action="equals"]');
    } else if (key === 'Backspace') {
      runAction('backspace');
      flashKey('[data-action="backspace"]');
    } else if (key === 'Escape' || key === 'Delete' || key === 'c' || key === 'C') {
      runAction('clear');
      flashKey('[data-action="clear"]');
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
      render();
    }

    silent = false;
  });

  el.voice.addEventListener('click', () => {
    voiceOn = !voiceOn;
    try {
      view.localStorage.setItem(VOICE_KEY, voiceOn ? 'on' : 'off');
    } catch {
      /* storage blocked: the setting just won't persist */
    }
    applyVoiceState();
    if (voiceOn) {
      primeSuccessAudio();
      speak('sound on');
    }
  });

  el.tabCalc.addEventListener('click', () => setMode('calc', false));
  el.tabConvert.addEventListener('click', () => setMode('convert', false));
  el.tabAi.addEventListener('click', () => setMode('ai', false));
  el.historyToggle.addEventListener('click', () => {
    setMode(mode === 'history' ? pageBeforeHistory : 'history', false);
  });
  el.historyClear.addEventListener('click', clearHistory);

  el.modes.addEventListener('keydown', (event) => {
    const modes = ['calc', 'convert', 'ai'];
    const tabs = [el.tabCalc, el.tabConvert, el.tabAi];
    const current = modes.indexOf(mode === 'history' ? pageBeforeHistory : mode);
    let next = null;

    if (event.key === 'ArrowRight') next = (current + 1) % modes.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + modes.length) % modes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = modes.length - 1;
    else return;

    event.preventDefault();
    const target = modes[next];
    setMode(target, false);
    tabs[next].focus();
  });

  el.convInput.addEventListener('input', updateConversion);
  el.convFrom.addEventListener('change', updateConversion);
  el.convTo.addEventListener('change', updateConversion);
  el.convSwap.addEventListener('click', () => {
    const from = el.convFrom.value;
    el.convFrom.value = el.convTo.value;
    el.convTo.value = from;
    updateConversion();
  });

  el.convAnnounce.addEventListener('click', () => announceConversion(true));

  el.convInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    announceConversion(true);
  });

  doc.addEventListener('pointerdown', (event) => {
    if (!openPicker) return;
    if (openPicker.menu && openPicker.menu.contains(event.target)) return;
    if (openPicker.trigger.contains(event.target)) return;
    closeUnitPicker(false);
  }, true);

  doc.addEventListener('scroll', (event) => {
    if (!openPicker) return;
    if (openPicker.menu && openPicker.menu.contains(event.target)) return;
    closeUnitPicker(false);
  }, true);

  view.addEventListener('resize', () => {
    if (openPicker) closeUnitPicker(false);
  });

  createUnitPicker(el.convFrom, el.convFromButton, el.convFromLabel);
  createUnitPicker(el.convTo, el.convToButton, el.convToLabel);

  buildCategories();
  selectCategory(category.id);
  setMode('calc', false);
  applyVoiceState();
  render();
  renderHistory();
}

/* ------------------------------------------------------------------
   AI assistant
   A bring-your-own-key client for OpenAI-compatible chat endpoints.
   The key lives only in this browser and is sent directly to the
   endpoint selected in Settings.
   ------------------------------------------------------------------ */

function initAi(doc) {
  const view = doc.defaultView;
  const STORE_KEY = 'calculator.ai.v1';
  const API_BASE = String(view.CALC_API_BASE || '').trim().replace(/\/+$/, '');
  const PROXY_URL = (API_BASE || '') + '/api/chat';
  const AI_SUBTITLE = 'Your AI Mathematician';
  const MAX_IMAGES = 3;
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const DEFAULTS = {
    apiKey: '',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    remember: false,
  };

  const SYSTEM_PROMPT = [
    'You are MathsAI, the assistant built into a calculator app.',
    'Solve math, science, and quantitative problems accurately and clearly.',
    'For arithmetic and algebra, show concise steps, not just the answer.',
    'Give the final answer clearly and include units where relevant.',
    'If an image is attached, read the problem from the image, briefly restate it, and solve it.',
    'Use plain text and simple Unicode math (×, ÷, √, π, ², ³). Avoid LaTeX, HTML, and Markdown tables.',
    'Short bullet lists and bold labels are fine.',
    'If information is missing or ambiguous, state the assumption you are making.',
    'Verify the final result and flag meaningful uncertainty.',
    'Do not claim to have seen an image unless one is attached.',
  ].join(' ');

  const el = {
    panel: doc.getElementById('panel-ai'),
    newChat: doc.getElementById('ai-new'),
    settingsToggle: doc.getElementById('ai-settings-toggle'),
    modelLabel: doc.getElementById('ai-model'),
    chatView: doc.getElementById('ai-chat-view'),
    chat: doc.getElementById('ai-chat'),
    empty: doc.getElementById('ai-empty'),
    messages: doc.getElementById('ai-messages'),
    composer: doc.getElementById('ai-composer'),
    input: doc.getElementById('ai-input'),
    attach: doc.getElementById('ai-attach'),
    send: doc.getElementById('ai-send'),
    file: doc.getElementById('ai-file'),
    previews: doc.getElementById('ai-previews'),
    notice: doc.getElementById('ai-notice'),
    noticeMeta: doc.querySelector('.ai-composer__meta'),
    settingsView: doc.getElementById('ai-settings-view'),
    form: doc.getElementById('ai-form'),
    key: doc.getElementById('ai-key'),
    keyToggle: doc.getElementById('ai-key-toggle'),
    modelInput: doc.getElementById('ai-model-input'),
    base: doc.getElementById('ai-base'),
    remember: doc.getElementById('ai-remember'),
    settingsError: doc.getElementById('ai-settings-error'),
    save: doc.getElementById('ai-save'),
    back: doc.getElementById('ai-back'),
    forget: doc.getElementById('ai-forget'),
  };

  if (!el.panel) return;

  const state = {
    open: false,
    view: 'chat',
    messages: [],
    attachments: [],
    pending: false,
    processing: false,
    fileSeq: 0,
    controller: null,
    requestSeq: 0,
    error: '',
    notice: '',
    settings: readSettings(),
  };

  function safeStorage(name) {
    try {
      return view[name];
    } catch {
      return null;
    }
  }

  function normalizeBase(value) {
    let base = String(value || '').trim();
    base = base.replace(/\/+$/, '');
    base = base.replace(/\/chat\/completions$/i, '');
    base = base.replace(/\/+$/, '');
    return base || DEFAULTS.baseUrl;
  }

  function readSettings() {
    const sources = [
      { storage: safeStorage('localStorage'), remember: true },
      { storage: safeStorage('sessionStorage'), remember: false },
    ];

    for (const source of sources) {
      if (!source.storage) continue;
      let raw = null;
      try {
        raw = source.storage.getItem(STORE_KEY);
      } catch {
        raw = null;
      }
      if (!raw) continue;

      try {
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') continue;
        return {
          apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
          model:
            typeof data.model === 'string' && data.model.trim()
              ? data.model.trim()
              : DEFAULTS.model,
          baseUrl: normalizeBase(data.baseUrl),
          remember: source.remember,
        };
      } catch {
        /* Ignore corrupt settings and fall through to the next store. */
      }
    }

    return { ...DEFAULTS };
  }

  function clearStoredSettings() {
    for (const name of ['localStorage', 'sessionStorage']) {
      const storage = safeStorage(name);
      if (!storage) continue;
      try {
        storage.removeItem(STORE_KEY);
      } catch {
        /* Storage can be blocked; in-memory settings still work. */
      }
    }
  }

  function persistSettings(settings) {
    clearStoredSettings();
    const target = safeStorage(settings.remember ? 'localStorage' : 'sessionStorage');
    if (!target) return;

    try {
      target.setItem(
        STORE_KEY,
        JSON.stringify({
          apiKey: settings.apiKey,
          model: settings.model,
          baseUrl: settings.baseUrl,
          remember: settings.remember,
        })
      );
    } catch {
      /* Storage can be blocked; keep the settings for this page session only. */
    }
  }

  function setSettingsError(message) {
    el.settingsError.textContent = message || '';
    el.settingsError.classList.toggle('is-visible', Boolean(message));
  }

  function setNotice(message) {
    state.notice = message || '';
    el.notice.textContent = state.notice;
    el.noticeMeta.hidden = !state.notice;
  }

  function updateHeader() {
    el.modelLabel.textContent = AI_SUBTITLE;
    el.settingsToggle.hidden = true;
    el.newChat.hidden = state.view !== 'chat';
  }

  function showChatView(focusInput = false) {
    state.view = 'chat';
    el.chatView.hidden = false;
    el.settingsView.hidden = true;
    updateHeader();
    if (focusInput) {
      view.setTimeout(() => {
        if (state.open) el.input.focus();
      }, 0);
    }
  }

  function showSettingsView(focusKey = false) {
    state.view = 'settings';
    el.chatView.hidden = true;
    el.settingsView.hidden = false;
    el.key.value = state.settings.apiKey;
    el.modelInput.value = state.settings.model;
    el.base.value = state.settings.baseUrl;
    el.remember.checked = Boolean(state.settings.remember);
    el.key.type = 'password';
    el.keyToggle.setAttribute('aria-label', 'Show API key');
    el.keyToggle.title = 'Show API key';
    el.save.textContent = state.settings.apiKey ? 'Save changes' : 'Save & start';
    el.forget.hidden = !state.settings.apiKey;
    el.back.hidden = !state.settings.apiKey;
    setSettingsError('');
    updateHeader();
    el.settingsView.querySelector('.ai-settings__scroll').scrollTop = 0;
    if (focusKey) {
      view.setTimeout(() => {
        if (state.open) el.key.focus();
      }, 0);
    }
  }

  function showPanel(detail) {
    const shouldFocus = Boolean(detail && detail.focus);
    const wasOpen = state.open;
    state.open = true;

    if (!wasOpen) {
      setNotice('');
      showChatView();
      renderMessages();
      updateSendButton();
    }

    if (shouldFocus) {
      view.setTimeout(() => {
        if (state.open) el.input.focus();
      }, 30);
    }
  }

  function hidePanel() {
    state.open = false;
  }

  function updateSendButton() {
    const hasContent = Boolean(el.input.value.trim() || state.attachments.length);
    el.send.disabled = !state.pending && (!hasContent || state.processing);
    el.send.classList.toggle('is-stop', state.pending);
    const label = state.pending ? 'Stop response' : 'Send message';
    el.send.setAttribute('aria-label', label);
    el.send.title = state.pending ? 'Stop response' : 'Send';
  }

  function resizeInput() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
  }

  function resetInputHeight() {
    el.input.style.height = '';
  }

  function renderAttachments() {
    el.previews.textContent = '';
    el.previews.hidden = state.attachments.length === 0;

    state.attachments.forEach((attachment) => {
      const item = doc.createElement('div');
      item.className = 'ai-attachment';

      const image = doc.createElement('img');
      image.src = attachment.dataUrl;
      image.alt = attachment.name;
      image.loading = 'lazy';

      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'ai-attachment__remove';
      remove.setAttribute('aria-label', 'Remove ' + attachment.name);
      remove.title = 'Remove image';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        state.attachments = state.attachments.filter((item) => item !== attachment);
        setNotice('');
        renderAttachments();
      });

      item.append(image, remove);
      el.previews.append(item);
    });

    updateSendButton();
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = view.URL.createObjectURL(file);
      const image = new view.Image();

      image.onload = () => {
        try {
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          if (!width || !height) {
            throw new Error('empty image');
          }

          const scale = Math.min(1, 1400 / Math.max(width, height));
          const canvas = doc.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));

          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('canvas unavailable');
          }

          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        } catch (error) {
          reject(error);
        } finally {
          view.URL.revokeObjectURL(objectUrl);
        }
      };

      image.onerror = () => {
        view.URL.revokeObjectURL(objectUrl);
        reject(new Error('image decode failed'));
      };

      image.src = objectUrl;
    });
  }

  async function addFiles(files) {
    const all = Array.from(files || []);
    const images = all.filter(
      (file) => file && typeof file.type === 'string' && file.type.startsWith('image/')
    );

    if (images.length === 0) {
      setNotice('Choose an image file (PNG, JPEG, or WebP).');
      el.file.value = '';
      return;
    }

    if (state.processing) {
      setNotice('Wait for the current image to finish.');
      el.file.value = '';
      return;
    }

    const room = MAX_IMAGES - state.attachments.length;
    if (room <= 0) {
      setNotice('You can attach up to ' + MAX_IMAGES + ' images.');
      el.file.value = '';
      return;
    }

    const selected = images.slice(0, room);
    if (images.length > room) {
      setNotice('Only the first ' + MAX_IMAGES + ' images were added.');
    } else {
      setNotice('');
    }

    state.processing = true;
    const fileSeq = ++state.fileSeq;
    updateSendButton();

    for (const file of selected) {
      if (file.size > MAX_IMAGE_BYTES) {
        setNotice('Each image must be under 15 MB.');
        continue;
      }

      try {
        const dataUrl = await compressImage(file);
        if (fileSeq !== state.fileSeq) {
          el.file.value = '';
          return;
        }
        state.attachments.push({
          name: file.name || 'image',
          dataUrl,
        });
      } catch {
        if (fileSeq !== state.fileSeq) return;
        setNotice('That image could not be read. Try a PNG or JPEG.');
      }
    }

    if (fileSeq !== state.fileSeq) {
      el.file.value = '';
      return;
    }
    state.processing = false;
    el.file.value = '';
    renderAttachments();
  }

  function appendInline(parent, text) {
    const pattern = /(`[^`\n]+`|\*\*(?!\s)[^*\n]*[^\s*]\*\*)/g;
    let last = 0;
    let match = pattern.exec(text);

    while (match) {
      if (match.index > last) {
        parent.append(doc.createTextNode(text.slice(last, match.index)));
      }

      const token = match[0];
      if (token.startsWith('`')) {
        const code = doc.createElement('code');
        code.textContent = token.slice(1, -1);
        parent.append(code);
      } else if (token.startsWith('**')) {
        const strong = doc.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parent.append(strong);
      } else {
        const emphasis = doc.createElement('em');
        emphasis.textContent = token.slice(1, -1);
        parent.append(emphasis);
      }

      last = match.index + token.length;
      match = pattern.exec(text);
    }

    if (last < text.length) {
      parent.append(doc.createTextNode(text.slice(last)));
    }
  }

  function renderAiMarkdown(text) {
    const fragment = doc.createDocumentFragment();
    const chunks = String(text || '').split('```');

    chunks.forEach((chunk, index) => {
      if (index % 2 === 1) {
        const pre = doc.createElement('pre');
        const code = doc.createElement('code');
        let body = chunk.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
        const firstBreak = body.indexOf('\n');
        if (firstBreak > -1) {
          const firstLine = body.slice(0, firstBreak).trim();
          if (firstLine && /^[a-zA-Z0-9+#.-]+$/.test(firstLine)) {
            body = body.slice(firstBreak + 1);
          }
        }
        code.textContent = body;
        pre.append(code);
        fragment.append(pre);
        return;
      }

      const lines = chunk.split(/\r?\n/);
      let list = null;
      let listType = '';

      const closeList = () => {
        list = null;
        listType = '';
      };

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          closeList();
          continue;
        }

        const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
        if (heading) {
          closeList();
          const paragraph = doc.createElement('p');
          paragraph.className = 'ai-md__head';
          appendInline(paragraph, heading[1]);
          fragment.append(paragraph);
          continue;
        }

        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet) {
          if (!list || listType !== 'ul') {
            closeList();
            list = doc.createElement('ul');
            listType = 'ul';
            fragment.append(list);
          }
          const item = doc.createElement('li');
          appendInline(item, bullet[1]);
          list.append(item);
          continue;
        }

        const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
        if (numbered) {
          if (!list || listType !== 'ol') {
            closeList();
            list = doc.createElement('ol');
            listType = 'ol';
            fragment.append(list);
          }
          const item = doc.createElement('li');
          appendInline(item, numbered[1]);
          list.append(item);
          continue;
        }

        const quote = line.match(/^\s*>\s?(.*)$/);
        if (quote) {
          closeList();
          const blockquote = doc.createElement('blockquote');
          appendInline(blockquote, quote[1]);
          fragment.append(blockquote);
          continue;
        }

        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
          closeList();
          fragment.append(doc.createElement('hr'));
          continue;
        }

        closeList();
        const paragraph = doc.createElement('p');
        appendInline(paragraph, line);
        fragment.append(paragraph);
      }
    });

    return fragment;
  }

  function createUserMessage(message) {
    const row = doc.createElement('div');
    row.className = 'ai-msg ai-msg--user';

    if (message.images && message.images.length) {
      const images = doc.createElement('div');
      images.className = 'ai-msg__images';
      message.images.forEach((source) => {
        const image = doc.createElement('img');
        image.src = source;
        image.alt = 'Attached image';
        image.loading = 'lazy';
        images.append(image);
      });
      row.append(images);
    }

    if (message.text) {
      const bubble = doc.createElement('div');
      bubble.className = 'ai-bubble';
      bubble.textContent = message.text;
      row.append(bubble);
    }

    return row;
  }

  function speechFriendlyText(text) {
    let clean = String(text || '');
    clean = clean.replace(/```[\s\S]*?```/g, ' ');
    clean = clean.replace(/`([^`]+)`/g, '$1');
    clean = clean.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    clean = clean.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    clean = clean.replace(/^\s{0,3}(#{1,6}|>)\s*/gm, '');
    clean = clean.replace(/^\s*[-*+]\s+/gm, '');
    clean = clean.replace(/([0-9A-Za-z)])\s*\*\s*([0-9A-Za-z(])/g, '$1 times $2');
    clean = clean.replace(/[*_~]/g, '');
    clean = clean.replace(/[×✕]/g, ' times ');
    clean = clean.replace(/÷/g, ' divided by ');
    clean = clean.replace(/√/g, ' square root of ');
    clean = clean.replace(/π/g, ' pi ');
    clean = clean.replace(/²/g, ' squared ');
    clean = clean.replace(/³/g, ' cubed ');
    clean = clean.replace(/=/g, ' equals ');
    clean = clean.replace(/\^/g, ' to the power of ');
    clean = clean.replace(/%/g, ' percent ');
    clean = clean.replace(/\|/g, ', ');
    return clean.replace(/\s+/g, ' ').trim();
  }

  function readAloud(text, delay = 280) {
    const spoken = speechFriendlyText(text);
    if (!spoken) return;
    doc.dispatchEvent(
      new view.CustomEvent('calculator:speak', {
        detail: {
          text: spoken,
          delay,
        },
      })
    );
  }

  function createAssistantMessage(message) {
    const row = doc.createElement('div');
    row.className = 'ai-msg ai-msg--assistant';

    const label = doc.createElement('div');
    label.className = 'ai-msg__label';
    label.textContent = 'AI';

    const body = doc.createElement('div');
    body.className = 'ai-md';
    body.append(renderAiMarkdown(message.text));

    if (message.text) {
      const readButton = doc.createElement('button');
      readButton.type = 'button';
      readButton.className = 'ai-speak';
      readButton.setAttribute('aria-label', 'Read answer aloud');
      readButton.title = 'Read answer aloud';
      readButton.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />' +
        '<path d="M15.5 9a4.2 4.2 0 0 1 0 6" />' +
        '<path d="M18.2 6.4a8 8 0 0 1 0 11.2" />' +
        '</svg>';
      readButton.addEventListener('click', () => readAloud(message.text, 30));

      const actions = doc.createElement('div');
      actions.className = 'ai-md__actions';
      actions.append(readButton);
      body.append(actions);
    }

    row.append(label, body);
    return row;
  }

  function createThinking() {
    const row = doc.createElement('div');
    row.className = 'ai-msg ai-msg--assistant';

    const label = doc.createElement('div');
    label.className = 'ai-msg__label';
    label.textContent = 'AI';

    const thinking = doc.createElement('div');
    thinking.className = 'ai-thinking';
    const dots = doc.createElement('span');
    dots.className = 'ai-dots';
    for (let i = 0; i < 3; i += 1) {
      dots.append(doc.createElement('span'));
    }
    thinking.append(dots, doc.createTextNode('Working through it…'));

    row.append(label, thinking);
    return row;
  }

  function createError(message) {
    const box = doc.createElement('div');
    box.className = 'ai-error';
    box.setAttribute('role', 'alert');

    const text = doc.createElement('span');
    text.className = 'ai-error__text';
    text.textContent = message;

    box.append(text);
    return box;
  }

  function renderMessages() {
    el.messages.textContent = '';
    const hasMessages = state.messages.length > 0;
    const hasThread = hasMessages || state.pending || Boolean(state.error);

    el.empty.hidden = hasThread;
    el.messages.hidden = !hasThread;
    el.messages.setAttribute('aria-busy', state.pending ? 'true' : 'false');

    state.messages.forEach((message) => {
      el.messages.append(
        message.role === 'user'
          ? createUserMessage(message)
          : createAssistantMessage(message)
      );
    });

    if (state.pending) el.messages.append(createThinking());
    if (state.error) el.messages.append(createError(state.error));
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function buildApiMessages() {
    const recent = state.messages.slice(-12);
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recent.map((message) => {
        if (message.role === 'user') {
          if (message.images && message.images.length) {
            const content = [];
            if (message.text) {
              content.push({ type: 'text', text: message.text });
            }
            message.images.forEach((url) => {
              content.push({ type: 'image_url', image_url: { url } });
            });
            return { role: 'user', content };
          }
          return { role: 'user', content: message.text };
        }
        return { role: 'assistant', content: message.text };
      }),
    ];
  }

  function extractContent(data) {
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;

    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part.text === 'string') return part.text;
          return '';
        })
        .join('\n')
        .trim();
    }
    return '';
  }

  function extractApiError(data) {
    if (!data || typeof data !== 'object') return '';
    const error = data.error;
    if (error && typeof error === 'object' && typeof error.message === 'string') {
      return error.message.slice(0, 260);
    }
    if (typeof data.message === 'string') return data.message.slice(0, 260);
    return '';
  }

  function friendlyAiError(error) {
    const status = error && error.status;
    const message = error && error.message ? String(error.message) : '';

    if (status === 401 || status === 403) {
      return 'The AI connection was rejected. Check the server API key.';
    }
    if (status === 402) {
      return message || 'The AI service account has insufficient balance or credits.';
    }
    if (status === 404) {
      return "The AI service endpoint or model wasn't found. Check the server configuration.";
    }
    if (status === 413) {
      return 'That request is too large. Try a smaller image.';
    }
    if (status === 429) {
      return message || 'The AI service is busy or rate-limiting requests. Wait a moment and try again.';
    }
    if (status === 502 || status === 504) {
      return "Couldn't reach the AI provider. Try again shortly.";
    }
    if (status === 503) {
      return 'MathsAI is not configured on this server yet.';
    }
    if (status >= 500) {
      return 'The AI service had a server error. Try again shortly.';
    }
    if (status === 400) {
      return 'The AI request was rejected.' + (message ? ' ' + message : '');
    }
    if (status) {
      return 'The AI request failed (' + status + '). Try again shortly.';
    }
    if (
      (error && error.name === 'TypeError') ||
      /failed to fetch|networkerror|load failed|network request failed/i.test(message)
    ) {
      return "Couldn't reach the AI service. Make sure the server is running.";
    }
    return message || "Couldn't reach the AI service. Try again shortly.";
  }

  function stopRequest(showNotice) {
    if (!state.pending) return;
    state.requestSeq += 1;
    state.pending = false;

    if (state.controller) {
      try {
        state.controller.abort();
      } catch {
        /* The request may already be finished. */
      }
      state.controller = null;
    }

    setNotice(showNotice ? 'Stopped.' : '');
    renderMessages();
    updateSendButton();
  }

  async function sendMessage() {
    if (state.pending) {
      stopRequest(true);
      return;
    }

    if (state.processing) {
      setNotice('Wait for the image to finish.');
      return;
    }

    const text = el.input.value.trim();
    if (!text && state.attachments.length === 0) return;

    const images = state.attachments.map((attachment) => attachment.dataUrl);
    const userText = text || 'Solve the problem in this image.';

    doc.dispatchEvent(new view.CustomEvent('calculator:success-prime'));
    state.messages.push({ role: 'user', text: userText, images });
    state.attachments = [];
    el.input.value = '';
    resetInputHeight();
    state.error = '';
    setNotice('');
    renderAttachments();
    updateSendButton();

    state.pending = true;
    const requestSeq = ++state.requestSeq;
    state.controller = new view.AbortController();
    updateSendButton();
    renderMessages();

    let completedAnswer = '';

    try {
      const response = await view.fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: buildApiMessages(),
        }),
        signal: state.controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error(
          extractApiError(data) || 'The AI request failed (' + response.status + ').'
        );
        error.status = response.status;
        throw error;
      }

      const content = extractContent(data);
      if (!content) {
        throw new Error('The model returned an empty response. Try rephrasing your question.');
      }

      if (requestSeq !== state.requestSeq) return;
      state.messages.push({ role: 'assistant', text: content });
      completedAnswer = content;
    } catch (error) {
      if (requestSeq !== state.requestSeq) return;
      if (error && error.name === 'AbortError') {
        setNotice('Stopped.');
      } else {
        state.error = friendlyAiError(error);
        setNotice('');
      }
    } finally {
      if (requestSeq === state.requestSeq) {
        state.pending = false;
        state.controller = null;
        updateSendButton();
        renderMessages();
        if (completedAnswer && state.open) {
          doc.dispatchEvent(new view.CustomEvent('calculator:success'));
          readAloud(completedAnswer, 420);
        }
      }
    }
  }

  function newChat() {
    stopRequest(false);
    state.fileSeq += 1;
    state.processing = false;
    state.messages = [];
    state.attachments = [];
    state.error = '';
    setNotice('');
    el.input.value = '';
    resetInputHeight();
    renderAttachments();
    renderMessages();
    updateSendButton();
    el.input.focus();
  }

  function saveSettings(event) {
    event.preventDefault();

    const apiKey = el.key.value.trim();
    const model = el.modelInput.value.trim();
    const baseUrl = normalizeBase(el.base.value);

    if (!apiKey) {
      setSettingsError('Enter an API key to connect.');
      el.key.focus();
      return;
    }

    if (!model) {
      setSettingsError('Enter a model name.');
      el.modelInput.focus();
      return;
    }

    let parsed = null;
    try {
      parsed = new view.URL(baseUrl);
    } catch {
      parsed = null;
    }

    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      setSettingsError('Enter a valid http(s) base URL.');
      el.base.focus();
      return;
    }

    stopRequest(false);
    state.settings = {
      apiKey,
      model,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      remember: Boolean(el.remember.checked),
    };
    persistSettings(state.settings);
    state.error = '';
    setNotice('');
    setSettingsError('');
    el.key.type = 'password';
    el.keyToggle.setAttribute('aria-label', 'Show API key');
    el.keyToggle.title = 'Show API key';
    showChatView(true);
    renderMessages();
    updateSendButton();
  }

  function forgetKey() {
    stopRequest(false);
    state.fileSeq += 1;
    state.processing = false;
    clearStoredSettings();
    state.settings = {
      ...state.settings,
      apiKey: '',
      remember: false,
    };
    state.messages = [];
    state.attachments = [];
    state.error = '';
    setNotice('');
    el.input.value = '';
    resetInputHeight();
    renderAttachments();
    renderMessages();
    updateSendButton();
    showSettingsView(true);
    setSettingsError('');
  }

  /* --- events --- */

  el.panel.addEventListener('calculator:ai-show', (event) => showPanel(event.detail));
  el.panel.addEventListener('calculator:ai-hide', hidePanel);
  el.newChat.addEventListener('click', newChat);

  el.settingsToggle.addEventListener('click', () => {
    if (state.view === 'settings') {
      showChatView(true);
    } else {
      showSettingsView(true);
    }
  });

  el.back.addEventListener('click', () => showChatView(true));
  el.forget.addEventListener('click', forgetKey);
  el.form.addEventListener('submit', saveSettings);

  [el.key, el.modelInput, el.base].forEach((input) => {
    input.addEventListener('input', () => setSettingsError(''));
  });

  el.keyToggle.addEventListener('click', () => {
    const show = el.key.type === 'password';
    el.key.type = show ? 'text' : 'password';
    el.keyToggle.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
    el.keyToggle.title = show ? 'Hide API key' : 'Show API key';
    el.key.focus();
  });

  el.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.pending) {
      stopRequest(true);
    } else {
      sendMessage();
    }
  });

  el.input.addEventListener('input', () => {
    resizeInput();
    updateSendButton();
  });

  el.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (typeof el.composer.requestSubmit === 'function') {
      el.composer.requestSubmit();
    } else {
      sendMessage();
    }
  });

  el.input.addEventListener('paste', (event) => {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;

    const files = [];
    Array.from(items).forEach((item) => {
      if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    });

    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  });

  el.attach.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => addFiles(el.file.files));

  el.empty.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.dataset.attach === 'true') {
      el.file.click();
      return;
    }

    if (button.dataset.prompt) {
      el.input.value = button.dataset.prompt;
      resizeInput();
      updateSendButton();
      sendMessage();
    }
  });

  ['dragenter', 'dragover'].forEach((type) => {
    el.panel.addEventListener(type, (event) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      el.composer.classList.add('is-dragging');
    });
  });

  el.panel.addEventListener('dragleave', (event) => {
    if (!el.panel.contains(event.relatedTarget)) {
      el.composer.classList.remove('is-dragging');
    }
  });

  el.panel.addEventListener('drop', (event) => {
    event.preventDefault();
    el.composer.classList.remove('is-dragging');
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
      addFiles(event.dataTransfer.files);
    }
  });

  el.remember.addEventListener('change', () => setSettingsError(''));

  renderAttachments();
  renderMessages();
  updateHeader();
  updateSendButton();
}

if (typeof document !== 'undefined') {
  initApp(document);
  initAi(document);

  if (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    window.isSecureContext &&
    !window.CALC_NATIVE
  ) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}
