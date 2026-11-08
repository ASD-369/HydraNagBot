const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const Database = require('better-sqlite3');

// Подключаем базу данных (файл создастся сам)
const db = new Database('water_bot.db');

// Создаем таблицу, если её нет
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id TEXT PRIMARY KEY,
    water_ml INTEGER DEFAULT 0,
    alcohol_ml INTEGER DEFAULT 0,
    norm_ml INTEGER DEFAULT 2000,
    reminders_enabled INTEGER DEFAULT 1,
    last_reset_date TEXT
  )
`);

const TOKEN = '9297122939:AAH_Uo3FDCzE0RP3tdKD_Uje2sdowD7A-I0';
const bot = new TelegramBot(TOKEN, { polling: true });

// --- Вспомогательные функции ---

// Получить данные пользователя (или создать)
function getUser(chatId) {
  const today = new Date().toDateString();
  let user = db.prepare('SELECT * FROM users WHERE chat_id = ?').get(String(chatId));

  if (!user) {
    // Создаем нового
    db.prepare('INSERT INTO users (chat_id, last_reset_date) VALUES (?, ?)').run(String(chatId), today);
    user = db.prepare('SELECT * FROM users WHERE chat_id = ?').get(String(chatId));
  } else if (user.last_reset_date !== today) {
    // Сбрасываем счетчики в новый день
    db.prepare('UPDATE users SET water_ml = 0, alcohol_ml = 0, last_reset_date = ? WHERE chat_id = ?').run(today, String(chatId));
    user = db.prepare('SELECT * FROM users WHERE chat_id = ?').get(String(chatId));
  }
  return user;
}

// Обновить данные
function updateUser(chatId, updates) {
  const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = Object.values(updates);
  db.prepare(`UPDATE users SET ${fields} WHERE chat_id = ?`).run(...values, String(chatId));
}

// --- Команды ---

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  getUser(chatId);
  bot.sendMessage(chatId,
    `Привет! 💧 Я помогу тебе пить достаточно воды и буду следить за твоим самочувствием.\n\n` +
    `Мои команды:\n` +
    `/water 250 — выпил 250 мл воды\n` +
    `/alco 50 — выпил 50 мл алкоголя (я осужу 😠 и скажу сколько воды выпить)\n` +
    `/status — текущий статус\n` +
    `/norm 2200 — установить дневную норму воды\n` +
    `/reminders on|off — включить/выключить напоминания`
  );
});

bot.onText(/\/water(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const u = getUser(chatId);
  const ml = parseInt(match[1], 10);

  if (!ml || ml <= 0) {
    return bot.sendMessage(chatId, 'Укажи количество в мл, например: /water 250');
  }

  const newWaterMl = u.water_ml + ml;
  updateUser(chatId, { water_ml: newWaterMl });
  
  const left = Math.max(0, u.norm_ml - newWaterMl);
  let praise = newWaterMl >= u.norm_ml ? '🎉 Ты выполнил норму! Отлично!' : '💪 Молодец, так держать!';

  bot.sendMessage(chatId,
    `${praise}\n` +
    `Выпито сегодня: ${newWaterMl} мл из ${u.norm_ml} мл\n` +
    `Осталось: ${left} мл` +
    (u.alcohol_ml > 0 ? `\n\n⚠️ У тебя сегодня был алкоголь, не забывай про воду!` : '')
  );
});

bot.onText(/\/alco(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const u = getUser(chatId);
  const ml = parseInt(match[1], 10);

  if (!ml || ml <= 0) {
    return bot.sendMessage(chatId, 'Укажи количество в мл, например: /alco 50');
  }

  const newAlcoholMl = u.alcohol_ml + ml;
  updateUser(chatId, { alcohol_ml: newAlcoholMl });

  const extraWater = Math.round(ml * 1.5);
  const left = Math.max(0, u.norm_ml + extraWater - u.water_ml);

  const condemnations = [
    '😠 Алкоголь — не вода. Осуждаю.',
    '🙄 Ну и зачем? Организм тебе спасибо не скажет.',
    '😤 Ладно, но воду пить всё равно придётся.',
    '😒 Понятно. Вода всё равно важнее.'
  ];
  const condemn = condemnations[Math.floor(Math.random() * condemnations.length)];

  bot.sendMessage(chatId,
    `${condemn}\n\n` +
    `Выпито алкоголя сегодня: ${newAlcoholMl} мл\n` +
    `Чтобы организму было легче, нужно выпить ещё примерно ${extraWater} мл воды.\n` +
    `Итого к дню: осталось ${left} мл воды.`
  );
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const u = getUser(chatId);
  const left = Math.max(0, u.norm_ml - u.water_ml);
  
  bot.sendMessage(chatId,
    `📊 Статус на сегодня:\n` +
    `💧 Вода: ${u.water_ml} / ${u.norm_ml} мл (осталось ${left} мл)\n` +
    `🍷 Алкоголь: ${u.alcohol_ml} мл\n` +
    `🔔 Напоминания: ${u.reminders_enabled ? 'вкл' : 'выкл'}`
  );
});

bot.onText(/\/norm(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const ml = parseInt(match[1], 10);

  if (!ml || ml < 500) {
    return bot.sendMessage(chatId, 'Укажи норму в мл (минимум 500), например: /norm 2200');
  }
  updateUser(chatId, { norm_ml: ml });
  bot.sendMessage(chatId, `✅ Норма установлена: ${ml} мл в день.`);
});

bot.onText(/\/reminders\s+(on|off)/, (msg, match) => {
  const chatId = msg.chat.id;
  const isOn = match[1] === 'on' ? 1 : 0;
  updateUser(chatId, { reminders_enabled: isOn });
  bot.sendMessage(chatId, `🔔 Напоминания ${isOn ? 'включены' : 'выключены'}.`);
});

// --- Напоминания ---
cron.schedule('0 9-21 * * *', () => {
  const users = db.prepare('SELECT * FROM users WHERE reminders_enabled = 1').all();
  
  for (const u of users) {
    const today = new Date().toDateString();
    if (u.last_reset_date !== today) continue;

    if (u.water_ml >= u.norm_ml) continue; 

    const left = u.norm_ml - u.water_ml;
    const msg = u.alcohol_ml > 0
      ? `💧 Напоминание: выпей воды! Осталось ${left} мл. И помни — с алкоголем воды нужно больше.`
      : `💧 Напоминание: выпей воды! Осталось ${left} мл до нормы.`;

    bot.sendMessage(u.chat_id, msg).catch(() => {}); 
  }
});

console.log('Бот запущен с базой данных SQLite...');