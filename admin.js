(function () {
  const COLORS = ['#4f6df5', '#16a34a', '#f59e0b', '#e5484d', '#8b5cf6', '#06b6d4'];

  const els = {
    gateWrap: document.getElementById('gate-wrap'),
    gateScreen: document.getElementById('gate-screen'),
    deniedScreen: document.getElementById('denied-screen'),
    deniedText: document.getElementById('denied-text'),
    deniedLogout: document.getElementById('denied-logout'),
    dashWrap: document.getElementById('dash-wrap'),
    dashMessage: document.getElementById('dash-message'),
    dashLogout: document.getElementById('dash-logout'),
    weekSelect: document.getElementById('week-select'),
    statResponded: document.getElementById('stat-responded'),
    missingList: document.getElementById('missing-list'),
    barCanvas: document.getElementById('chart-bar'),
    trendCanvas: document.getElementById('chart-trend'),
    subjectTableBody: document.querySelector('#subject-table tbody'),
    detailTabs: document.getElementById('detail-tabs'),
    detailSelect: document.getElementById('detail-select'),
    detailStats: document.getElementById('detail-stats'),
    detailCanvas: document.getElementById('chart-detail'),
    detailComments: document.getElementById('detail-comments'),
    commentsList: document.getElementById('comments-list'),
    profileSelect: document.getElementById('profile-select'),
    profileDetail: document.getElementById('profile-detail'),
  };

  const TEACHERS = getTeachers();
  const DIMENSIONS = [
    { key: 'difficulty', label: 'Сложность' },
    { key: 'teacher', label: 'Работа преподавателя' },
    { key: 'understanding', label: 'Понимание материала' },
    ...WELLBEING_CARD.fields.map((f) => ({ key: f.key, label: f.label })),
  ];

  let roster = [];
  let nameByIsu = new Map();
  let docsByWeek = new Map(); // weekId -> [{ isu, subjects, wellbeing }]
  let averagesByWeek = new Map(); // weekId -> { [dimensionKey]: number | null }
  let weekIds = [];
  let currentWeek = getSurveyWeekId();
  let detailMode = 'subject';
  let dataLoaded = false;
  const charts = {};

  // --- доступ: права старосты проверяют firestore.rules по custom claim, здесь только UI ---

  bindLoginForm({
    isuInput: document.getElementById('g-isu'),
    codeInput: document.getElementById('g-code'),
    button: document.getElementById('gate-btn'),
    errorEl: document.getElementById('gate-error'),
  });

  onAuthChange((user, isAdmin) => {
    els.gateWrap.hidden = !!(user && isAdmin);
    els.gateScreen.hidden = !!user;
    els.deniedScreen.hidden = !user || isAdmin;
    els.dashWrap.hidden = !(user && isAdmin);
    if (user && !isAdmin) {
      els.deniedText.textContent = `Вы вошли как ${user.displayName || user.uid}. Дашборд доступен только старосте.`;
    }
    if (user && isAdmin && !dataLoaded) loadAllData();
  });

  els.dashLogout.addEventListener('click', signOutUser);
  els.deniedLogout.addEventListener('click', signOutUser);

  // --- расчёты ---

  function avg(values) {
    const nums = values.filter((v) => typeof v === 'number');
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  function fmt(v) {
    return v === null ? '—' : v.toFixed(1);
  }

  function nameOf(isu) {
    return nameByIsu.get(isu) || `ИСУ ${isu}`;
  }

  function shortName(name) {
    const [last, first] = name.split(' ');
    return first ? `${last} ${first[0]}.` : last;
  }

  function docsForWeek(week) {
    return docsByWeek.get(week) || [];
  }

  // Сводные оценки одного предмета в одном ответе; «преподаватель» = среднее по полям с ролью (лекции/практика/занятия).
  function subjectScores(entry, subject) {
    const pick = (key) => (isRating(entry[key]) ? entry[key] : null);
    const teacherFields = getCardFields(subject).filter((f) => f.role);
    return {
      difficulty: pick('difficulty'),
      teacher: avg(teacherFields.map((f) => pick(f.key))),
      understanding: pick('understanding'),
    };
  }

  function studentDimensions(doc) {
    const perSubject = SUBJECTS.filter((s) => doc.subjects && doc.subjects[s.key]).map((s) =>
      subjectScores(doc.subjects[s.key], s)
    );
    const result = {
      difficulty: avg(perSubject.map((s) => s.difficulty)),
      teacher: avg(perSubject.map((s) => s.teacher)),
      understanding: avg(perSubject.map((s) => s.understanding)),
    };
    WELLBEING_CARD.fields.forEach((f) => {
      const v = doc.wellbeing && doc.wellbeing[f.key];
      result[f.key] = isRating(v) ? v : null;
    });
    return result;
  }

  function computeWeekAverages(week) {
    const perStudent = docsForWeek(week).map(studentDimensions);
    const result = {};
    DIMENSIONS.forEach((d) => (result[d.key] = avg(perStudent.map((s) => s[d.key]))));
    return result;
  }

  async function loadAllData() {
    dataLoaded = true;
    els.dashMessage.hidden = false;
    els.dashMessage.textContent = 'Загрузка…';
    try {
      const [rosterList, snap] = await Promise.all([loadRoster(), getDb().collectionGroup('responses').get()]);
      roster = rosterList.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      nameByIsu = new Map(roster.map((s) => [s.isu, s.name]));
      docsByWeek = new Map();
      snap.docs.forEach((d) => {
        const weekDoc = d.ref.parent.parent;
        if (!weekDoc || weekDoc.parent.id !== 'weeks') return;
        const data = d.data();
        if (!docsByWeek.has(weekDoc.id)) docsByWeek.set(weekDoc.id, []);
        docsByWeek.get(weekDoc.id).push({ isu: d.id, subjects: data.subjects, wellbeing: data.wellbeing });
      });
    } catch (err) {
      console.error(err);
      dataLoaded = false;
      els.dashMessage.textContent = 'Не удалось загрузить данные. Обновите страницу.';
      return;
    }
    els.dashMessage.hidden = true;

    currentWeek = getSurveyWeekId();
    weekIds = [...new Set([...docsByWeek.keys(), currentWeek])].sort().reverse();
    averagesByWeek = new Map(weekIds.map((w) => [w, computeWeekAverages(w)]));

    populateSelect(
      els.weekSelect,
      weekIds.map((w) => [w, formatWeekLabel(w) + (w === currentWeek ? ' (идёт опрос)' : '')])
    );
    els.weekSelect.value = currentWeek;
    populateSelect(els.profileSelect, roster.map((s) => [s.isu, s.name]));
    populateDetailSelect();

    renderTrendChart();
    renderDetailChart();
    renderWeek();
  }

  // --- отрисовка (всё, что пришло из базы, — только через textContent) ---

  function populateSelect(select, items) {
    select.replaceChildren(
      ...items.map(([value, label]) => {
        const opt = el('option', null, label);
        opt.value = value;
        return opt;
      })
    );
  }

  function lineChart(key, canvas, labels, datasets) {
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map((ds, i) => ({
          ...ds,
          borderColor: COLORS[i % COLORS.length],
          backgroundColor: COLORS[i % COLORS.length],
          spanGaps: true,
          tension: 0.25,
        })),
      },
      options: { scales: { y: { min: 0, max: 10 } } },
    });
  }

  function commentItem(meta, text) {
    const item = el('div', 'comment-item');
    item.append(el('div', 'comment-meta', meta), el('div', null, text));
    return item;
  }

  function hasComment(entry) {
    return entry && typeof entry.comment === 'string' && entry.comment.trim();
  }

  function renderCompletion() {
    const responded = new Set(docsForWeek(currentWeek).map((d) => d.isu));
    els.statResponded.textContent = `${roster.filter((s) => responded.has(s.isu)).length}/${roster.length}`;
    els.missingList.replaceChildren(
      ...roster.map((s) => el('span', responded.has(s.isu) ? 'chip' : 'chip missing', shortName(s.name)))
    );
  }

  function renderBarChart() {
    const data = averagesByWeek.get(currentWeek);
    if (charts.bar) charts.bar.destroy();
    charts.bar = new Chart(els.barCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: DIMENSIONS.map((d) => d.label),
        datasets: [
          {
            data: DIMENSIONS.map((d) => (data[d.key] === null ? null : Number(data[d.key].toFixed(2)))),
            backgroundColor: COLORS,
            borderRadius: 6,
          },
        ],
      },
      options: { scales: { y: { min: 0, max: 10 } }, plugins: { legend: { display: false } } },
    });
  }

  function renderTrendChart() {
    const weeksAsc = [...weekIds].reverse();
    lineChart(
      'trend',
      els.trendCanvas,
      weeksAsc.map(formatWeekLabel),
      DIMENSIONS.map((d) => ({
        label: d.label,
        data: weeksAsc.map((w) => {
          const v = averagesByWeek.get(w)[d.key];
          return v === null ? null : Number(v.toFixed(2));
        }),
      }))
    );
  }

  function renderSubjectTable() {
    const docs = docsForWeek(currentWeek);
    els.subjectTableBody.replaceChildren(
      ...SUBJECTS.map((s) => {
        const scores = docs.filter((d) => d.subjects && d.subjects[s.key]).map((d) => subjectScores(d.subjects[s.key], s));
        const tr = el('tr');
        tr.append(
          el('td', null, s.name),
          el('td', null, String(scores.length)),
          el('td', null, fmt(avg(scores.map((x) => x.difficulty)))),
          el('td', null, fmt(avg(scores.map((x) => x.teacher)))),
          el('td', null, fmt(avg(scores.map((x) => x.understanding))))
        );
        return tr;
      })
    );
  }

  function renderComments() {
    const items = [];
    docsForWeek(currentWeek).forEach((doc) => {
      SUBJECTS.forEach((s) => {
        const entry = doc.subjects && doc.subjects[s.key];
        if (hasComment(entry)) items.push(commentItem(`${nameOf(doc.isu)} · ${s.name}`, entry.comment));
      });
      if (hasComment(doc.wellbeing)) items.push(commentItem(`${nameOf(doc.isu)} · Самочувствие`, doc.wellbeing.comment));
    });
    els.commentsList.replaceChildren(...(items.length ? items : [el('p', null, 'Комментариев пока нет.')]));
  }

  function profileItem(card, entry) {
    const values = getCardFields(card)
      .map((f) => `${f.label}${f.teacher ? ` (${f.teacher})` : ''}: ${isRating(entry[f.key]) ? entry[f.key] : '—'}`)
      .join(' · ');
    const item = commentItem(card.name, values);
    if (hasComment(entry)) item.appendChild(el('div', 'profile-comment', `«${entry.comment}»`));
    return item;
  }

  function renderProfile() {
    const doc = docsForWeek(currentWeek).find((d) => d.isu === els.profileSelect.value);
    const items = [];
    if (doc) {
      SUBJECTS.forEach((s) => {
        if (doc.subjects && doc.subjects[s.key]) items.push(profileItem(s, doc.subjects[s.key]));
      });
      if (doc.wellbeing) items.push(profileItem(WELLBEING_CARD, doc.wellbeing));
    }
    els.profileDetail.replaceChildren(...(items.length ? items : [el('p', null, 'Нет ответа за эту неделю.')]));
  }

  // --- по предмету / по преподавателю ---

  function populateDetailSelect() {
    populateSelect(
      els.detailSelect,
      detailMode === 'subject' ? SUBJECTS.map((s) => [s.key, s.name]) : TEACHERS.map((t) => [t.name, t.name])
    );
  }

  // Метрика = подпись + набор (предмет, поле), значения которых усредняются вместе.
  function detailMetrics() {
    const value = els.detailSelect.value;
    if (detailMode === 'subject') {
      const subject = SUBJECTS.find((s) => s.key === value);
      return {
        subjectKeys: [subject.key],
        metrics: getCardFields(subject).map((f) => ({
          label: f.teacher ? `${f.label} (${f.teacher})` : f.label,
          sources: [{ subjectKey: subject.key, fieldKey: f.key }],
        })),
      };
    }
    const teacher = TEACHERS.find((t) => t.name === value);
    const subjectKeys = [...new Set(teacher.roles.map((r) => r.subject.key))];
    const roleMetrics = teacher.roles.map((r) => ({
      label: `${r.subject.name} — ${r.field.role}`,
      sources: [{ subjectKey: r.subject.key, fieldKey: r.field.key }],
    }));
    return {
      subjectKeys,
      metrics: [
        ...(roleMetrics.length > 1
          ? [{ label: 'Общая оценка работы', sources: roleMetrics.flatMap((m) => m.sources) }]
          : []),
        ...roleMetrics,
        {
          label: 'Понимание материала по его предметам',
          sources: subjectKeys.map((k) => ({ subjectKey: k, fieldKey: 'understanding' })),
        },
      ],
    };
  }

  function metricValues(metric, week) {
    const vals = [];
    docsForWeek(week).forEach((doc) => {
      metric.sources.forEach(({ subjectKey, fieldKey }) => {
        const entry = doc.subjects && doc.subjects[subjectKey];
        if (entry && isRating(entry[fieldKey])) vals.push(entry[fieldKey]);
      });
    });
    return vals;
  }

  function renderDetailWeek() {
    const { metrics, subjectKeys } = detailMetrics();
    els.detailStats.replaceChildren(
      ...metrics.map((m) => {
        const vals = metricValues(m, currentWeek);
        const tile = el('div', 'stat');
        tile.append(el('div', 'num', fmt(avg(vals))), el('div', 'lbl', `${m.label} · оценок: ${vals.length}`));
        return tile;
      })
    );

    const items = [];
    docsForWeek(currentWeek).forEach((doc) => {
      subjectKeys.forEach((key) => {
        const entry = doc.subjects && doc.subjects[key];
        if (!hasComment(entry)) return;
        const subject = SUBJECTS.find((s) => s.key === key);
        items.push(commentItem(`${nameOf(doc.isu)} · ${subject.name}`, entry.comment));
      });
    });
    els.detailComments.replaceChildren(...(items.length ? items : [el('p', null, 'Комментариев нет.')]));
  }

  function renderDetailChart() {
    const { metrics } = detailMetrics();
    const weeksAsc = [...weekIds].reverse();
    lineChart(
      'detail',
      els.detailCanvas,
      weeksAsc.map(formatWeekLabel),
      metrics.map((m) => ({
        label: m.label,
        data: weeksAsc.map((w) => {
          const v = avg(metricValues(m, w));
          return v === null ? null : Number(v.toFixed(2));
        }),
      }))
    );
  }

  function renderWeek() {
    renderCompletion();
    renderBarChart();
    renderSubjectTable();
    renderDetailWeek();
    renderComments();
    renderProfile();
  }

  els.weekSelect.addEventListener('change', () => {
    currentWeek = els.weekSelect.value;
    renderWeek();
  });
  els.profileSelect.addEventListener('change', renderProfile);
  els.detailSelect.addEventListener('change', () => {
    renderDetailWeek();
    renderDetailChart();
  });
  els.detailTabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      detailMode = btn.dataset.mode;
      els.detailTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      populateDetailSelect();
      renderDetailWeek();
      renderDetailChart();
    });
  });
})();
