// Общие утилиты для index.html и admin.html

// Неделя = дата понедельника этой недели в формате YYYY-MM-DD.
// Значение автоматически меняется в 00:00 по понедельникам — это и есть "еженедельный сброс":
// новая неделя = новый (пустой) документ, прошлые недели остаются в базе как история.
function getWeekId(date) {
  const d = new Date(date || Date.now());
  const day = (d.getDay() + 6) % 7; // 0 = понедельник
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatWeekLabel(weekId) {
  const [y, m, d] = weekId.split('-').map(Number);
  const monday = new Date(y, m - 1, d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt) => `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}`;
  return `неделя ${fmt(monday)}–${fmt(sunday)}.${sunday.getFullYear()}`;
}

let _fbApp = null;
let _fbDb = null;
let _fbAuthReady = null;

function initFirebase() {
  if (!FIREBASE_CONFIGURED) return null;
  if (_fbApp) return _fbDb;
  _fbApp = firebase.initializeApp(firebaseConfig);
  _fbDb = firebase.firestore();
  _fbAuthReady = firebase
    .auth()
    .signInAnonymously()
    .catch((err) => console.error('Firebase anonymous auth failed', err));
  return _fbDb;
}

async function fbReady() {
  if (!FIREBASE_CONFIGURED) return false;
  initFirebase();
  await _fbAuthReady;
  return true;
}
