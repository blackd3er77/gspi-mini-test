const APP_ASSET_VERSION = window.APP_ASSET_VERSION || String(Date.now());

const DEFAULT_SETTINGS = {
  bankFile: 'questions_bank_schema_normalized_v2.json',
  testSize: 30,
  testMinutes: 50,
  allowedStatuses: ['ready'],
  supportedTypes: ['input_number', 'mcq_single', 'mcq_multi'],
  excludeTypes: ['mcq_multi', 'mark_positions', 'unresolved'],
  excludeQuestionIds: ['ch2_q14'],
  imageBasePath: 'img',
  renderOptions: {
    numericMcqAsInput: true,
    hideChoicesForNumericMcq: true,
    allowFractionInput: true,
  },
  selection: {
    typeTargets: {
      input_number: 1.0,
      mcq_single: 0,
      mcq_multi: 0,
    },
    chapterWeights: { default: 1 },
  },
};

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  flatBank: [],
  questions: [],
  currentIndex: 0,
  answers: [],
  done: [],
  secondsLeft: DEFAULT_SETTINGS.testMinutes * 60,
  timerId: null,
  submitted: false,
  resultDetails: [],
};

const questionCardEl = document.getElementById('question-card');
const resultScreenEl = document.getElementById('result-screen');
const questionNumberEl = document.getElementById('question-number');
const questionTextEl = document.getElementById('question-text');
const answerInputEl = document.getElementById('answer-input');
const answerUnitEl = document.getElementById('answer-unit');
const questionNavEl = document.getElementById('question-nav');
const statusTextEl = document.getElementById('status-text');
const timerEl = document.getElementById('timer');
const resultCorrectEl = document.getElementById('result-correct');
const resultTotalEl = document.getElementById('result-total');
const resultPercentEl = document.getElementById('result-percent');
const resultAnsweredEl = document.getElementById('result-answered');
const resultCheckedEl = document.getElementById('result-checked');
const resultNoteEl = document.getElementById('result-note');

const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');
const newTestBtn = document.getElementById('new-test-btn');
const toggleDoneBtn = document.getElementById('toggle-done-btn');

questionTextEl.style.whiteSpace = 'pre-wrap';

// dynamic containers so index.html can stay unchanged
const mediaWrapEl = document.createElement('div');
mediaWrapEl.id = 'question-media-wrap';
mediaWrapEl.className = 'question-media-wrap';
questionTextEl.insertAdjacentElement('afterend', mediaWrapEl);

const choicesWrapEl = document.createElement('div');
choicesWrapEl.id = 'choices-wrap';
choicesWrapEl.className = 'choices-wrap';
mediaWrapEl.insertAdjacentElement('afterend', choicesWrapEl);

const resultPanelEl = resultScreenEl.querySelector('.result-panel');

const resultActionsEl = document.createElement('div');
resultActionsEl.className = 'result-actions';
resultActionsEl.innerHTML = '<button id="toggle-result-details-btn" class="ghost-btn" type="button">Show answer review</button>';
resultPanelEl.appendChild(resultActionsEl);

const resultDetailsEl = document.createElement('div');
resultDetailsEl.id = 'result-details';
resultDetailsEl.className = 'result-details hidden';
resultPanelEl.appendChild(resultDetailsEl);

const toggleResultDetailsBtn = document.getElementById('toggle-result-details-btn');

injectExtraStyles();

async function init() {
  try {
    const settingsRes = await fetch(`settings.json?v=${encodeURIComponent(APP_ASSET_VERSION)}`, { cache: 'no-store' });
    if (settingsRes.ok) {
      const loaded = await settingsRes.json();
      state.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), loaded || {});
    }
  } catch (err) {
    console.warn('settings.json not loaded, using defaults', err);
  }

  const subtitleEl = document.querySelector('.subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `${state.settings.testSize} questions · input focused · random from bank`;
  }
  if (timerEl) {
    timerEl.textContent = formatTime(state.settings.testMinutes * 60);
  }

  const bankFile = state.settings.bankFile || DEFAULT_SETTINGS.bankFile;
  const res = await fetch(`${bankFile}?v=${encodeURIComponent(APP_ASSET_VERSION)}`, { cache: 'no-store' });
  const data = await res.json();
  state.flatBank = flattenQuestionBank(data);
  startNewTest();
}

