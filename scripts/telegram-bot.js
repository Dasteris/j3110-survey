// Telegram-бот анкеты J3110.
//
// Человек жмёт «Старт» → бот ищет его @ник в roster.local.js → присылает объяснение, ссылку, ИСУ и код
// и запоминает чат. По понедельникам с 10:00 МСК бот пишет всем, кто ещё не ответил про прошедшую неделю
// (если ноут в это время спал — отправит, как только проснётся, но один раз за неделю).
//
//   node scripts/telegram-bot.js setup                                   — токен из @BotFather, описание и команды бота
//   node scripts/telegram-bot.js status --key /путь/до/serviceAccount.json — кто подключился, кому уйдёт напоминание
//   node scripts/telegram-bot.js run --key /путь/до/serviceAccount.json    — запустить бота (обычно через scripts/install-bot.sh)
//
// telegram.local.json — токен бота; bot-state.local.json — чаты и отметка о последней рассылке. Оба не в git.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getSurveyWeekId, formatSurveyDeadline } = require('../common.js');

const PROJECT_DIR = path.join(__dirname, '..');
const BOT_CONFIG_PATH = path.join(PROJECT_DIR, 'telegram.local.json');
const STATE_PATH = path.join(PROJECT_DIR, 'bot-state.local.json');
const ROSTER_PATH = path.join(PROJECT_DIR, 'roster.local.js');
const CODES_PATH = path.join(PROJECT_DIR, 'codes.local.json');
const SITE_URL = 'https://dasteris.github.io/j3110-survey/';
const ADMIN_CONTACT = '@Dasteris';
const REMINDER_HOUR_MSK = 10;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- данные ---

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Не найден ${path.basename(file)}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Перечитываем на каждое сообщение: поправили ник в roster.local.js — человек просто жмёт /start ещё раз.
function loadGroup() {
  delete require.cache[require.resolve(ROSTER_PATH)];
  const { STUDENTS } = require(ROSTER_PATH);
  return { students: STUDENTS, codes: readJson(CODES_PATH) };
}

function normalizeNick(nick) {
  return String(nick || '').replace(/^@/, '').toLowerCase();
}

function firstName(student) {
  return student.name.split(' ')[1] || student.name;
}

// --- тексты ---

function welcomeMessage(student, code) {
  return [
    `Привет, ${firstName(student)}! Это бот еженедельной анкеты группы J3110.`,
    '',
    'Раз в неделю — пара минут: оцениваешь прошедшую неделю по каждому предмету (сложность, лекции и практика, насколько понятно) и как ты в целом. Ответы видит только староста.',
    '',
    `Анкета: ${SITE_URL}`,
    `Вход: ИСУ ${student.isu}, код ${code}`,
    'Код личный — никому не пересылай.',
    '',
    'По понедельникам буду напоминать, если анкета ещё не заполнена. /stop — отключить напоминания, /start — прислать код ещё раз.',
  ].join('\n');
}

function reminderMessage(student, code, weekId) {
  return [
    `Привет, ${firstName(student)}! Неделя закончилась — оцени её в анкете группы J3110, это пара минут. Ответы принимаются до ${formatSurveyDeadline(weekId)}.`,
    '',
    SITE_URL,
    `ИСУ: ${student.isu}`,
    `Код: ${code}`,
    '',
    '/stop — отключить напоминания',
  ].join('\n');
}

// --- Telegram Bot API ---

async function botApi(token, method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(json.description);
    err.status = json.error_code;
    err.retryAfter = json.parameters && json.parameters.retry_after;
    throw err;
  }
  return json.result;
}

async function sendText(token, chatId, text) {
  const params = { chat_id: chatId, text, link_preview_options: { is_disabled: true } };
  try {
    return await botApi(token, 'sendMessage', params);
  } catch (err) {
    if (err.status !== 429) throw err;
    await sleep((err.retryAfter || 5) * 1000);
    return botApi(token, 'sendMessage', params);
  }
}

// --- команды ---

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const token = (await new Promise((resolve) => rl.question('Токен бота из @BotFather: ', resolve))).trim();
  rl.close();
  const me = await botApi(token, 'getMe');
  writeJson(BOT_CONFIG_PATH, { botToken: token });
  await botApi(token, 'setMyDescription', {
    description:
      'Бот еженедельной анкеты группы J3110: пришлёт ссылку и личный код входа, а по понедельникам напомнит пройти анкету. Нажмите «Старт».',
  });
  await botApi(token, 'setMyShortDescription', { short_description: 'Еженедельная анкета группы J3110' });
  await botApi(token, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Ссылка на анкету и код входа' },
      { command: 'stop', description: 'Отключить напоминания' },
    ],
  });
  console.log(`[ok] бот @${me.username} настроен, токен сохранён в ${path.basename(BOT_CONFIG_PATH)}`);
  console.log(`Ссылка для группы: https://t.me/${me.username}`);
}

