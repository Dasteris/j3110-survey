// Список группы (ФИО + ИСУ) намеренно НЕ хранится в этом публичном файле —
// он лежит в Firestore (коллекция "roster", см. README и firestore.rules) и
// загружается только во время работы сайта для тех, кто на него зашёл.

let _rosterCache = null;

async function loadRoster() {
  if (_rosterCache) return _rosterCache;
  await fbReady();
  const db = initFirebase();
  const snap = await db.collection('roster').get();
  _rosterCache = snap.docs.map((d) => ({ isu: d.id, name: d.data().name, admin: !!d.data().admin }));
  return _rosterCache;
}

async function findStudent(isu, surname) {
  const isuNorm = String(isu || '').trim();
  const surnameNorm = String(surname || '').trim().toLowerCase();
  if (!isuNorm || surnameNorm.length < 2) return null;
  const roster = await loadRoster();
  return roster.find((s) => s.isu === isuNorm && s.name.toLowerCase().startsWith(surnameNorm)) || null;
}
