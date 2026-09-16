(function () {
  const CARDS = [...SUBJECTS, WELLBEING_CARD];
  const SAVE_DELAY_MS = 700;

  const els = {
    loginScreen: document.getElementById('login-screen'),
    surveyScreen: document.getElementById('survey-screen'),
    isuInput: document.getElementById('isu-input'),
    codeInput: document.getElementById('code-input'),
    loginBtn: document.getElementById('login-btn'),
    loginError: document.getElementById('login-error'),
    studentName: document.getElementById('student-name'),
    weekLabel: document.getElementById('week-label'),
    adminLink: document.getElementById('admin-link'),
    logoutBtn: document.getElementById('logout-btn'),
    loadMessage: document.getElementById('load-message'),
    retryBtn: document.getElementById('retry-btn'),
    surveyBody: document.getElementById('survey-body'),
    dots: document.getElementById('progress-dots'),
    viewport: document.getElementById('carousel-viewport'),
    track: document.getElementById('carousel-track'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    saveStatus: document.getElementById('save-status'),
    doneMessage: document.getElementById('done-message'),
  };

  let user = null;
  let weekId = null;
  let answers = {}; // { [cardKey]: { [fieldKey]: 0..10, comment } } — только то, что человек реально выставил
  let index = 0;
  let dotEls = [];
  let saveTimer = null;
  let editVersion = 0;
  let savedVersion = 0;
  let loadToken = 0;

  bindLoginForm({ isuInput: els.isuInput, codeInput: els.codeInput, button: els.loginBtn, errorEl: els.loginError });

  onAuthChange((u, isAdmin) => {
    loadToken++;
    clearTimeout(saveTimer);
    user = u;
    weekId = null;
    els.loginScreen.hidden = !!u;
    els.surveyScreen.hidden = !u;
    if (!u) return;
    els.studentName.textContent = u.displayName || u.uid;
    els.adminLink.hidden = !isAdmin;
    loadWeek();
  });

  // --- черновик на устройстве: неотправленные изменения переживают закрытие вкладки ---

  function draftKey(week) {
    return `j3110_draft_${week}_${user.uid}`;
  }

  function readDraft() {
    try {
      return JSON.parse(localStorage.getItem(draftKey(weekId)));
    } catch {
      return null;
    }
  }

  function writeDraft() {
    try {
      localStorage.setItem(draftKey(weekId), JSON.stringify({ answers, editedAt: Date.now() }));
    } catch {}
  }

  function clearDraft() {
    try {
      localStorage.removeItem(draftKey(weekId));
    } catch {}
  }

  // Черновики других недель отправить уже нельзя (или их создал сбитый вперёд часами телефон).
  function pruneOtherDrafts() {
    try {
      const keep = draftKey(weekId);
      Object.keys(localStorage)
        .filter((k) => k.startsWith('j3110_draft_') && k.endsWith(`_${user.uid}`) && k !== keep)
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  }

  // --- данные ---

  function parseCard(card, src) {
    if (!src || typeof src !== 'object') return null;
    const out = {};
    getCardFields(card).forEach((f) => {
      if (isRating(src[f.key])) out[f.key] = src[f.key];
    });
    if (typeof src.comment === 'string' && src.comment.trim()) out.comment = src.comment;
    return Object.keys(out).length ? out : null;
  }

  function normalizeAnswers(getSource) {
    const result = {};
    CARDS.forEach((card) => {
      const parsed = parseCard(card, getSource(card));
      if (parsed) result[card.key] = parsed;
    });
    return result;
  }

  function buildPayload() {
    const payload = {
      isu: user.uid,
      weekId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      subjects: {},
    };
    CARDS.forEach((card) => {
      const parsed = parseCard(card, answers[card.key]);
      if (!parsed) return;
      if (card.isWellbeing) payload.wellbeing = parsed;
      else payload.subjects[card.key] = parsed;
    });
    return payload;
  }

  function cardAnswers(card) {
    if (!answers[card.key]) answers[card.key] = {};
    return answers[card.key];
  }

  function cardProgress(card) {
    const a = answers[card.key] || {};
    const fields = getCardFields(card);
    const set = fields.filter((f) => isRating(a[f.key])).length;
    if (set === 0) return 'empty';
    return set === fields.length ? 'full' : 'partial';
  }

  // Рисуем карточки только после ответа сервера, чтобы загрузка не затёрла то, что человек уже ввёл.
  async function loadWeek() {
    const token = ++loadToken;
    clearTimeout(saveTimer);
    weekId = getSurveyWeekId();
    pruneOtherDrafts();
    answers = {};
    editVersion = 0;
    savedVersion = 0;
    els.weekLabel.textContent = `Анкета про неделю ${formatWeekRange(weekId)} · ответы до ${formatSurveyDeadline(weekId)} включительно`;
    els.surveyBody.hidden = true;
    els.retryBtn.hidden = true;
    els.loadMessage.hidden = false;
    els.loadMessage.textContent = 'Загружаем ваши ответы…';

    let serverData;
    try {
      const snap = await responseRef(weekId, user.uid).get();
      serverData = snap.exists ? snap.data() : null;
    } catch (err) {
      console.error(err);
      if (token !== loadToken) return;
      els.loadMessage.textContent = 'Не удалось загрузить ответы. Проверьте интернет и попробуйте ещё раз.';
      els.retryBtn.hidden = false;
      return;
    }
    if (token !== loadToken) return;

    const serverUpdatedAt = serverData && serverData.updatedAt ? serverData.updatedAt.toMillis() : 0;
    const draft = readDraft();
    if (draft && draft.answers && draft.editedAt > serverUpdatedAt) {
      answers = normalizeAnswers((card) => draft.answers[card.key]);
      editVersion = 1;
    } else {
      answers = serverData
        ? normalizeAnswers((card) => (card.isWellbeing ? serverData.wellbeing : serverData.subjects && serverData.subjects[card.key]))
        : {};
      clearDraft();
    }

    els.loadMessage.hidden = true;
    els.surveyBody.hidden = false;
    setStatus('');
    els.doneMessage.textContent = '';
    renderCards();
    if (editVersion !== savedVersion) flush();
  }

  // --- сохранение ---

  function setStatus(text, ok) {
    els.saveStatus.textContent = text;
    els.saveStatus.classList.toggle('ok', !!ok);
  }

  function markEdited() {
    editVersion++;
    els.doneMessage.textContent = '';
    setStatus('Сохранение…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (!user || !weekId || editVersion === savedVersion) return;
    writeDraft();
    if (getSurveyWeekId() !== weekId) return startNewWeek();

    const version = editVersion;
    const token = loadToken;
    try {
      await responseRef(weekId, user.uid).set(buildPayload());
      if (token !== loadToken) return;
      savedVersion = Math.max(savedVersion, version);
      if (savedVersion === editVersion) {
        clearDraft();
        setStatus('Сохранено ✓', true);
      }
    } catch (err) {
      console.error(err);
      if (token !== loadToken) return;
      setStatus(
        err.code === 'permission-denied'
          ? 'Не удалось сохранить: проверьте дату и время на устройстве и обновите страницу.'
          : 'Не удалось сохранить — ответы остались на этом устройстве, отправим при следующем изменении.'
      );
    }
  }

  async function startNewWeek() {
    const hadUnsaved = editVersion !== savedVersion;
    clearDraft();
    await loadWeek();
    setStatus(
      hadUnsaved
        ? 'Приём ответов про ту неделю закрылся — несохранённые ответы отправить уже нельзя. Открыта анкета про только что прошедшую неделю.'
        : 'Открыта анкета про только что прошедшую неделю.'
    );
  }

  document.addEventListener('visibilitychange', () => {
    if (!user || !weekId) return;
    if (document.visibilityState === 'hidden') flush();
    else if (getSurveyWeekId() !== weekId) startNewWeek();
  });
  window.addEventListener('online', flush);

  // --- отрисовка ---

  function updateDot(i) {
    const state = cardProgress(CARDS[i]);
    dotEls[i].classList.toggle('filled', state === 'full');
    dotEls[i].classList.toggle('partial', state === 'partial');
  }

  function renderField(card, i, f) {
    const block = el('div', 'field-block');
    const row = el('div', 'field-label-row');
    const value = el('span', 'field-value');
    row.append(el('span', null, f.teacher ? `${f.label} — ${f.teacher}` : f.label), value);

    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '10';
    range.step = '1';

    const current = (answers[card.key] || {})[f.key];
    const isSet = isRating(current);
    range.value = isSet ? current : 5;
    value.textContent = isSet ? current : '—';
    block.classList.toggle('unset', !isSet);

    const commit = () => {
      const a = cardAnswers(card);
      const v = Number(range.value);
      if (a[f.key] === v) return;
      a[f.key] = v;
      value.textContent = v;
      block.classList.remove('unset');
      updateDot(i);
      markEdited();
    };
    range.addEventListener('input', commit);
    // Тап по ползунку без сдвига не вызывает input — но это тоже ответ.
    range.addEventListener('click', commit);

    const scale = el('div', 'range-scale');
    scale.append(el('span', null, '0'), el('span', null, '10'));
    block.append(row, range, scale);
    return block;
  }

  function renderCard(card, i) {
    const wrap = el('div', 'survey-card card');
    wrap.appendChild(el('div', 'subject-title', card.name));
    if (!card.isWellbeing) {
      const sub = card.split
        ? `Лекции: ${card.teacherLecture || '—'} · Практика: ${card.teacherPractice || '—'}`
        : card.teacher;
      if (sub) wrap.appendChild(el('div', 'subject-sub', sub));
    }

    getCardFields(card).forEach((f) => wrap.appendChild(renderField(card, i, f)));

    const commentBlock = el('div', 'field-block');
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Если хочется что-то добавить словами…';
    textarea.maxLength = 2000;
    textarea.value = (answers[card.key] && answers[card.key].comment) || '';
    textarea.addEventListener('input', () => {
      cardAnswers(card).comment = textarea.value;
      markEdited();
    });
    commentBlock.append(el('label', null, 'Комментарий (необязательно)'), textarea);
    wrap.appendChild(commentBlock);
    return wrap;
  }

  function renderCards() {
    dotEls = CARDS.map((card, i) => {
      const dot = el('div', 'dot');
      dot.title = card.name;
      dot.addEventListener('click', () => goTo(i));
      return dot;
    });
    els.dots.replaceChildren(...dotEls);
    CARDS.forEach((_, i) => updateDot(i));
    els.track.replaceChildren(...CARDS.map(renderCard));
    goTo(0, false);
  }

  function goTo(i, animate = true) {
    index = Math.max(0, Math.min(CARDS.length - 1, i));
    els.track.style.transition = animate ? '' : 'none';
    els.track.style.transform = `translateX(-${index * 100}%)`;
    if (!animate) {
      void els.track.offsetHeight;
      els.track.style.transition = '';
    }
    dotEls.forEach((dot, j) => dot.classList.toggle('active', j === index));
    els.prevBtn.disabled = index === 0;
    els.nextBtn.textContent = index === CARDS.length - 1 ? 'Готово ✓' : 'Далее →';
  }

  els.prevBtn.addEventListener('click', () => goTo(index - 1));
  els.nextBtn.addEventListener('click', () => {
    if (index < CARDS.length - 1) return goTo(index + 1);
    flush();
    const done = CARDS.filter((card) => cardProgress(card) === 'full').length;
    els.doneMessage.textContent =
      done === CARDS.length
        ? 'Спасибо! Все карточки заполнены.'
        : `Полностью заполнено ${done} из ${CARDS.length} карточек — остальное можно дозаполнить до ${formatSurveyDeadline(weekId)}.`;
  });

  let touchStartX = null;
  els.viewport.addEventListener('touchstart', (e) => {
    // Горизонтальное движение по ползунку — это выбор оценки, а не свайп карточки.
    touchStartX = e.target.closest('input, textarea') ? null : e.touches[0].clientX;
  });
  els.viewport.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) goTo(dx < 0 ? index + 1 : index - 1);
    touchStartX = null;
  });

  els.retryBtn.addEventListener('click', loadWeek);

  els.adminLink.addEventListener('click', () => {
    flush();
    window.location.href = 'admin.html';
  });

  els.logoutBtn.addEventListener('click', async () => {
    // Без сети set() не завершится, пока связь не вернётся — не держим выход дольше пары секунд.
    await Promise.race([flush(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (editVersion !== savedVersion && !confirm('Часть ответов ещё не сохранилась. Всё равно выйти?')) return;
    if (weekId) clearDraft();
    signOutUser();
  });
})();
