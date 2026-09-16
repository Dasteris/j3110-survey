(function () {
  const CARDS = [...SUBJECTS, WELLBEING_CARD];
  const WEEK_ID = getWeekId();

  const els = {
    setupBanner: document.getElementById('setup-banner'),
    loginScreen: document.getElementById('login-screen'),
    surveyScreen: document.getElementById('survey-screen'),
    isuInput: document.getElementById('isu-input'),
    surnameInput: document.getElementById('surname-input'),
    loginBtn: document.getElementById('login-btn'),
    loginError: document.getElementById('login-error'),
    studentName: document.getElementById('student-name'),
    weekLabel: document.getElementById('week-label'),
    adminLink: document.getElementById('admin-link'),
    logoutBtn: document.getElementById('logout-btn'),
    dots: document.getElementById('progress-dots'),
    track: document.getElementById('carousel-track'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    saveStatus: document.getElementById('save-status'),
  };

  let student = null;
  let answers = {}; // { [cardKey]: {...fields, comment, _touched} }
  let index = 0;
  let saveTimer = null;

  if (!FIREBASE_CONFIGURED) els.setupBanner.hidden = false;

  function getCardFields(card) {
    if (card.isWellbeing) return card.fields;
    if (card.split) {
      return [
        { key: 'difficulty', label: 'Сложность материала' },
        { key: 'lecture', label: 'Качество лекций' + (card.teacherLecture ? ` — ${card.teacherLecture}` : '') },
        { key: 'practice', label: 'Качество практики/лаб' + (card.teacherPractice ? ` — ${card.teacherPractice}` : '') },
        { key: 'understanding', label: 'Личное понимание материала' },
      ];
    }
    return [
      { key: 'difficulty', label: 'Сложность материала' },
      { key: 'teacher', label: 'Работа преподавателя' + (card.teacher ? ` — ${card.teacher}` : '') },
      { key: 'understanding', label: 'Личное понимание материала' },
    ];
  }

  function localKey() {
    return `j3110_answers_${WEEK_ID}_${student.isu}`;
  }

  function loadLocalCache() {
    try {
      const raw = localStorage.getItem(localKey());
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveLocalCache() {
    try {
      localStorage.setItem(localKey(), JSON.stringify(answers));
    } catch {}
  }

  function ensureCardAnswers(key) {
    if (!answers[key]) answers[key] = {};
    return answers[key];
  }

  function isCardFilled(card) {
    const a = answers[card.key];
    return !!(a && a._touched);
  }

  function renderDots() {
    els.dots.innerHTML = '';
    CARDS.forEach((card, i) => {
      const dot = document.createElement('div');
      dot.className = 'dot' + (i === index ? ' active' : '') + (isCardFilled(card) ? ' filled' : '');
      dot.title = card.name;
      dot.addEventListener('click', () => goTo(i));
      els.dots.appendChild(dot);
    });
  }

  function renderCard(card) {
    const wrap = document.createElement('div');
    wrap.className = 'survey-card card';

    const title = document.createElement('div');
    title.className = 'subject-title';
    title.textContent = card.name;
    wrap.appendChild(title);

    if (!card.isWellbeing) {
      const sub = document.createElement('div');
      sub.className = 'subject-sub';
      sub.textContent = card.split
        ? `Лекции: ${card.teacherLecture || '—'} · Практика: ${card.teacherPractice || '—'}`
        : card.teacher || '';
      wrap.appendChild(sub);
    }

    const fields = getCardFields(card);
    const a = ensureCardAnswers(card.key);

    fields.forEach((f) => {
      const block = document.createElement('div');
      block.className = 'field-block';

      const row = document.createElement('div');
      row.className = 'field-label-row';
      const lbl = document.createElement('span');
      lbl.textContent = f.label;
      const val = document.createElement('span');
      val.className = 'field-value';
      const current = a[f.key] !== undefined ? a[f.key] : 5;
      val.textContent = current;
      row.appendChild(lbl);
      row.appendChild(val);
      block.appendChild(row);

      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '10';
      range.step = '1';
      range.value = current;
      range.addEventListener('input', () => {
        val.textContent = range.value;
        a[f.key] = Number(range.value);
        a._touched = true;
        renderDots();
        scheduleSave();
      });
      block.appendChild(range);

      const scale = document.createElement('div');
      scale.className = 'range-scale';
      scale.innerHTML = '<span>0</span><span>10</span>';
      block.appendChild(scale);

      wrap.appendChild(block);
    });

    const commentBlock = document.createElement('div');
    commentBlock.className = 'field-block';
    const commentLbl = document.createElement('label');
    commentLbl.textContent = 'Комментарий (необязательно)';
    commentLbl.style.marginTop = '0';
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Если хочется что-то добавить словами…';
    textarea.value = a.comment || '';
    textarea.addEventListener('input', () => {
      a.comment = textarea.value;
      if (textarea.value.trim()) a._touched = true;
      scheduleSave();
    });
    commentBlock.appendChild(commentLbl);
    commentBlock.appendChild(textarea);
    wrap.appendChild(commentBlock);

    return wrap;
  }

  function renderTrack() {
    els.track.innerHTML = '';
    CARDS.forEach((card) => els.track.appendChild(renderCard(card)));
    updateTrackPosition(false);
  }

  function updateTrackPosition(animate) {
    els.track.style.transition = animate === false ? 'none' : '';
    els.track.style.transform = `translateX(-${index * 100}%)`;
    if (animate === false) {
      // force reflow then restore transition
      void els.track.offsetHeight;
      els.track.style.transition = '';
    }
    els.prevBtn.disabled = index === 0;
    els.nextBtn.textContent = index === CARDS.length - 1 ? 'Готово ✓' : 'Далее →';
  }

  function goTo(i) {
    index = Math.max(0, Math.min(CARDS.length - 1, i));
    updateTrackPosition(true);
    renderDots();
  }

  els.prevBtn.addEventListener('click', () => goTo(index - 1));
  els.nextBtn.addEventListener('click', () => {
    if (index === CARDS.length - 1) {
      els.saveStatus.textContent = 'Спасибо! Ответы сохраняются автоматически, можно закрывать.';
      els.saveStatus.className = 'save-status ok';
      return;
    }
    goTo(index + 1);
  });

  // touch swipe
  let touchStartX = null;
  const viewport = document.querySelector('.carousel-viewport');
  viewport.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  });
  viewport.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) {
      if (dx < 0) goTo(index + 1);
      else goTo(index - 1);
    }
    touchStartX = null;
  });

  function scheduleSave() {
    saveLocalCache();
    els.saveStatus.textContent = 'Сохранение…';
    els.saveStatus.className = 'save-status';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 700);
  }

  async function doSave() {
    if (!FIREBASE_CONFIGURED) {
      els.saveStatus.textContent = 'Сохранено локально (Firebase не настроен)';
      els.saveStatus.className = 'save-status';
      return;
    }
    try {
      await fbReady();
      const db = initFirebase();
      const payload = { isu: student.isu, name: student.name, weekId: WEEK_ID, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      CARDS.forEach((card) => {
        const a = answers[card.key];
        if (!a || !a._touched) return;
        const clean = { ...a };
        delete clean._touched;
        if (card.isWellbeing) payload.wellbeing = clean;
        else {
          payload.subjects = payload.subjects || {};
          payload.subjects[card.key] = clean;
        }
      });
      await db.collection('weeks').doc(WEEK_ID).collection('responses').doc(student.isu).set(payload, { merge: true });
      els.saveStatus.textContent = 'Сохранено ✓';
      els.saveStatus.className = 'save-status ok';
    } catch (err) {
      console.error(err);
      els.saveStatus.textContent = 'Не удалось сохранить, проверьте интернет';
      els.saveStatus.className = 'save-status';
    }
  }

  async function loadFromFirestore() {
    if (!FIREBASE_CONFIGURED) return;
    try {
      await fbReady();
      const db = initFirebase();
      const snap = await db.collection('weeks').doc(WEEK_ID).collection('responses').doc(student.isu).get();
      if (snap.exists) {
        const data = snap.data();
        CARDS.forEach((card) => {
          const src = card.isWellbeing ? data.wellbeing : data.subjects && data.subjects[card.key];
          if (src) answers[card.key] = { ...src, _touched: true };
        });
        renderTrack();
        renderDots();
      }
    } catch (err) {
      console.error('load failed', err);
    }
  }

  function startSurvey() {
    els.loginScreen.hidden = true;
    els.surveyScreen.hidden = false;
    els.studentName.textContent = student.name;
    els.weekLabel.textContent = formatWeekLabel(WEEK_ID);
    els.adminLink.hidden = !student.admin;
    answers = loadLocalCache();
    renderTrack();
    renderDots();
    loadFromFirestore();
  }

  els.adminLink.addEventListener('click', () => {
    window.location.href = 'admin.html';
  });

  els.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('j3110_student');
    location.reload();
  });

  els.loginBtn.addEventListener('click', doLogin);
  els.surnameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  async function doLogin() {
    if (!FIREBASE_CONFIGURED) {
      els.loginError.textContent = 'Firebase не настроен, вход недоступен.';
      return;
    }
    els.loginBtn.disabled = true;
    els.loginError.textContent = '';
    try {
      const found = await findStudent(els.isuInput.value, els.surnameInput.value);
      if (!found) {
        els.loginError.textContent = 'Не нашли такого человека в списке группы. Проверьте ИСУ и фамилию.';
        return;
      }
      student = found;
      localStorage.setItem('j3110_student', JSON.stringify(student));
      startSurvey();
    } catch (err) {
      console.error(err);
      els.loginError.textContent = 'Не удалось проверить список группы, проверьте интернет и попробуйте снова.';
    } finally {
      els.loginBtn.disabled = false;
    }
  }

  // auto-login from previous session (trusts local cache, no re-check against roster)
  try {
    const cached = JSON.parse(localStorage.getItem('j3110_student') || 'null');
    if (cached && cached.isu && cached.name) {
      student = cached;
      startSurvey();
    }
  } catch {}
})();
