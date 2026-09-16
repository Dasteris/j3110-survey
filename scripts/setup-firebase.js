// Настройка Firebase-проекта (можно запускать повторно):
// - включает вход по email/паролю и выключает анонимный
// - находит/создаёт web-приложение и записывает firebase-config.js
// - загружает список группы из roster.local.js (не в git) в Firestore
// - заводит каждому аккаунт (uid = ИСУ, пароль = личный код), старосте — claim admin
// - новые коды пишет в codes.local.json (не в git); существующие коды не меняет
// - деплоит firestore.rules
//
// Запуск:
//   node scripts/setup-firebase.js /путь/до/serviceAccount.json
//   node scripts/setup-firebase.js /путь/до/key.json --reset 558392 561074   — перевыпустить коды (старые сессии разлогинятся)
//   node scripts/setup-firebase.js /путь/до/key.json --reset-all
//
// Ключ сервисного аккаунта держите ВНЕ папки проекта.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_DIR = path.join(__dirname, '..');
const ROSTER_PATH = path.join(PROJECT_DIR, 'roster.local.js');
const CODES_PATH = path.join(PROJECT_DIR, 'codes.local.json');
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // без похожих 0/o, 1/l/i

const args = process.argv.slice(2);
const SA_PATH = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const RESET_ALL = args.includes('--reset-all');
const RESET_ISUS = new Set(args.includes('--reset') ? args.slice(args.indexOf('--reset') + 1).filter((a) => /^\d+$/.test(a)) : []);

if (!SA_PATH) {
  console.error('Укажите путь до ключа сервисного аккаунта: node scripts/setup-firebase.js /путь/до/key.json');
  process.exit(1);
}
if (!fs.existsSync(ROSTER_PATH)) {
  console.error(`Не найден ${ROSTER_PATH}: нужен module.exports = { STUDENTS: [{ isu, name, tg, admin? }] }`);
  process.exit(1);
}
const { STUDENTS } = require(ROSTER_PATH);

const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const PROJECT_ID = serviceAccount.project_id;
const credential = cert(serviceAccount);
initializeApp({ credential, projectId: PROJECT_ID });

async function googleApi(url, { method = 'GET', body } = {}) {
  const { access_token } = await credential.getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json)}`);
  return json;
}

async function configureSignIn() {
  await googleApi(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired,signIn.anonymous.enabled`,
    { method: 'PATCH', body: { signIn: { email: { enabled: true, passwordRequired: true }, anonymous: { enabled: false } } } }
  );
  console.log('[ok] вход по email/паролю включён, анонимный выключен');
}

async function ensureWebAppConfig() {
  const base = `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}`;
  let app = ((await googleApi(`${base}/webApps`)).apps || [])[0];
  if (!app) {
    let op = await googleApi(`${base}/webApps`, { method: 'POST', body: { displayName: 'j3110-survey' } });
    for (let i = 0; i < 20 && !op.done; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      op = await googleApi(`https://firebase.googleapis.com/v1beta1/${op.name}`);
    }
    if (!op.done) throw new Error('не дождались создания web-приложения');
    app = op.response;
  }
  const cfg = await googleApi(`https://firebase.googleapis.com/v1beta1/${app.name}/config`);
  const publicConfig = {
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  };
  fs.writeFileSync(
    path.join(PROJECT_DIR, 'firebase-config.js'),
    `// Сгенерировано scripts/setup-firebase.js — значения публичные, защита данных в firestore.rules.\nconst firebaseConfig = ${JSON.stringify(publicConfig, null, 2)};\n`
  );
  console.log('[ok] firebase-config.js записан');
  return publicConfig;
}

async function seedRoster() {
  const db = getFirestore();
  const batch = db.batch();
  STUDENTS.forEach((s) => batch.set(db.collection('roster').doc(s.isu), { name: s.name }));
  await batch.commit();
  console.log(`[ok] ростер: ${STUDENTS.length} человек`);
}

function generateCode(length) {
  return Array.from({ length }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
}

async function syncAccounts(authDomain) {
  const auth = getAuth();
  const codes = fs.existsSync(CODES_PATH) ? JSON.parse(fs.readFileSync(CODES_PATH, 'utf8')) : {};
  let created = 0;
  let reset = 0;

  for (const s of STUDENTS) {
    const email = `${s.isu}@${authDomain}`;
    let exists = true;
    try {
      await auth.getUser(s.isu);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
      exists = false;
    }

    const needsCode = !exists || RESET_ALL || RESET_ISUS.has(s.isu);
    const code = needsCode ? generateCode(s.admin ? 14 : 8) : null;

    if (!exists) {
      await auth.createUser({ uid: s.isu, email, password: code, displayName: s.name });
      created++;
    } else {
      await auth.updateUser(s.isu, { email, displayName: s.name, ...(code ? { password: code } : {}) });
      if (code) {
        await auth.revokeRefreshTokens(s.isu);
        reset++;
      }
    }
    await auth.setCustomUserClaims(s.isu, s.admin ? { admin: true } : null);
    if (code) codes[s.isu] = code;
  }

  fs.writeFileSync(CODES_PATH, JSON.stringify(codes, null, 2) + '\n', { mode: 0o600 });
  console.log(`[ok] аккаунты: создано ${created}, коды перевыпущены ${reset}; коды в ${path.basename(CODES_PATH)}`);
  const unknown = STUDENTS.filter((s) => !codes[s.isu]);
  if (unknown.length) {
    console.log(`[!] кода нет в файле для: ${unknown.map((s) => s.isu).join(', ')} — перевыпустите через --reset`);
  }
}

async function deployRules() {
  const rules = fs.readFileSync(path.join(PROJECT_DIR, 'firestore.rules'), 'utf8');
  const ruleset = await googleApi(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`, {
    method: 'POST',
    body: { source: { files: [{ name: 'firestore.rules', content: rules }] } },
  });
  const releaseName = `projects/${PROJECT_ID}/releases/cloud.firestore`;
  try {
    await googleApi(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
      method: 'PATCH',
      body: { release: { name: releaseName, rulesetName: ruleset.name } },
    });
  } catch {
    await googleApi(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`, {
      method: 'POST',
      body: { release: { name: releaseName, rulesetName: ruleset.name } },
    });
  }
  console.log('[ok] firestore.rules задеплоены');
}

(async () => {
  console.log('project:', PROJECT_ID);
  await configureSignIn();
  const { authDomain } = await ensureWebAppConfig();
  await seedRoster();
  await syncAccounts(authDomain);
  await deployRules();
  console.log('Готово.');
  process.exit(0);
})().catch((err) => {
  console.error('[fail]', err.message);
  process.exit(1);
});