function flattenQuestionBank(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.questions)) return data.questions;
  if (Array.isArray(data.chapters)) {
    return data.chapters.flatMap(ch => (ch.questions || []).map(q => ({ ...q, chapter_id: q.chapter_id || ch.chapter_id })));
  }
  return [];
}

function startNewTest() {
  const available = getEligibleQuestions();
  const testSize = state.settings.testSize;

  if (available.length < testSize) {
    alert(`Eligible question bank only has ${available.length} questions. Need at least ${testSize}.`);
    return;
  }

  clearInterval(state.timerId);
  state.questions = selectQuestions(available, testSize);
  state.currentIndex = 0;
  state.answers = Array(testSize).fill(null).map(() => '');
  state.done = Array(testSize).fill(false);
  state.secondsLeft = state.settings.testMinutes * 60;
  state.submitted = false;
  state.resultDetails = [];

  questionCardEl.classList.remove('hidden');
  resultScreenEl.classList.add('hidden');
  resultDetailsEl.classList.add('hidden');
  toggleResultDetailsBtn.textContent = 'Show answer review';

  buildNav();
  renderQuestion();
  startTimer();
}

function getEligibleQuestions() {
  const settings = state.settings;
  const allowedStatuses = new Set(settings.allowedStatuses || ['ready']);
  const supportedTypes = new Set(settings.supportedTypes || ['input_number', 'mcq_single', 'mcq_multi']);
  const excludeTypes = new Set(settings.excludeTypes || []);
  const excludeIds = new Set(settings.excludeQuestionIds || []);

  return state.flatBank
    .filter(q => !excludeIds.has(q.id))
    .filter(q => allowedStatuses.has(q.status || 'ready'))
    .filter(q => supportedTypes.has(q.type))
    .filter(q => !excludeTypes.has(q.type))
    .filter(q => getEffectiveRenderMode(q) !== 'unsupported');
}

function selectQuestions(pool, testSize) {
  const annotated = pool.map(q => ({
    ...q,
    _effectiveType: getSelectionType(q),
    _chapterWeight: getChapterWeight(q.chapter_id),
  }));

  const typeTargets = state.settings.selection?.typeTargets || { input_number: 1 };
  const availableByType = groupBy(annotated, q => q._effectiveType);
  const desiredCounts = allocateTypeCounts(typeTargets, availableByType, testSize);

  let selected = [];
  for (const [type, count] of Object.entries(desiredCounts)) {
    if (count <= 0) continue;
    const chosen = weightedSampleWithoutReplacement(availableByType[type] || [], count, q => q._chapterWeight);
    selected.push(...chosen);
  }

  if (selected.length < testSize) {
    const selectedIds = new Set(selected.map(q => q.id));
    const leftovers = annotated.filter(q => !selectedIds.has(q.id));
    const filler = weightedSampleWithoutReplacement(leftovers, testSize - selected.length, q => q._chapterWeight);
    selected.push(...filler);
  }

  return shuffle(selected).slice(0, testSize);
}

function getSelectionType(q) {
  const mode = getEffectiveRenderMode(q);
  if (mode === 'input_number') return 'input_number';
  return q.type;
}

function allocateTypeCounts(typeTargets, availableByType, total) {
  const positiveTargets = Object.entries(typeTargets).filter(([, v]) => Number(v) > 0 && (availableByType?.[arguments[0]] || true));
  const targetEntries = Object.entries(typeTargets).filter(([type, v]) => Number(v) > 0 && (availableByType[type] || []).length > 0);
  if (!targetEntries.length) {
    const fallbackType = Object.keys(availableByType).find(k => (availableByType[k] || []).length > 0);
    return { [fallbackType]: total };
  }

  const sum = targetEntries.reduce((acc, [, v]) => acc + Number(v), 0);
  const raw = targetEntries.map(([type, weight]) => ({ type, raw: (Number(weight) / sum) * total }));
  const counts = Object.fromEntries(raw.map(({ type, raw }) => [type, Math.floor(raw)]));
  let assigned = Object.values(counts).reduce((a, b) => a + b, 0);

  raw.sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)));
  for (const entry of raw) {
    if (assigned >= total) break;
    counts[entry.type] += 1;
    assigned += 1;
  }

  // cap by availability
  let deficit = 0;
  for (const type of Object.keys(counts)) {
    const maxAvail = (availableByType[type] || []).length;
    if (counts[type] > maxAvail) {
      deficit += counts[type] - maxAvail;
      counts[type] = maxAvail;
    }
  }

  // redistribute deficit
  if (deficit > 0) {
    for (const { type } of raw) {
      if (deficit <= 0) break;
      const avail = (availableByType[type] || []).length;
      const room = avail - counts[type];
      if (room <= 0) continue;
      const add = Math.min(room, deficit);
      counts[type] += add;
      deficit -= add;
    }
  }

  return counts;
}