async function handleMessage(token, state, message) {
  const chatId = message.chat.id;
  if (message.chat.type !== 'private') return;
  const text = (message.text || '').trim();
  const nick = normalizeNick(message.from.username);

  if (text.startsWith('/stop')) {
    const isu = Object.keys(state.chats).find((k) => state.chats[k] === chatId);
    if (isu) delete state.chats[isu];
    await sendText(token, chatId, 'Напоминания отключены. /start — включить снова и получить код.');
    log('stop', isu || '(не был подключён)');
    return;
  }

  if (!nick) {
    await sendText(token, chatId, `У тебя в Telegram не задан username, поэтому я не могу найти тебя в списке группы. Задай его в настройках и нажми /start, или напиши старосте ${ADMIN_CONTACT}.`);
    return;
  }

  const { students, codes } = loadGroup();
  const student = students.find((s) => normalizeNick(s.tg) === nick);
  if (!student || !codes[student.isu]) {
    await sendText(token, chatId, `Не нашёл @${message.from.username} в списке группы J3110. Если ник недавно менялся — напиши старосте ${ADMIN_CONTACT}.`);
    log('unknown nick', nick);
    return;
  }

  state.chats[student.isu] = chatId;
  await sendText(token, chatId, welcomeMessage(student, codes[student.isu]));
  log('connected', student.isu);
}

function reminderDue(now = Date.now()) {
  const msk = new Date(now + MSK_OFFSET_MS);
  const sinceMonday = ((msk.getUTCDay() + 6) % 7) * 24 + msk.getUTCHours();
  return sinceMonday >= REMINDER_HOUR_MSK;
}

// Кому напоминать про неделю weekId: подключённые, не староста, ещё не ответили.
async function reminderPlan(db, state, weekId) {
  const { students, codes } = loadGroup();
  const answered = new Set((await db.collection('weeks').doc(weekId).collection('responses').get()).docs.map((d) => d.id));
  return students.map((s) => {
    let skip = null;
    if (s.admin) skip = 'староста';
    else if (!state.chats[s.isu]) skip = `ещё не нажали «Старт» в боте ${s.tg || ''}`.trim();
    else if (answered.has(s.isu)) skip = 'уже ответили';
    else if (!codes[s.isu]) skip = 'нет кода в codes.local.json';
    return { student: s, code: codes[s.isu], chatId: state.chats[s.isu], skip };
  });
}

async function sendWeeklyReminders(token, db, state) {
  const weekId = getSurveyWeekId();
  if (state.lastReminderWeek === weekId || !reminderDue()) return;
  const recipients = (await reminderPlan(db, state, weekId)).filter((p) => !p.skip);
  log(`напоминания про неделю ${weekId}: ${recipients.length}`);
  for (const { student, code, chatId } of recipients) {
    try {
      await sendText(token, chatId, reminderMessage(student, code, weekId));
    } catch (err) {
      log('не отправлено', student.isu, err.message);
      if (err.status === 403) delete state.chats[student.isu]; // заблокировал бота
    }
    await sleep(200);
  }
  state.lastReminderWeek = weekId;
}

function initDb() {
  const keyPath = argValue('--key') || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) throw new Error('Укажите ключ сервисного аккаунта: --key /путь/до/key.json');
  const serviceAccount = readJson(keyPath);
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  return getFirestore();
}

async function status() {
  const db = initDb();
  const state = readJson(STATE_PATH, { chats: {} });
  const weekId = getSurveyWeekId();
  const plan = await reminderPlan(db, state, weekId);
  console.log(`Анкета про неделю ${weekId}. Последняя рассылка: ${state.lastReminderWeek || 'ещё не было'}.`);
  plan.forEach(({ student, skip }) => console.log(`  ${skip ? '—' : '→'} ${student.name}${skip ? `  (${skip})` : ''}`));
  console.log(`Подключились: ${Object.keys(state.chats).length}. В следующей рассылке: ${plan.filter((p) => !p.skip).length}.`);
}

async function run() {
  const { botToken: token } = readJson(BOT_CONFIG_PATH);
  const db = initDb();
  const state = readJson(STATE_PATH, { chats: {}, offset: 0 });
  const me = await botApi(token, 'getMe');
  log(`бот @${me.username} запущен`);

  let weeklyRunning = false;
  const checkWeekly = async () => {
    if (weeklyRunning) return;
    weeklyRunning = true;
    try {
      await sendWeeklyReminders(token, db, state);
      writeJson(STATE_PATH, state);
    } catch (err) {
      log('ошибка рассылки', err.message);
    } finally {
      weeklyRunning = false;
    }
  };
  checkWeekly();
  setInterval(checkWeekly, 60 * 1000);

  for (;;) {
    try {
      const updates = await botApi(token, 'getUpdates', { offset: state.offset, timeout: 50, allowed_updates: ['message'] });
      for (const update of updates) {
        state.offset = update.update_id + 1;
        if (update.message) {
          try {
            await handleMessage(token, state, update.message);
          } catch (err) {
            log('ошибка обработки сообщения', err.message);
          }
        }
      }
      if (updates.length) writeJson(STATE_PATH, state);
    } catch (err) {
      log('нет связи с Telegram, повтор через 10 с:', err.message);
      await sleep(10000);
    }
  }
}

const commands = { setup, status, run };
if (!commands[args[0]]) {
  console.log('Команды: setup | status --key <key.json> | run --key <key.json>');
  process.exit(1);
}
commands[args[0]]()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fail]', err.message);
    process.exit(1);
  });
