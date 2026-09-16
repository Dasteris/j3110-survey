// Общие утилиты для index.html и admin.html

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');

// Опрос всегда про прошедшую неделю (пн–вс по Москве) и открыт всю следующую неделю.
// Возвращает дату понедельника оцениваемой недели (YYYY-MM-DD), не зависит от часового пояса устройства.
// firestore.rules считают то же самое по серверному времени и не примут запись в другую неделю.
function getSurveyWeekId(now = Date.now()) {
  const d = new Date(now + MSK_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Для Node-скриптов (scripts/send-reminders.js); в браузере module не определён.
if (typeof module !== 'undefined') module.exports = { getSurveyWeekId };

function weekDate(weekId, plusDays) {
  const [y, m, d] = weekId.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + plusDays));
  return `${pad2(dt.getUTCDate())}.${pad2(dt.getUTCMonth() + 1)}`;
}

function formatWeekRange(weekId) {
  const [y, m, d] = weekId.split('-').map(Number);
  const sundayYear = new Date(Date.UTC(y, m - 1, d + 6)).getUTCFullYear();
  return `${weekDate(weekId, 0)}–${weekDate(weekId, 6)}.${sundayYear}`;
}

function formatWeekLabel(weekId) {
  return `неделя ${formatWeekRange(weekId)}`;
}

// Последний день, когда ещё принимаются ответы про эту неделю (воскресенье следующей недели).
function formatSurveyDeadline(weekId) {
  return weekDate(weekId, 13);
}

function isRating(v) {
  return Number.isInteger(v) && v >= 0 && v <= 10;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let _db = null;

function getDb() {
  if (!_db) {
    firebase.initializeApp(firebaseConfig);
    _db = firebase.firestore();
  }
  return _db;
}

function responseRef(weekId, isu) {
  return getDb().collection('weeks').doc(weekId).collection('responses').doc(isu);
}

// Аккаунты создаёт scripts/setup-firebase.js: uid = ИСУ, пароль = личный код.
function authEmail(isu) {
  return `${isu}@${firebaseConfig.authDomain}`;
}

// callback(user | null, isAdmin)
function onAuthChange(callback) {
  getDb();
  return firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) return callback(null, false);
    const token = await user.getIdTokenResult();
    callback(user, token.claims.admin === true);
  });
}

function signOutUser() {
  return firebase.auth().signOut();
}

function loginErrorMessage(err) {
  switch (err && err.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/invalid-email':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Неверный ИСУ или код.';
    case 'auth/too-many-requests':
      return 'Слишком много попыток — подождите немного и попробуйте снова.';
    case 'auth/network-request-failed':
      return 'Нет связи с сервером, проверьте интернет.';
    default:
      return 'Не удалось войти, попробуйте ещё раз.';
  }
}

function bindLoginForm({ isuInput, codeInput, button, errorEl }) {
  async function submit() {
    button.disabled = true;
    errorEl.textContent = '';
    try {
      getDb();
      await firebase.auth().signInWithEmailAndPassword(authEmail(isuInput.value.trim()), codeInput.value.trim());
      codeInput.value = '';
    } catch (err) {
      errorEl.textContent = loginErrorMessage(err);
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', submit);
  isuInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') codeInput.focus();
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}