function weightedSampleWithoutReplacement(arr, count, weightFn) {
  const pool = [...arr];
  const out = [];
  while (pool.length && out.length < count) {
    const totalWeight = pool.reduce((acc, item) => acc + Math.max(0.0001, Number(weightFn(item)) || 1), 0);
    let r = Math.random() * totalWeight;
    let pickedIndex = 0;
    for (let i = 0; i < pool.length; i += 1) {
      r -= Math.max(0.0001, Number(weightFn(pool[i])) || 1);
      if (r <= 0) {
        pickedIndex = i;
        break;
      }
    }
    out.push(pool[pickedIndex]);
    pool.splice(pickedIndex, 1);
  }
  return out;
}

function getChapterWeight(chapterId) {
  const map = state.settings.selection?.chapterWeights || { default: 1 };
  return Number(map[chapterId] ?? map.default ?? 1) || 1;
}

function buildNav() {
  questionNavEl.innerHTML = '';
  state.questions.forEach((_, index) => {
    const row = document.createElement('div');
    row.className = 'nav-row';

    const numBtn = document.createElement('button');
    numBtn.className = 'num-btn';
    numBtn.textContent = String(index + 1);
    numBtn.addEventListener('click', () => {
      if (state.submitted) return;
      saveCurrentAnswer();
      state.currentIndex = index;
      renderQuestion();
    });

    const checkBtn = document.createElement('button');
    checkBtn.className = 'check-btn';
    checkBtn.setAttribute('aria-label', `Toggle checked for question ${index + 1}`);
    checkBtn.addEventListener('click', () => {
      if (state.submitted) return;
      state.done[index] = !state.done[index];
      renderNav();
      renderStatus();
    });

    row.appendChild(numBtn);
    row.appendChild(checkBtn);
    questionNavEl.appendChild(row);
  });
  renderNav();
}

function setCheckIcon(buttonEl, isDone) {
  buttonEl.classList.toggle('done', isDone);
  buttonEl.textContent = isDone ? '✓' : '';
}

function renderNav() {
  const rows = [...questionNavEl.children];
  rows.forEach((row, index) => {
    const numBtn = row.children[0];
    const checkBtn = row.children[1];
    numBtn.classList.toggle('current', index === state.currentIndex && !state.submitted);
    numBtn.classList.toggle('answered', hasAnswerValue(state.answers[index]));
    setCheckIcon(checkBtn, state.done[index]);
  });
  setCheckIcon(toggleDoneBtn, state.done[state.currentIndex]);
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  const mode = getEffectiveRenderMode(q);
  questionNumberEl.textContent = `Question ${state.currentIndex + 1}:`;
  questionTextEl.textContent = q.prompt || q.question || '';

  renderMedia(q);
  renderAnswerArea(q, mode);
  renderNav();
  renderStatus();
  backBtn.disabled = state.currentIndex === 0 || state.submitted;
  nextBtn.disabled = state.submitted;
  nextBtn.textContent = state.currentIndex === state.questions.length - 1 ? 'Finish' : 'Next';
  if (!state.submitted && mode === 'input_number') answerInputEl.focus();
}

function renderMedia(q) {
  mediaWrapEl.innerHTML = '';
  const diagramSrc = resolveDiagramSrc(q.diagram);
  if (diagramSrc) {
    const img = document.createElement('img');
    img.src = diagramSrc;
    img.alt = q.id || 'question diagram';
    img.className = 'question-image';
    img.loading = 'lazy';
    mediaWrapEl.appendChild(img);
  }

  if (q.table_data) {
    mediaWrapEl.appendChild(renderTable(q.table_data));
  }

  mediaWrapEl.classList.toggle('hidden', mediaWrapEl.children.length === 0);
}

