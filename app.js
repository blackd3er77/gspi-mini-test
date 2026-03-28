const APP_ASSET_VERSION = window.APP_ASSET_VERSION || String(Date.now());
const TEST_SIZE = 30;
const TEST_MINUTES = 50;

const state = {
  bank: [],
  questions: [],
  currentIndex: 0,
  answers: Array(TEST_SIZE).fill(''),
  done: Array(TEST_SIZE).fill(false),
  secondsLeft: TEST_MINUTES * 60,
  timerId: null,
  submitted: false,
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

async function init() {
  const res = await fetch(`questions.json?v=${encodeURIComponent(APP_ASSET_VERSION)}`, { cache: 'no-store' });
  const data = await res.json();
  state.bank = data.questions || [];
  startNewTest();
}

function startNewTest() {
  if (state.bank.length < TEST_SIZE) {
    alert(`Question bank needs at least ${TEST_SIZE} questions.`);
    return;
  }
  clearInterval(state.timerId);
  state.questions = shuffle([...state.bank]).slice(0, TEST_SIZE);
  state.currentIndex = 0;
  state.answers = Array(TEST_SIZE).fill('');
  state.done = Array(TEST_SIZE).fill(false);
  state.secondsLeft = TEST_MINUTES * 60;
  state.submitted = false;
  questionCardEl.classList.remove('hidden');
  resultScreenEl.classList.add('hidden');
  answerInputEl.disabled = false;
  buildNav();
  renderQuestion();
  startTimer();
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
    numBtn.classList.toggle('answered', state.answers[index].trim() !== '');

    setCheckIcon(checkBtn, state.done[index]);
  });

  setCheckIcon(toggleDoneBtn, state.done[state.currentIndex]);
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  questionNumberEl.textContent = `Question ${state.currentIndex + 1}:`;
  questionTextEl.textContent = q.question;
  answerInputEl.value = state.answers[state.currentIndex] || '';
  answerUnitEl.textContent = q.unit || '';
  renderNav();
  renderStatus();
  backBtn.disabled = state.currentIndex === 0 || state.submitted;
  nextBtn.disabled = state.submitted;
  nextBtn.textContent = state.currentIndex === state.questions.length - 1 ? 'Finish' : 'Next';
  if (!state.submitted) answerInputEl.focus();
}

function renderStatus() {
  const hasAnswer = state.answers[state.currentIndex].trim() !== '';
  const isDone = state.done[state.currentIndex];
  if (isDone && hasAnswer) {
    statusTextEl.textContent = 'Done';
  } else if (isDone) {
    statusTextEl.textContent = 'Checked';
  } else if (hasAnswer) {
    statusTextEl.textContent = 'Answered';
  } else {
    statusTextEl.textContent = 'Unchecked';
  }
}

function saveCurrentAnswer() {
  state.answers[state.currentIndex] = answerInputEl.value.trim();
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

function isCorrect(userAnswer, correctAnswer) {
  const u = normalizeNumber(userAnswer);
  const c = normalizeNumber(correctAnswer);
  if (u == null || c == null) return false;
  return Math.abs(u - c) < 0.01;
}

function submitTest(auto = false) {
  saveCurrentAnswer();
  state.submitted = true;
  clearInterval(state.timerId);
  answerInputEl.disabled = true;

  let correct = 0;
  state.questions.forEach((q, i) => {
    if (isCorrect(state.answers[i], q.answer)) correct += 1;
  });

  const percent = ((correct / state.questions.length) * 100).toFixed(1);
  const answered = state.answers.filter(v => v.trim() !== '').length;
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
    : 'Test completed. Answers are matched as numbers. Example: 3.4 and 3.40 are treated as the same.';

  questionCardEl.classList.add('hidden');
  resultScreenEl.classList.remove('hidden');
  renderNav();
  backBtn.disabled = true;
  nextBtn.disabled = true;
  nextBtn.textContent = 'Next';
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
  const ok = confirm('Start a new random 30-question test? Current answers will be cleared.');
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

window.addEventListener('beforeunload', (e) => {
  if (!state.submitted && state.answers.some(v => v.trim() !== '')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

init().catch((err) => {
  console.error(err);
  alert('Failed to load questions.json');
});
