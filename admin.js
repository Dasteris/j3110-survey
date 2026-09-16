(function () {
  const ADMIN_PASSWORD = 'adminadmin5252';
  const COLORS = ['#4f6df5', '#16a34a', '#f59e0b', '#e5484d', '#8b5cf6', '#06b6d4'];

  const els = {
    gateWrap: document.getElementById('gate-wrap'),
    dashWrap: document.getElementById('dash-wrap'),
    dashBanner: document.getElementById('dash-banner'),
    gIsu: document.getElementById('g-isu'),
    gSurname: document.getElementById('g-surname'),
    gPass: document.getElementById('g-pass'),
    gateBtn: document.getElementById('gate-btn'),
    gateError: document.getElementById('gate-error'),
    weekSelect: document.getElementById('week-select'),
    statResponded: document.getElementById('stat-responded'),
    missingList: document.getElementById('missing-list'),
    subjectTableBody: document.querySelector('#subject-table tbody'),
    commentsList: document.getElementById('comments-list'),
    profileSelect: document.getElementById('profile-select'),
    profileDetail: document.getElementById('profile-detail'),
    dashLogout: document.getElementById('dash-logout'),
    detailTabs: document.getElementById('detail-tabs'),
    detailSelect: document.getElementById('detail-select'),
    detailStats: document.getElementById('detail-stats'),
    detailChart: document.getElementById('chart-detail'),
    detailComments: document.getElementById('detail-comments'),
  };

  const TEACHERS = getTeachers();
  let detailMode = 'subject';
  let detailChart = null;

  let allDocs = []; // flat list of every saved response across every week
  let weekIds = [];
  let currentWeek = null;
  let barChart = null;
  let trendChart = null;
  let ROSTER = [];

  async function checkGate() {
    if (!FIREBASE_CONFIGURED) {
      els.gateError.textContent = 'Firebase не настроен.';
      return;
    }
    els.gateBtn.disabled = true;
    try {
      const found = await findStudent(els.gIsu.value, els.gSurname.value);
      if (!found || !found.admin) {
        els.gateError.textContent = 'Доступ только для старосты.';
        return;
      }
      if (els.gPass.value !== ADMIN_PASSWORD) {
        els.gateError.textContent = 'Неверный пароль.';
        return;
      }
      els.gateError.textContent = '';
      sessionStorage.setItem('j3110_admin_ok', '1');
      showDashboard();
    } catch (err) {
      console.error(err);
      els.gateError.textContent = 'Ошибка проверки, попробуйте снова.';
    } finally {
      els.gateBtn.disabled = false;
    }
  }
  els.gateBtn.addEventListener('click', checkGate);
  els.gPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkGate(); });

  els.dashLogout.addEventListener('click', () => {
    sessionStorage.removeItem('j3110_admin_ok');
    location.reload();
  });

  function getCombinedTeacherScore(entry, subjectDef) {
    if (!entry) return null;
    if (subjectDef.split) {
      const vals = [entry.lecture, entry.practice].filter((v) => typeof v === 'number');
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return typeof entry.teacher === 'number' ? entry.teacher : null;
  }

  function avg(arr) {
    const vals = arr.filter((v) => typeof v === 'number' && !isNaN(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function computeStudentDimensions(doc) {
    const diffs = [], teachers = [], understandings = [];
    SUBJECTS.forEach((s) => {
      const entry = doc.subjects && doc.subjects[s.key];
      if (!entry) return;
      if (typeof entry.difficulty === 'number') diffs.push(entry.difficulty);
      if (typeof entry.understanding === 'number') understandings.push(entry.understanding);
      const t = getCombinedTeacherScore(entry, s);
      if (t !== null) teachers.push(t);
    });
    const w = doc.wellbeing || {};
    return {
      difficulty: avg(diffs),
      teacher: avg(teachers),
      understanding: avg(understandings),
      freeTime: typeof w.freeTime === 'number' ? w.freeTime : null,
      mood: typeof w.mood === 'number' ? w.mood : null,
      atmosphere: typeof w.atmosphere === 'number' ? w.atmosphere : null,
    };
  }

  async function loadAllData() {
    if (!FIREBASE_CONFIGURED) {
      els.dashBanner.hidden = false;
    } else {
      await fbReady();
      const db = initFirebase();
      ROSTER = await loadRoster();
      const snap = await db.collectionGroup('responses').get();
      allDocs = snap.docs.map((d) => d.data());
    }
    weekIds = [...new Set(allDocs.map((d) => d.weekId))].sort().reverse();
    if (!weekIds.length) weekIds = [getWeekId()];
    currentWeek = weekIds[0];
    populateWeekSelect();
    populateProfileSelect();
    populateDetailSelect();
    renderAll();
  }

  function populateWeekSelect() {
    els.weekSelect.innerHTML = '';
    weekIds.forEach((w) => {
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = formatWeekLabel(w) + (w === getWeekId() ? ' (текущая)' : '');
      els.weekSelect.appendChild(opt);
    });
    els.weekSelect.value = currentWeek;
    els.weekSelect.addEventListener('change', () => {
      currentWeek = els.weekSelect.value;
      renderAll();
    });
  }

  function populateProfileSelect() {
    els.profileSelect.innerHTML = '';
    ROSTER.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.isu;
      opt.textContent = s.name;
      els.profileSelect.appendChild(opt);
    });
    els.profileSelect.addEventListener('change', renderProfile);
  }

  function docsForWeek(week) {
    return allDocs.filter((d) => d.weekId === week);
  }

  function renderCompletion() {
    const docs = docsForWeek(currentWeek);
    const respondedIsus = new Set(docs.map((d) => d.isu));
    els.statResponded.textContent = `${respondedIsus.size}/${ROSTER.length}`;
    els.missingList.innerHTML = '';
    ROSTER.forEach((s) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (respondedIsus.has(s.isu) ? '' : ' missing');
      chip.textContent = s.name.split(' ')[0] + ' ' + s.name.split(' ')[1][0] + '.';
      els.missingList.appendChild(chip);
    });
  }

  const DIMENSIONS = [
    { key: 'difficulty', label: 'Сложность' },
    { key: 'teacher', label: 'Работа преподавателя' },
    { key: 'understanding', label: 'Понимание материала' },
    { key: 'freeTime', label: 'Свободное время' },
    { key: 'mood', label: 'Самочувствие' },
    { key: 'atmosphere', label: 'Атмосфера в группе' },
  ];

  function weekAverages(week) {
    const docs = docsForWeek(week);
    const perDim = {};
    DIMENSIONS.forEach((d) => (perDim[d.key] = []));
    docs.forEach((doc) => {
      const dims = computeStudentDimensions(doc);
      DIMENSIONS.forEach((d) => {
        if (typeof dims[d.key] === 'number') perDim[d.key].push(dims[d.key]);
      });
    });
    const result = {};
    DIMENSIONS.forEach((d) => (result[d.key] = avg(perDim[d.key])));
    return result;
  }

  function renderBarChart() {
    const data = weekAverages(currentWeek);
    const ctx = document.getElementById('chart-bar').getContext('2d');
    const values = DIMENSIONS.map((d) => (data[d.key] !== null ? Number(data[d.key].toFixed(2)) : 0));
    if (barChart) barChart.destroy();
    barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: DIMENSIONS.map((d) => d.label),
        datasets: [{ data: values, backgroundColor: COLORS, borderRadius: 6 }],
      },
      options: {
        scales: { y: { min: 0, max: 10 } },
        plugins: { legend: { display: false } },
      },
    });
  }

  function renderTrendChart() {
    const weeksAsc = [...weekIds].reverse();
    const ctx = document.getElementById('chart-trend').getContext('2d');
    const datasets = DIMENSIONS.map((d, i) => ({
      label: d.label,
      data: weeksAsc.map((w) => {
        const a = weekAverages(w)[d.key];
        return a !== null ? Number(a.toFixed(2)) : null;
      }),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length],
      spanGaps: true,
      tension: 0.25,
    }));
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: 'line',
      data: { labels: weeksAsc.map(formatWeekLabel), datasets },
      options: { scales: { y: { min: 0, max: 10 } } },
    });
  }

  function renderSubjectTable() {
    const docs = docsForWeek(currentWeek);
    els.subjectTableBody.innerHTML = '';
    SUBJECTS.forEach((s) => {
      const diffs = [], teachers = [], understandings = [];
      docs.forEach((doc) => {
        const entry = doc.subjects && doc.subjects[s.key];
        if (!entry) return;
        if (typeof entry.difficulty === 'number') diffs.push(entry.difficulty);
        if (typeof entry.understanding === 'number') understandings.push(entry.understanding);
        const t = getCombinedTeacherScore(entry, s);
        if (t !== null) teachers.push(t);
      });
      const n = docs.filter((d) => d.subjects && d.subjects[s.key]).length;
      const tr = document.createElement('tr');
      const fmt = (v) => (v === null ? '—' : v.toFixed(1));
      tr.innerHTML = `<td>${s.name}</td><td>${n}</td><td>${fmt(avg(diffs))}</td><td>${fmt(avg(teachers))}</td><td>${fmt(avg(understandings))}</td>`;
      els.subjectTableBody.appendChild(tr);
    });
  }

  function renderComments() {
    const docs = docsForWeek(currentWeek);
    els.commentsList.innerHTML = '';
    let any = false;
    docs.forEach((doc) => {
      const items = [];
      if (doc.subjects) {
        Object.entries(doc.subjects).forEach(([key, entry]) => {
          if (entry.comment && entry.comment.trim()) {
            const s = SUBJECTS.find((x) => x.key === key);
            items.push({ subject: s ? s.name : key, text: entry.comment });
          }
        });
      }
      if (doc.wellbeing && doc.wellbeing.comment && doc.wellbeing.comment.trim()) {
        items.push({ subject: 'Самочувствие', text: doc.wellbeing.comment });
      }
      items.forEach((it) => {
        any = true;
        const div = document.createElement('div');
        div.className = 'comment-item';
        div.innerHTML = `<div class="comment-meta">${doc.name} · ${it.subject}</div><div>${escapeHtml(it.text)}</div>`;
        els.commentsList.appendChild(div);
      });
    });
    if (!any) els.commentsList.innerHTML = '<p>Комментариев пока нет.</p>';
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderProfile() {
    const isu = els.profileSelect.value;
    const doc = docsForWeek(currentWeek).find((d) => d.isu === isu);
    if (!doc) {
      els.profileDetail.innerHTML = '<p>Нет ответа за эту неделю.</p>';
      return;
    }
    let html = '';
    SUBJECTS.forEach((s) => {
      const e = doc.subjects && doc.subjects[s.key];
      if (!e) return;
      const rows = s.split
        ? `Сложность: ${e.difficulty ?? '—'} · Лекции: ${e.lecture ?? '—'} · Практика: ${e.practice ?? '—'} · Понимание: ${e.understanding ?? '—'}`
        : `Сложность: ${e.difficulty ?? '—'} · Преподаватель: ${e.teacher ?? '—'} · Понимание: ${e.understanding ?? '—'}`;
      html += `<div class="comment-item"><div class="comment-meta">${s.name}</div><div>${rows}</div>${e.comment ? `<div style="margin-top:4px;color:var(--muted);">«${escapeHtml(e.comment)}»</div>` : ''}</div>`;
    });
    if (doc.wellbeing) {
      const w = doc.wellbeing;
      html += `<div class="comment-item"><div class="comment-meta">Самочувствие</div><div>Свободное время: ${w.freeTime ?? '—'} · Самочувствие: ${w.mood ?? '—'} · Атмосфера: ${w.atmosphere ?? '—'}</div>${w.comment ? `<div style="margin-top:4px;color:var(--muted);">«${escapeHtml(w.comment)}»</div>` : ''}</div>`;
    }
    els.profileDetail.innerHTML = html || '<p>Нет данных.</p>';
  }

  function populateDetailSelect() {
    const items =
      detailMode === 'subject' ? SUBJECTS.map((s) => [s.key, s.name]) : TEACHERS.map((t) => [t.name, t.name]);
    els.detailSelect.innerHTML = '';
    items.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      els.detailSelect.appendChild(opt);
    });
  }

  // Метрика = подпись + набор (предмет, поле), значения которых усредняются вместе.
  function detailMetricDefs() {
    const value = els.detailSelect.value;
    if (detailMode === 'subject') {
      const subject = SUBJECTS.find((s) => s.key === value);
      if (!subject) return { metrics: [], subjectKeys: [] };
      return {
        subjectKeys: [subject.key],
        metrics: getCardFields(subject).map((f) => ({
          label: f.teacher ? `${f.label} (${f.teacher})` : f.label,
          sources: [{ subjectKey: subject.key, fieldKey: f.key }],
        })),
      };
    }
    const teacher = TEACHERS.find((t) => t.name === value);
    if (!teacher) return { metrics: [], subjectKeys: [] };
    const subjectKeys = [...new Set(teacher.roles.map((r) => r.subject.key))];
    const roleMetrics = teacher.roles.map((r) => ({
      label: `${r.subject.name} — ${r.field.role}`,
      sources: [{ subjectKey: r.subject.key, fieldKey: r.field.key }],
    }));
    const metrics = [];
    if (roleMetrics.length > 1) {
      metrics.push({ label: 'Общая оценка работы', sources: roleMetrics.flatMap((m) => m.sources) });
    }
    metrics.push(...roleMetrics);
    metrics.push({
      label: 'Понимание материала по его предметам',
      sources: subjectKeys.map((k) => ({ subjectKey: k, fieldKey: 'understanding' })),
    });
    return { metrics, subjectKeys };
  }

  function metricValues(metric, week) {
    const vals = [];
    docsForWeek(week).forEach((doc) => {
      metric.sources.forEach(({ subjectKey, fieldKey }) => {
        const entry = doc.subjects && doc.subjects[subjectKey];
        if (entry && typeof entry[fieldKey] === 'number') vals.push(entry[fieldKey]);
      });
    });
    return vals;
  }

  function renderDetail() {
    const { metrics, subjectKeys } = detailMetricDefs();

    els.detailStats.innerHTML = '';
    metrics.forEach((m) => {
      const vals = metricValues(m, currentWeek);
      const a = avg(vals);
      const tile = document.createElement('div');
      tile.className = 'stat';
      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = a === null ? '—' : a.toFixed(1);
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = `${m.label} · оценок: ${vals.length}`;
      tile.append(num, lbl);
      els.detailStats.appendChild(tile);
    });

    const weeksAsc = [...weekIds].reverse();
    if (detailChart) detailChart.destroy();
    detailChart = new Chart(els.detailChart.getContext('2d'), {
      type: 'line',
      data: {
        labels: weeksAsc.map(formatWeekLabel),
        datasets: metrics.map((m, i) => ({
          label: m.label,
          data: weeksAsc.map((w) => {
            const a = avg(metricValues(m, w));
            return a === null ? null : Number(a.toFixed(2));
          }),
          borderColor: COLORS[i % COLORS.length],
          backgroundColor: COLORS[i % COLORS.length],
          spanGaps: true,
          tension: 0.25,
        })),
      },
      options: { scales: { y: { min: 0, max: 10 } } },
    });

    els.detailComments.innerHTML = '';
    docsForWeek(currentWeek).forEach((doc) => {
      subjectKeys.forEach((key) => {
        const entry = doc.subjects && doc.subjects[key];
        if (!entry || typeof entry.comment !== 'string' || !entry.comment.trim()) return;
        const subject = SUBJECTS.find((s) => s.key === key);
        const item = document.createElement('div');
        item.className = 'comment-item';
        const meta = document.createElement('div');
        meta.className = 'comment-meta';
        meta.textContent = `${doc.name || doc.isu} · ${subject.name}`;
        const text = document.createElement('div');
        text.textContent = entry.comment;
        item.append(meta, text);
        els.detailComments.appendChild(item);
      });
    });
    if (!els.detailComments.children.length) els.detailComments.innerHTML = '<p>Комментариев нет.</p>';
  }

  els.detailTabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      detailMode = btn.dataset.mode;
      els.detailTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      populateDetailSelect();
      renderDetail();
    });
  });
  els.detailSelect.addEventListener('change', renderDetail);

  function renderAll() {
    renderCompletion();
    renderBarChart();
    renderTrendChart();
    renderSubjectTable();
    renderDetail();
    renderComments();
    renderProfile();
  }

  function showDashboard() {
    els.gateWrap.hidden = true;
    els.dashWrap.hidden = false;
    loadAllData();
  }

  if (sessionStorage.getItem('j3110_admin_ok') === '1') showDashboard();
})();