function resolveDiagramSrc(diagram) {
  if (!diagram || diagram.type !== 'image') return null;
  const url = diagram.image_url;
  if (url && !String(url).startsWith('REPLACE_WITH_HOSTED_URL')) return url;
  const ref = diagram.image_ref;
  if (ref) {
    const base = (state.settings.imageBasePath || 'img').replace(/\/$/, '');
    return `${base}/${ref}`;
  }
  return null;
}

function renderTable(tableData) {
  const tableWrap = document.createElement('div');
  tableWrap.className = 'question-table-wrap';
  const table = document.createElement('table');
  table.className = 'question-table';

  const columns = Array.isArray(tableData.columns) ? tableData.columns : Array.isArray(tableData.headers) ? tableData.headers : null;
  const rows = Array.isArray(tableData.rows) ? tableData.rows : [];

  if (columns && columns.length) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = String(col ?? '');
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    (row || []).forEach(cell => {
      const td = document.createElement('td');
      td.textContent = String(cell ?? '');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  return tableWrap;
}

function renderAnswerArea(q, mode) {
  choicesWrapEl.innerHTML = '';
  choicesWrapEl.classList.add('hidden');

  if (mode === 'input_number') {
    const current = typeof state.answers[state.currentIndex] === 'string' ? state.answers[state.currentIndex] : '';
    answerInputEl.value = current;
    answerInputEl.disabled = state.submitted;
    answerInputEl.parentElement.classList.remove('hidden');
    answerUnitEl.textContent = q.unit || inferNumericUnit(q) || '';
    return;
  }

  answerInputEl.value = '';
  answerInputEl.disabled = true;
  answerInputEl.parentElement.classList.add('hidden');
  choicesWrapEl.classList.remove('hidden');

  if (mode === 'mcq_single') {
    renderMcqSingle(q);
  } else if (mode === 'mcq_multi') {
    renderMcqMulti(q);
  }
}

function renderMcqSingle(q) {
  const selected = typeof state.answers[state.currentIndex] === 'string' ? state.answers[state.currentIndex] : '';
  Object.entries(q.choices || {}).forEach(([key, label]) => {
    const row = document.createElement('label');
    row.className = 'choice-row';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `q_${state.currentIndex}`;
    radio.value = key;
    radio.checked = selected === key;
    radio.disabled = state.submitted;
    radio.addEventListener('change', () => {
      state.answers[state.currentIndex] = key;
      renderNav();
      renderStatus();
    });
    const text = document.createElement('span');
    text.innerHTML = `<strong>${escapeHtml(key)}.</strong> ${escapeHtml(label)}`;
    row.append(radio, text);
    choicesWrapEl.appendChild(row);
  });
}

function renderMcqMulti(q) {
  const selected = Array.isArray(state.answers[state.currentIndex]) ? state.answers[state.currentIndex] : [];
  Object.entries(q.choices || {}).forEach(([key, label]) => {
    const row = document.createElement('label');
    row.className = 'choice-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = key;
    box.checked = selected.includes(key);
    box.disabled = state.submitted;
    box.addEventListener('change', () => {
      const current = new Set(Array.isArray(state.answers[state.currentIndex]) ? state.answers[state.currentIndex] : []);
      if (box.checked) current.add(key); else current.delete(key);
      state.answers[state.currentIndex] = [...current].sort();
      renderNav();
      renderStatus();
    });
    const text = document.createElement('span');
    text.innerHTML = `<strong>${escapeHtml(key)}.</strong> ${escapeHtml(label)}`;
    row.append(box, text);
    choicesWrapEl.appendChild(row);
  });
}

function renderStatus() {
  const hasAnswer = hasAnswerValue(state.answers[state.currentIndex]);
  const isDone = state.done[state.currentIndex];
  if (isDone && hasAnswer) statusTextEl.textContent = 'Done';
  else if (isDone) statusTextEl.textContent = 'Checked';
  else if (hasAnswer) statusTextEl.textContent = 'Answered';
  else statusTextEl.textContent = 'Unchecked';
}

function saveCurrentAnswer() {
  const q = state.questions[state.currentIndex];
  const mode = getEffectiveRenderMode(q);
  if (mode === 'input_number') {
    state.answers[state.currentIndex] = answerInputEl.value.trim();
  }
  renderNav();
  renderStatus();
}

function startTimer() {
  updateTimer();
  state.timerId = setInterval(() => {
    state.secondsLeft -= 1;
    updateTimer();
    if (state.secondsLeft <= 0) {
      clearInterval(state.timerId);
      saveCurrentAnswer();
      submitTest(true);
    }
  }, 1000);
}

function updateTimer() {
  timerEl.textContent = formatTime(Math.max(state.secondsLeft, 0));
}

function normalizeNumber(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === '') return null;
  s = s.replace(/\s+/g, '');
  s = s.replace(/，/g, ',').replace(/％/g, '%');

  if (state.settings.renderOptions?.allowFractionInput && /^-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?$/.test(s)) {
    const [a, b] = s.split('/');
    const num = Number(a);
    const den = Number(b);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
  }

  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }

  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1);
  }

  s = s.replace(/,/g, '');
  s = s.replace(/(?:yen|円|km\/h|kmh|km²|km2|km|m\/s|m²|m2|m|g|kg|people|person|人|冊|匹|台|個|点|歳|rooms?|%)+$/i, '');
  s = s.replace(/[^0-9.]/g, '');
  if (s === '') return null;
  const num = Number(s) * sign;
  if (!Number.isFinite(num)) return null;
  return percent ? num : num;
}

