const APP_ASSET_VERSION = window.APP_ASSET_VERSION || String(Date.now());

const state = {
  settings: null,
  bank: [],
  questions: [],
  currentIndex: 0,
  answers: [],
  done: [],
  secondsLeft: 0,
  timerId: null,
  submitted: false,
  reviewVisible: false,
};

const questionCardEl = document.getElementById('question-card');
const resultScreenEl = document.getElementById('result-screen');
const subtitleEl = document.getElementById('subtitle');
const questionMetaEl = document.getElementById('question-meta');
const questionNumberEl = document.getElementById('question-number');
const questionTextEl = document.getElementById('question-text');
const questionMediaEl = document.getElementById('question-media');
const questionTableWrapEl = document.getElementById('question-table-wrap');
const choicesWrapEl = document.getElementById('choices-wrap');
const answerRowEl = document.getElementById('answer-row');
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
const resultReviewEl = document.getElementById('result-review');
const toggleReviewBtn = document.getElementById('toggle-review-btn');

const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');
const newTestBtn = document.getElementById('new-test-btn');
const toggleDoneBtn = document.getElementById('toggle-done-btn');

async function init() {
  const settingsRes = await fetch(`settings.json?v=${encodeURIComponent(APP_ASSET_VERSION)}`, { cache: 'no-store' });
  state.settings = await settingsRes.json();

  const bankFile = state.settings.bankFile || 'questions_bank_schema_normalized_v2.json';
  const bankRes = await fetch(`${bankFile}?v=${encodeURIComponent(APP_ASSET_VERSION)}`, { cache: 'no-store' });
  const bankData = await bankRes.json();
  state.bank = flattenBank(bankData);

  const testSize = state.settings.testSize || 30;
  const testMinutes = state.settings.testMinutes || 50;
  subtitleEl.textContent = `${testSize} questions · mixed types · random from bank`;
  timerEl.textContent = `${String(testMinutes).padStart(2, '0')}:00`;

  startNewTest();
}

function flattenBank(payload) {
  if (Array.isArray(payload.questions)) return payload.questions;
  if (Array.isArray(payload.chapters)) {
    return payload.chapters.flatMap((chapter) =>
      (chapter.questions || []).map((q) => ({
        ...q,
        chapter_title: chapter.chapter_title || chapter.chapter_id || q.chapter_id,
      }))
    );
  }
  return [];
}

function getTestSize() {
  return Number(state.settings?.testSize || 30);
}

function getTestMinutes() {
  return Number(state.settings?.testMinutes || 50);
}

function getImageBasePath() {
  return String(state.settings?.imageBasePath || 'img').replace(/\/$/, '');
}

function startNewTest() {
  clearInterval(state.timerId);

  const selected = buildTestFromSettings(state.bank, state.settings);
  if (selected.length < getTestSize()) {
    alert(`Question bank only produced ${selected.length} supported questions. Please review settings.json.`);
    return;
  }

  state.questions = selected;
  state.currentIndex = 0;
  state.answers = Array.from({ length: state.questions.length }, () => createEmptyAnswer());
  state.done = Array.from({ length: state.questions.length }, () => false);
  state.secondsLeft = getTestMinutes() * 60;
  state.submitted = false;
  state.reviewVisible = false;

  questionCardEl.classList.remove('hidden');
  resultScreenEl.classList.add('hidden');
  resultReviewEl.classList.add('hidden');
  toggleReviewBtn.classList.add('hidden');
  toggleReviewBtn.textContent = 'Hiện chi tiết câu đúng sai';
  answerInputEl.disabled = false;
  choicesWrapEl.innerHTML = '';
  buildNav();
  renderQuestion();
  startTimer();
}

