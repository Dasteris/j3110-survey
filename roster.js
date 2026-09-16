// Список группы (ФИО + ИСУ) намеренно НЕ хранится в публичном коде — он лежит в
// Firestore (коллекция "roster") и по firestore.rules читается только старостой.

async function loadRoster() {
  const snap = await getDb().collection('roster').get();
  return snap.docs.map((d) => ({ isu: d.id, name: d.data().name }));
}