function isStrictNumericAnswerText(value) {
  if (value == null) return false;

  const raw = String(value).trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();

  // Loại các đáp án có wording logic / diễn đạt bằng câu
  const bannedWords = [
    'increase',
    'decrease',
    'either',
    'must',
    'true',
    'false',
    'before',
    'after',
    'than',
    'at least',
    'at most',
    'more than',
    'less than'
  ];

  if (bannedWords.some(word => lower.includes(word))) {
    return false;
  }

  // Loại các đáp án mang tính mô tả/suy luận
  if (/[a-z]{2,}/i.test(raw.replace(/^(?:-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*)/, ''))) {
    const allowedUnitOnly = raw.match(/^[-]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*(%|yen|円|km\/h|km²|km2|km|m\/s|m²|m2|m|g|kg|rooms?|people|person|人|冊|匹|台|個|点|歳)?$/i);
    if (!allowedUnitOnly) return false;
  }

  // Chỉ cho phép:
  // số
  // số thập phân
  // phân số
  // số + 1 unit đơn giản
  return /^-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*(%|yen|円|km\/h|km²|km2|km|m\/s|m²|m2|m|g|kg|rooms?|people|person|人|冊|匹|台|個|点|歳)?$/i.test(raw);
}

function isNumericLike(value) {
  return isStrictNumericAnswerText(value);
}

function isNumericMcqQuestion(q) {
  if (!q || q.type !== 'mcq_single') return false;
  if (!q.choices || !q.answer || q.answer.length !== 1) return false;

  const choiceValues = Object.values(q.choices);
  if (choiceValues.length === 0) return false;

  return choiceValues.every(v => isStrictNumericAnswerText(v));
}

function hasStrictNumericCorrectAnswer(q) {
  if (!q || q.type !== 'mcq_single') return false;
  if (!q.answer || q.answer.length !== 1) return false;
  const correctKey = q.answer[0];
  const correctValue = q.choices?.[correctKey];
  return isStrictNumericAnswerText(correctValue);
}


function inferNumericUnit(q) {
  if (q.unit) return q.unit;
  if (isNumericMcqQuestion(q)) {
    const correct = q.choices[q.answer[0]];
    const m = String(correct).trim().match(/(%|yen|円|km\/h|km²|km2|km|m\/s|m²|m2|m|g|kg|people|person|人|冊|匹|台|個|点|歳)$/i);
    return m ? m[1] : '';
  }
  return '';
}

