// Еженедельная рассылка в Telegram: просьба пройти анкету + личный код входа.
// Сообщения уходят с ВАШЕГО аккаунта (Telegram API, как обычный клиент): бот не может
// написать человеку по @нику, пока тот сам не нажал у бота /start.
//
// 1) Получите api_id и api_hash: https://my.telegram.org → API development tools.
// 2) Один раз войдите:      node scripts/send-reminders.js login
// 3) Проверка без отправки: node scripts/send-reminders.js --key /путь/до/serviceAccount.json
// 4) Отправка:              node scripts/send-reminders.js --key /путь/до/key.json --send
//
// Кому пишем: всем из roster.local.js, кроме старосты и тех, кто уже ответил на этой неделе.
// telegram.local.json хранит сессию = полный доступ к вашему Telegram. Не публикуйте его.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { TelegramClient, errors } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getWeekId } = require('../common.js');

const PROJECT_DIR = path.join(__dirname, '..');
const TELEGRAM_CONFIG_PATH = path.join(PROJECT_DIR, 'telegram.local.json');
const CODES_PATH = path.join(PROJECT_DIR, 'codes.local.json');
const SITE_URL = 'https://dasteris.github.io/j3110-survey/';
const DELAY_MS = [15000, 30000]; // пауза между сообщениями, чтобы Telegram не счёл рассылку спамом
const USERNAME_RE = /^@[A-Za-z0-9_]{5,32}$/;

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function buildMessage(student, code) {
  const firstName = student.name.split(' ')[1] || student.name;
  return [
    `Привет, ${firstName}! Напоминаю про еженедельную анкету группы J3110 — пара минут: оценки по предметам и как ты в целом.`,
    '',
    SITE_URL,
    `ИСУ: ${student.isu}`,
    `Код: ${code}`,
    '',
    'Код личный — не пересылай его никому.',
  ].join('\n');
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

function readTelegramConfig() {
  return fs.existsSync(TELEGRAM_CONFIG_PATH) ? JSON.parse(fs.readFileSync(TELEGRAM_CONFIG_PATH, 'utf8')) : {};
}

function makeClient(config) {
  const client = new TelegramClient(new StringSession(config.session || ''), Number(config.apiId), config.apiHash, {
    connectionRetries: 5,
    floodSleepThreshold: 600, // FLOOD_WAIT до 10 минут просто пережидаем
  });
  client.setLogLevel('error');
  return client;
}

async function login() {
  const config = readTelegramConfig();
  config.apiId = config.apiId || (await ask('api_id: '));
  config.apiHash = config.apiHash || (await ask('api_hash: '));
  const client = makeClient(config);
  await client.start({
    phoneNumber: () => ask('Телефон (+7...): '),
    phoneCode: () => ask('Код из Telegram: '),
    password: () => ask('Облачный пароль (2FA), если есть: '),
    onError: (err) => console.error(err.message),
  });
  config.session = client.session.save();
  fs.writeFileSync(TELEGRAM_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const me = await client.getMe();
  console.log(`[ok] вошли как ${me.firstName || ''} @${me.username || ''}; сессия сохранена в ${path.basename(TELEGRAM_CONFIG_PATH)}`);
  await client.disconnect();
}

async function answeredThisWeek(keyPath, weekId) {
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  const snap = await getFirestore().collection('weeks').doc(weekId).collection('responses').get();
  return new Set(snap.docs.map((d) => d.id));
}

async function planRecipients(keyPath) {
  const { STUDENTS } = require(path.join(PROJECT_DIR, 'roster.local.js'));
  const codes = JSON.parse(fs.readFileSync(CODES_PATH, 'utf8'));
  const weekId = getWeekId();
  const answered = await answeredThisWeek(keyPath, weekId);

  const plan = STUDENTS.map((s) => {
    let skip = null;
    if (s.admin) skip = 'староста';
    else if (answered.has(s.isu)) skip = 'уже ответили на этой неделе';
    else if (!USERNAME_RE.test(s.tg || '')) skip = `некорректный ник "${s.tg || ''}" — поправьте в roster.local.js`;
    else if (!codes[s.isu]) skip = 'нет кода в codes.local.json — выпустите через setup-firebase.js --reset';
    return { student: s, code: codes[s.isu], skip };
  });
  return { weekId, plan };
}

async function run() {
  const keyPath = argValue('--key') || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) throw new Error('Укажите ключ сервисного аккаунта: --key /путь/до/key.json');
  const send = args.includes('--send');

  const { weekId, plan } = await planRecipients(keyPath);
  const recipients = plan.filter((p) => !p.skip);
  console.log(`${new Date().toISOString()} · неделя ${weekId} · ${send ? 'ОТПРАВКА' : 'проверка без отправки'}`);
  plan.forEach(({ student, skip }) => console.log(`  ${skip ? '—' : '→'} ${student.name} ${student.tg || ''}${skip ? `  (${skip})` : ''}`));
  console.log(`Получателей: ${recipients.length}`);

  if (!send) {
    if (recipients.length) {
      const sample = recipients[0];
      console.log('\nПример сообщения (код скрыт):\n' + buildMessage(sample.student, '•'.repeat(sample.code.length)));
    }
    console.log('\nЧтобы отправить, добавьте --send');
    return;
  }
  if (!recipients.length) return;

  const config = readTelegramConfig();
  if (!config.session) throw new Error('Нет сессии Telegram — сначала: node scripts/send-reminders.js login');
  const client = makeClient(config);
  await client.connect();
  if (!(await client.checkAuthorization())) throw new Error('Сессия Telegram недействительна — войдите заново: login');

  const failed = [];
  try {
    for (let i = 0; i < recipients.length; i++) {
      const { student, code } = recipients[i];
      try {
        await client.sendMessage(student.tg, { message: buildMessage(student, code) });
        console.log(`  ✓ ${student.tg}`);
      } catch (err) {
        const reason = err instanceof errors.RPCError ? err.errorMessage : err.message;
        console.log(`  ✗ ${student.tg}: ${reason}`);
        failed.push(student.tg);
        // PEER_FLOOD = Telegram ограничил аккаунт в рассылке; дальше будет только хуже.
        if (reason === 'PEER_FLOOD') {
          console.log('Telegram ограничил отправку с аккаунта (PEER_FLOOD) — рассылка остановлена.');
          break;
        }
      }
      if (i < recipients.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0])));
      }
    }
  } finally {
    await client.disconnect();
  }
  console.log(`Готово: отправлено ${recipients.length - failed.length}, ошибок ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}`);
}

(args[0] === 'login' ? login() : run())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fail]', err.message);
    process.exit(1);
  });
