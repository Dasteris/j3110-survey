// Локальный скрипт одноразовой/повторной настройки Firebase-проекта:
// - загружает список группы из roster.local.js (не в git) в Firestore
// - создаёт/находит web-приложение и записывает firebase-config.js
// - включает анонимный вход
//
// Запуск:
//   GOOGLE_APPLICATION_CREDENTIALS=/путь/до/serviceAccount.json node scripts/setup-firebase.js
// или
//   node scripts/setup-firebase.js /путь/до/serviceAccount.json
//
// Ключ сервисного аккаунта НИКОГДА не должен лежать внутри этого репозитория —
// .gitignore блокирует файлы вида *firebase-adminsdk*.json на всякий случай,
// но держите его вне папки проекта (например, в ~/Downloads).

const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_DIR = path.join(__dirname, '..');
const SA_PATH = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!SA_PATH) {
  console.error('Укажите путь до ключа сервисного аккаунта: node scripts/setup-firebase.js /путь/до/key.json');
  process.exit(1);
}

const rosterPath = path.join(PROJECT_DIR, 'roster.local.js');
if (!fs.existsSync(rosterPath)) {
  console.error(`Не найден ${rosterPath}. Создайте его по образцу roster.js (STUDENTS + module.exports).`);
  process.exit(1);
}
const { STUDENTS } = require(rosterPath);

const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const PROJECT_ID = serviceAccount.project_id;

const credential = cert(serviceAccount);
initializeApp({ credential, projectId: PROJECT_ID });

async function getAccessToken() {
  const token = await credential.getAccessToken();
  return token.access_token;
}

async function seedRoster() {
  const db = getFirestore();
  const batch = db.batch();
  STUDENTS.forEach((s) => {
    const ref = db.collection('roster').doc(s.isu);
    batch.set(ref, { name: s.name, admin: !!s.admin });
  });
  await batch.commit();
  console.log(`[ok] roster seeded: ${STUDENTS.length} students`);
}

async function ensureWebApp() {
  const accessToken = await getAccessToken();
  const base = `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const listRes = await fetch(`${base}/webApps`, { headers });
  const listJson = await listRes.json();
  if (!listRes.ok) throw new Error('list webApps failed: ' + JSON.stringify(listJson));

  let app = (listJson.apps || [])[0];
  if (!app) {
    console.log('[..] no web app found, creating one');
    const createRes = await fetch(`${base}/webApps`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ displayName: 'j3110-survey' }),
    });
    const createJson = await createRes.json();
    if (!createRes.ok) throw new Error('create webApp failed: ' + JSON.stringify(createJson));
    let opName = createJson.name;
    let done = false;
    let result = null;
    for (let i = 0; i < 20 && !done; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const opRes = await fetch(`https://firebase.googleapis.com/v1beta1/${opName}`, { headers });
      const opJson = await opRes.json();
      if (opJson.done) {
        done = true;
        result = opJson.response;
      }
    }
    if (!done) throw new Error('timed out waiting for web app creation');
    app = result;
  }

  const configRes = await fetch(`https://firebase.googleapis.com/v1beta1/${app.name}/config`, { headers });
  const configJson = await configRes.json();
  if (!configRes.ok) throw new Error('get config failed: ' + JSON.stringify(configJson));
  return configJson;
}

async function writeFirebaseConfig(cfg) {
  const content = `// Автоматически сгенерировано scripts/setup-firebase.js — значения не секретные.\nconst firebaseConfig = ${JSON.stringify(
    {
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId,
    },
    null,
    2
  )};\n\nconst FIREBASE_CONFIGURED = firebaseConfig.apiKey !== 'ЗАПОЛНИ_МЕНЯ';\n`;
  fs.writeFileSync(path.join(PROJECT_DIR, 'firebase-config.js'), content);
  console.log('[ok] firebase-config.js written');
}

async function deployRules() {
  const accessToken = await getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const rulesContent = fs.readFileSync(path.join(PROJECT_DIR, 'firestore.rules'), 'utf8');

  const createRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rulesContent }] } }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok) throw new Error('create ruleset failed: ' + JSON.stringify(createJson));
  const rulesetName = createJson.name;

  const releaseName = `projects/${PROJECT_ID}/releases/cloud.firestore`;
  let relRes = await fetch(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
  });
  if (!relRes.ok) {
    relRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
    });
    if (!relRes.ok) throw new Error('create release failed: ' + JSON.stringify(await relRes.json()));
  }
  console.log('[ok] firestore.rules deployed');
}

async function enableAnonymousAuth() {
  const accessToken = await getAccessToken();
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=signIn.anonymous.enabled`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signIn: { anonymous: { enabled: true } } }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  console.log('[ok] anonymous auth enabled');
}

(async () => {
  console.log('project:', PROJECT_ID);
  try {
    await seedRoster();
  } catch (e) {
    console.error('[fail] seed roster:', e.message);
  }
  try {
    const cfg = await ensureWebApp();
    await writeFirebaseConfig(cfg);
  } catch (e) {
    console.error('[fail] web app config:', e.message);
  }
  try {
    await enableAnonymousAuth();
  } catch (e) {
    console.error('[fail] anonymous auth:', e.message);
  }
  try {
    await deployRules();
  } catch (e) {
    console.error('[fail] deploy rules:', e.message);
  }
  console.log('Готово. Если Firestore/Auth ещё не включены вручную в консоли Firebase — сначала включите их там.');
  process.exit(0);
})();