function getEffectiveRenderMode(q) {
  if (q.type === 'input_number') return 'input_number';

  if (
    q.type === 'mcq_single' &&
    state.settings.renderOptions?.numericMcqAsInput &&
    isNumericMcqQuestion(q) &&
    hasStrictNumericCorrectAnswer(q)
  ) {
    return 'input_number';
  }

  if (q.type === 'mcq_single' || q.type === 'mcq_multi') return q.type;
  return 'unsupported';
}

function getScoringMode(q) {
  const renderMode = getEffectiveRenderMode(q);
  if (renderMode === 'input_number') return 'numeric';
  if (renderMode === 'mcq_single') return 'single';
  if (renderMode === 'mcq_multi') return 'multi';
  return 'unsupported';
}

function getCorrectNumericAnswer(q) {
  if (q.type === 'input_number') return q.answer;
  if (q.type === 'mcq_single' && isNumericMcqQuestion(q)) {
    return q.choices[q.answer[0]];
  }
  return null;
}

function getTolerance(q) {
  return Number(q?.scoring?.tolerance ?? 0.01) || 0.01;
}

function submitTest(auto = false) {
  saveCurrentAnswer();
  state.submitted = true;
  clearInterval(state.timerId);
  answerInputEl.disabled = true;

  let correct = 0;
  state.resultDetails = state.questions.map((q, i) => {
    const mode = getScoringMode(q);
    const user = state.answers[i];
    const detail = {
      index: i,
      id: q.id,
      chapterId: q.chapter_id || '',
      sourceQuestion: q.source_question ?? '',
      prompt: q.prompt || q.question || '',
      userDisplay: formatUserAnswerDisplay(q, user),
      correctDisplay: formatCorrectAnswerDisplay(q),
      correct: false,
    };

    if (mode === 'numeric') {
      const u = normalizeNumber(user);
      const c = normalizeNumber(getCorrectNumericAnswer(q));
      detail.correct = u != null && c != null && Math.abs(u - c) <= getTolerance(q);
    } else if (mode === 'single') {
      detail.correct = String(user || '') === String(q.answer?.[0] || '');
    } else if (mode === 'multi') {
      const userSet = [...(Array.isArray(user) ? user : [])].sort().join('|');
      const answerSet = [...(q.answer || [])].sort().join('|');
      detail.correct = userSet === answerSet;
    }

    if (detail.correct) correct += 1;
    return detail;
  });

  const percent = ((correct / state.questions.length) * 100).toFixed(1);
  const answered = state.answers.filter(v => hasAnswerValue(v)).length;
  const checked = state.done.filter(Boolean).length;

  resultCorrectEl.textContent = String(correct);
  resultTotalEl.textContent = String(state.questions.length);
  const total2 = document.querySelector('.result-total-2');
  const total3 = document.querySelector('.result-total-3');
  if (total2) total2.textContent = String(state.questions.length);
  if (total3) total3.textContent = String(state.questions.length);
  resultPercentEl.textContent = `${percent}%`;
  resultAnsweredEl.textContent = String(answered);
  resultCheckedEl.textContent = String(checked);
  resultNoteEl.textContent = auto
    ? 'Time is up. Result was submitted automatically.'
    : 'Test completed. Numeric answers support decimal or fraction input. Example: 3/4 and 0.75 are treated as the same.';

  questionCardEl.classList.add('hidden');
  resultScreenEl.classList.remove('hidden');
  renderResultDetails();
  renderNav();
  backBtn.disabled = true;
  nextBtn.disabled = true;
  nextBtn.textContent = 'Next';
}

function renderResultDetails() {
  resultDetailsEl.innerHTML = '';
  state.resultDetails.forEach(item => {
    const card = document.createElement('div');
    card.className = `review-card ${item.correct ? 'ok' : 'bad'}`;
    card.innerHTML = `
      <div class="review-head">${item.correct ? '✅' : '❌'} Question ${item.index + 1}</div>
      <div class="review-line"><strong>Source:</strong> ${escapeHtml(item.chapterId || '(unknown)')} · Question ${escapeHtml(String(item.sourceQuestion || '?'))}</div>
      <div class="review-prompt">${escapeHtml(item.prompt).replace(/\n/g, '<br>')}</div>
      <div class="review-line"><strong>Your answer:</strong> ${escapeHtml(item.userDisplay)}</div>
      <div class="review-line"><strong>Correct answer:</strong> ${escapeHtml(item.correctDisplay)}</div>
    `;
    resultDetailsEl.appendChild(card);
  });
}