function buildTestFromSettings(bank, settings) {
  const testSize = Number(settings?.testSize || 30);
  const allowedStatuses = new Set(settings?.allowedStatuses || ['ready']);
  const supportedTypes = new Set(settings?.supportedTypes || ['input_number', 'mcq_single', 'mcq_multi']);
  const excludedIds = new Set(settings?.excludeQuestionIds || []);

  const eligible = bank.filter((q) =>
    allowedStatuses.has(q.status) &&
    supportedTypes.has(q.type) &&
    !excludedIds.has(q.id)
  );

  const byType = {};
  for (const q of eligible) {
    (byType[q.type] ||= []).push(q);
  }

  const typeTargets = settings?.selection?.typeTargets || { input_number: 1 };
  const initialCounts = allocateTypeCounts(typeTargets, testSize, byType);
  const selected = [];
  const usedIds = new Set();

  Object.entries(initialCounts).forEach(([type, count]) => {
    const bucket = weightedShuffle((byType[type] || []), settings);
    for (const q of bucket) {
      if (selected.length >= testSize) break;
      if (countForType(selected, type) >= count) break;
      if (usedIds.has(q.id)) continue;
      selected.push(q);
      usedIds.add(q.id);
    }
  });

  if (selected.length < testSize) {
    const remaining = weightedShuffle(eligible.filter((q) => !usedIds.has(q.id)), settings);
    for (const q of remaining) {
      if (selected.length >= testSize) break;
      selected.push(q);
      usedIds.add(q.id);
    }
  }

  return shuffle(selected).slice(0, testSize);
}

function allocateTypeCounts(typeTargets, testSize, byType) {
  const entries = Object.entries(typeTargets).filter(([type]) => (byType[type] || []).length > 0);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + Number(weight || 0), 0) || 1;
  const allocations = {};
  let assigned = 0;
  const remainders = [];

  for (const [type, weight] of entries) {
    const raw = (Number(weight || 0) / totalWeight) * testSize;
    const capped = Math.min(Math.floor(raw), (byType[type] || []).length);
    allocations[type] = capped;
    assigned += capped;
    remainders.push({ type, remainder: raw - Math.floor(raw) });
  }

  remainders.sort((a, b) => b.remainder - a.remainder);
  let idx = 0;
  while (assigned < testSize && remainders.length > 0) {
    const item = remainders[idx % remainders.length];
    const available = (byType[item.type] || []).length;
    if ((allocations[item.type] || 0) < available) {
      allocations[item.type] += 1;
      assigned += 1;
    }
    idx += 1;
    if (idx > 1000) break;
  }

  return allocations;
}

function weightedShuffle(items, settings) {
  return items
    .map((item) => ({ item, score: Math.random() * getQuestionWeight(item, settings) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

function getQuestionWeight(q, settings) {
  const chapterWeights = settings?.selection?.chapterWeights || {};
  const chapterWeight = Number(chapterWeights[q.chapter_id] ?? chapterWeights.default ?? 1);
  return Math.max(chapterWeight, 0.0001);
}

function countForType(selected, type) {
  return selected.filter((q) => q.type === type).length;
}

function createEmptyAnswer() {
  return { value: '', selected: [] };
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

function isQuestionAnswered(index) {
  const q = state.questions[index];
  const a = state.answers[index];
  if (!q || !a) return false;
  if (q.type === 'input_number') return String(a.value || '').trim() !== '';
  return Array.isArray(a.selected) && a.selected.length > 0;
}

function renderNav() {
  const rows = [...questionNavEl.children];
  rows.forEach((row, index) => {
    const numBtn = row.children[0];
    const checkBtn = row.children[1];

    numBtn.classList.toggle('current', index === state.currentIndex && !state.submitted);
    numBtn.classList.toggle('answered', isQuestionAnswered(index));
    setCheckIcon(checkBtn, state.done[index]);
  });

  setCheckIcon(toggleDoneBtn, state.done[state.currentIndex]);
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  const chapterLabel = q.chapter_title || q.chapter_id || '';
  const partLabel = q.part != null ? ` · Part ${q.part}` : '';
  questionMetaEl.textContent = `${chapterLabel} · ${q.type}${partLabel}`;
  questionNumberEl.textContent = `Question ${state.currentIndex + 1}:`;
  questionTextEl.textContent = q.prompt || q.question || '';
  renderDiagram(q);
  renderTable(q);
  renderAnswerArea(q);
  renderNav();
  renderStatus();
  backBtn.disabled = state.currentIndex === 0 || state.submitted;
  nextBtn.disabled = state.submitted;
  nextBtn.textContent = state.currentIndex === state.questions.length - 1 ? 'Finish' : 'Next';
  if (!state.submitted && q.type === 'input_number') answerInputEl.focus();
}

function resolveDiagramSrc(diagram) {
  if (!diagram) return null;
  const rawUrl = String(diagram.image_url || '').trim();
  if (rawUrl && !rawUrl.startsWith('REPLACE_WITH_HOSTED_URL')) {
    return rawUrl;
  }
  const ref = String(diagram.image_ref || '').trim();
  if (!ref) return null;
  return `${getImageBasePath()}/${ref}`;
}

function renderDiagram(q) {
  questionMediaEl.innerHTML = '';
  questionMediaEl.classList.add('hidden');
  const diagram = q.diagram;
  if (!diagram) return;

  const src = resolveDiagramSrc(diagram);
  if (src) {
    const img = document.createElement('img');
    img.className = 'question-image';
    img.src = src;
    img.alt = `Diagram for ${q.id}`;
    img.loading = 'lazy';
    img.addEventListener('load', () => {
      questionMediaEl.classList.remove('hidden');
    });
    img.addEventListener('error', () => {
      questionMediaEl.innerHTML = '';
      const note = document.createElement('div');
      note.className = 'media-note';
      const target = diagram.image_ref ? `${getImageBasePath()}/${diagram.image_ref}` : src;
      note.textContent = `Image not found yet: ${target}`;
      questionMediaEl.appendChild(note);
      questionMediaEl.classList.remove('hidden');
    });
    questionMediaEl.appendChild(img);
    questionMediaEl.classList.remove('hidden');
    return;
  }

  const note = document.createElement('div');
  note.className = 'media-note';
  note.textContent = diagram.image_ref
    ? `Image placeholder: add ${diagram.image_ref} into the ${getImageBasePath()}/ folder or set a real image_url.`
    : 'Diagram exists for this question, but no image_ref or image_url has been added yet.';
  questionMediaEl.appendChild(note);
  questionMediaEl.classList.remove('hidden');
}

function renderTable(q) {
  questionTableWrapEl.innerHTML = '';
  questionTableWrapEl.classList.add('hidden');
  const tableData = q.table_data;
  if (!tableData) return;

  const columns = Array.isArray(tableData.columns) ? tableData.columns : [];
  const headers = Array.isArray(tableData.headers) ? tableData.headers : columns;
  const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
  if (!headers.length && !rows.length) return;

  const table = document.createElement('table');
  table.className = 'question-table';

  if (headers.length) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    headers.forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header ?? '';
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  const tbody = document.createElement('tbody');
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    row.forEach((cell, cellIndex) => {
      const isRowHeader = cellIndex === 0;
      const cellEl = (rowIndex === 0 && !headers.length) ? document.createElement('th') : document.createElement(isRowHeader ? 'th' : 'td');
      if (isRowHeader) cellEl.scope = 'row';
      cellEl.textContent = cell ?? '';
      tr.appendChild(cellEl);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  questionTableWrapEl.appendChild(table);
  questionTableWrapEl.classList.remove('hidden');
}

function renderAnswerArea(q) {
  choicesWrapEl.innerHTML = '';
  choicesWrapEl.classList.add('hidden');
  answerRowEl.classList.add('hidden');

  const currentAnswer = state.answers[state.currentIndex];

  if (q.type === 'input_number') {
    answerRowEl.classList.remove('hidden');
    answerInputEl.value = currentAnswer.value || '';
    answerInputEl.disabled = state.submitted;
    answerUnitEl.textContent = q.unit || '';
    answerInputEl.type = 'text';
    answerInputEl.inputMode = 'decimal';
    return;
  }

  answerInputEl.value = '';
  answerUnitEl.textContent = '';
  choicesWrapEl.classList.remove('hidden');

  const choiceEntries = Object.entries(q.choices || {});
  const inputType = q.type === 'mcq_multi' ? 'checkbox' : 'radio';

  choiceEntries.forEach(([key, text]) => {
    const label = document.createElement('label');
    label.className = 'choice-label';

    const input = document.createElement('input');
    input.type = inputType;
    input.name = `choice-${state.currentIndex}`;
    input.value = key;
    input.disabled = state.submitted;
    input.checked = (currentAnswer.selected || []).includes(key);
    input.addEventListener('change', () => {
      handleChoiceChange(q, key, input.checked);
    });

    const content = document.createElement('div');
    content.innerHTML = `<span class="choice-key">${escapeHtml(key)}.</span>${escapeHtml(text)}`;

    label.appendChild(input);
    label.appendChild(content);
    choicesWrapEl.appendChild(label);
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function handleChoiceChange(q, key, checked) {
  const current = state.answers[state.currentIndex];
  if (q.type === 'mcq_single') {
    current.selected = checked ? [key] : [];
  } else if (q.type === 'mcq_multi') {
    const set = new Set(current.selected || []);
    if (checked) set.add(key);
    else set.delete(key);
    current.selected = [...set].sort();
  }
  renderNav();
  renderStatus();
}

function renderStatus() {
  const hasAnswer = isQuestionAnswered(state.currentIndex);
  const isDone = state.done[state.currentIndex];
  if (isDone && hasAnswer) statusTextEl.textContent = 'Done';
  else if (isDone) statusTextEl.textContent = 'Checked';
  else if (hasAnswer) statusTextEl.textContent = 'Answered';
  else statusTextEl.textContent = 'Unchecked';
}

function saveCurrentAnswer() {
  const q = state.questions[state.currentIndex];
  if (!q) return;
  if (q.type === 'input_number') {
    state.answers[state.currentIndex].value = answerInputEl.value.trim();
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
  const mins = Math.floor(Math.max(state.secondsLeft, 0) / 60);
  const secs = Math.max(state.secondsLeft, 0) % 60;
  timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeNumber(input) {
  if (input == null) return null;
  const cleaned = String(input).trim().replace(/,/g, '').replace(/%/g, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function arraysEqualAsSets(a, b) {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function checkQuestion(q, userAnswerObj) {
  const method = q?.scoring?.method;
  if (method === 'numeric_exact') {
    const correctRaw = Array.isArray(q.answer) ? q.answer[0] : q.answer;
    const u = normalizeNumber(userAnswerObj?.value);
    const c = normalizeNumber(correctRaw);
    const tolerance = Number(q?.scoring?.tolerance ?? 0.01);
    const isCorrect = u != null && c != null && Math.abs(u - c) <= tolerance;
    return {
      isCorrect,
      userDisplay: userAnswerObj?.value?.trim() || '(blank)',
      correctDisplay: formatCorrectAnswer(q),
    };
  }

  if (method === 'exact_choice_set') {
    const userSelected = userAnswerObj?.selected || [];
    const correctSelected = q?.scoring?.answers || q.answer || [];
    return {
      isCorrect: arraysEqualAsSets(userSelected, correctSelected),
      userDisplay: userSelected.length ? userSelected.join(', ') : '(blank)',
      correctDisplay: formatCorrectAnswer(q),
    };
  }

  return {
    isCorrect: false,
    userDisplay: '(unsupported)',
    correctDisplay: formatCorrectAnswer(q),
  };
}

function formatCorrectAnswer(q) {
  if (q.type === 'input_number') {
    const raw = Array.isArray(q.answer) ? q.answer[0] : q.answer;
    return `${raw}${q.unit ? ` ${q.unit}` : ''}`.trim();
  }
  const answers = q?.scoring?.answers || q.answer || [];
  return Array.isArray(answers) ? answers.join(', ') : String(answers);
}

function submitTest(auto = false) {
  saveCurrentAnswer();
  state.submitted = true;
  clearInterval(state.timerId);
  answerInputEl.disabled = true;

  let correct = 0;
  const details = state.questions.map((q, i) => {
    const result = checkQuestion(q, state.answers[i]);
    if (result.isCorrect) correct += 1;
    return result;
  });

  const percent = ((correct / state.questions.length) * 100).toFixed(1);
  const answered = state.questions.filter((_, i) => isQuestionAnswered(i)).length;
  const checked = state.done.filter(Boolean).length;

  resultCorrectEl.textContent = String(correct);
  resultTotalEl.textContent = String(state.questions.length);
  document.querySelector('.result-total-2').textContent = String(state.questions.length);
  document.querySelector('.result-total-3').textContent = String(state.questions.length);
  resultPercentEl.textContent = `${percent}%`;
  resultAnsweredEl.textContent = String(answered);
  resultCheckedEl.textContent = String(checked);
  resultNoteEl.textContent = auto
    ? 'Time is up. Result was submitted automatically.'
    : 'You can expand the review section to check each correct / incorrect answer in detail.';

  renderReview(details);
  toggleReviewBtn.classList.remove('hidden');

  questionCardEl.classList.add('hidden');
  resultScreenEl.classList.remove('hidden');
  renderNav();
  backBtn.disabled = true;
  nextBtn.disabled = true;
  nextBtn.textContent = 'Next';
}

function renderReview(details) {
  resultReviewEl.innerHTML = '';
  state.questions.forEach((q, index) => {
    const detail = details[index];
    const item = document.createElement('div');
    item.className = `review-item ${detail.isCorrect ? 'ok' : 'bad'}`;

    const head = document.createElement('div');
    head.className = 'review-head';
    head.textContent = `${detail.isCorrect ? '✅' : '❌'} Q${index + 1} · ${q.id}`;

    const prompt = document.createElement('div');
    prompt.className = 'review-prompt';
    prompt.textContent = q.prompt || q.question || '';

    const yourAnswer = document.createElement('div');
    yourAnswer.className = 'review-line';
    yourAnswer.innerHTML = `<span class="review-label">Your answer:</span> ${escapeHtml(detail.userDisplay)}`;

    const correctAnswer = document.createElement('div');
    correctAnswer.className = 'review-line';
    correctAnswer.innerHTML = `<span class="review-label">Correct answer:</span> ${escapeHtml(detail.correctDisplay)}`;

    item.appendChild(head);
    item.appendChild(prompt);
    item.appendChild(yourAnswer);
    item.appendChild(correctAnswer);
    resultReviewEl.appendChild(item);
  });
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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
  const ok = confirm('Start a new random test? Current answers will be cleared.');
  if (ok) startNewTest();
});

toggleDoneBtn.addEventListener('click', () => {
  if (state.submitted) return;
  state.done[state.currentIndex] = !state.done[state.currentIndex];
  renderNav();
  renderStatus();
});

answerInputEl.addEventListener('input', () => {
  if (!state.questions[state.currentIndex] || state.questions[state.currentIndex].type !== 'input_number') return;
  state.answers[state.currentIndex].value = answerInputEl.value.trim();
  renderNav();
  renderStatus();
});

toggleReviewBtn.addEventListener('click', () => {
  state.reviewVisible = !state.reviewVisible;
  resultReviewEl.classList.toggle('hidden', !state.reviewVisible);
  toggleReviewBtn.textContent = state.reviewVisible
    ? 'Ẩn chi tiết câu đúng sai'
    : 'Hiện chi tiết câu đúng sai';
});

window.addEventListener('beforeunload', (e) => {
  const hasProgress = state.answers.some((a, idx) => isQuestionAnswered(idx));
  if (!state.submitted && hasProgress) {
    e.preventDefault();
    e.returnValue = '';
  }
});

init().catch((err) => {
  console.error(err);
  alert('Failed to load settings or question bank.');
});