function formatUserAnswerDisplay(q, user) {
  if (!hasAnswerValue(user)) return '(blank)';
  const mode = getScoringMode(q);
  if (mode === 'numeric') return String(user);
  if (mode === 'single') {
    const choiceText = q.choices?.[user];
    return choiceText ? `${user}. ${choiceText}` : String(user);
  }
  if (mode === 'multi') {
    return (Array.isArray(user) ? user : []).map(k => q.choices?.[k] ? `${k}. ${q.choices[k]}` : k).join(' | ');
  }
  return String(user);
}

function formatCorrectAnswerDisplay(q) {
  const mode = getScoringMode(q);
  if (mode === 'numeric') return String(getCorrectNumericAnswer(q));
  if (mode === 'single') {
    const key = q.answer?.[0];
    return q.choices?.[key] ? `${key}. ${q.choices[key]}` : String(key || '');
  }
  if (mode === 'multi') {
    return (q.answer || []).map(k => q.choices?.[k] ? `${k}. ${q.choices[k]}` : k).join(' | ');
  }
  return '';
}

function hasAnswerValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? '').trim() !== '';
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {});
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deepMerge(target, source) {
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = deepMerge(target[key] ? { ...target[key] } : {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function injectExtraStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .hidden { display: none !important; }
    .question-media-wrap { margin: 12px 0; display: grid; gap: 10px; }
    .question-image { max-width: min(760px, 100%); border: 1px solid #666; background: #fff; display: block; }
    .question-table-wrap { overflow-x: auto; max-width: min(860px, 100%); }
    .question-table { border-collapse: collapse; background: #fff; font-size: 13px; min-width: 360px; }
    .question-table th, .question-table td { border: 1px solid #666; padding: 6px 8px; vertical-align: top; }
    .question-table th { background: #efefef; font-weight: 700; }
    .question-table tbody tr:nth-child(even) td { background: #fafafa; }
    .choices-wrap { display: grid; gap: 8px; margin-top: 8px; max-width: 760px; }
    .choice-row { display: flex; align-items: flex-start; gap: 8px; font-size: 15px; line-height: 1.4; }
    .choice-row input { margin-top: 3px; }
    .result-actions { margin-top: 12px; }
    .result-details { display: grid; gap: 10px; margin-top: 12px; max-width: 860px; }
    .review-card { background: #fff; border: 1px solid #444; padding: 10px 12px; }
    .review-card.ok { border-left: 6px solid #2f8f46; }
    .review-card.bad { border-left: 6px solid #c93d3d; }
    .review-head { font-weight: 700; margin-bottom: 8px; }
    .review-prompt { margin-bottom: 8px; line-height: 1.45; white-space: normal; }
    .review-line { margin-bottom: 4px; }
  `;
  document.head.appendChild(style);
}

backBtn.addEventListener('click', () => {
  saveCurrentAnswer();
  if (state.currentIndex > 0) {
    state.currentIndex -= 1;
    renderQuestion();
  }
});

nextBtn.addEventListener('click', () => {
  saveCurrentAnswer();
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
    return;
  }
  const ok = confirm('Finish this test and see the result?');
  if (ok) submitTest(false);
});

newTestBtn.addEventListener('click', () => {
  const ok = confirm(`Start a new random ${state.settings.testSize}-question test? Current answers will be cleared.`);
  if (ok) startNewTest();
});

toggleDoneBtn.addEventListener('click', () => {
  if (state.submitted) return;
  state.done[state.currentIndex] = !state.done[state.currentIndex];
  renderNav();
  renderStatus();
});

answerInputEl.addEventListener('input', () => {
  state.answers[state.currentIndex] = answerInputEl.value.trim();
  renderNav();
  renderStatus();
});

toggleResultDetailsBtn.addEventListener('click', () => {
  const isHidden = resultDetailsEl.classList.toggle('hidden');
  toggleResultDetailsBtn.textContent = isHidden ? 'Show answer review' : 'Hide answer review';
});

init().catch(err => {
  console.error(err);
  alert('Failed to load app files. Please check settings.json and question bank path.');
});
