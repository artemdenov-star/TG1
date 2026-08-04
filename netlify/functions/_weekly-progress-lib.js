const { sendTelegramMessage, escapeHtml } = require('./_lib');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

function pad(n) {
  return String(n).padStart(2, '0');
}

// Границы текущей недели (пн-вс) и подпись вкладки в формате "DD.MM - DD.MM",
// как называются вкладки в таблице
function currentWeekLabel(date) {
  const day = date.getDay(); // 0 = вс
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${pad(monday.getDate())}.${pad(monday.getMonth() + 1)} - ${pad(sunday.getDate())}.${pad(sunday.getMonth() + 1)}`;
}

async function sheetsGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}${sep}key=${SHEETS_API_KEY}`);
  const data = await res.json();
  if (data.error) throw new Error(`Sheets API error: ${JSON.stringify(data.error)}`);
  return data;
}

// Находим вкладку текущей недели по названию (диапазон дат)
async function findWeekSheetTitle() {
  const meta = await sheetsGet('');
  const label = currentWeekLabel(new Date());
  const sheet = (meta.sheets || []).find((s) => (s.properties.title || '').trim() === label);
  if (!sheet) throw new Error(`Не нашёл вкладку недели «${label}»`);
  return sheet.properties.title;
}

// Ищем блок сегодняшнего дня (по дате DD.MM.YYYY в заголовке) и читаем задачи с чекбоксами
// рядом в следующей колонке. Останавливаемся на первой пустой строке или на строке-итоге.
function parseTodayTasks(rows, todayLabel) {
  let dayCol = -1;
  let headerRow = -1;

  for (let r = 0; r < rows.length && dayCol === -1; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if ((row[c] || '').toString().trim() === todayLabel) {
        dayCol = c;
        headerRow = r;
        break;
      }
    }
  }
  if (dayCol === -1) return null;

  const done = [];
  const pending = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const taskText = (row[dayCol] || '').toString().trim();
    if (!taskText) break;
    const lower = taskText.toLowerCase();
    if (lower === 'выполнено' || lower === 'невыполнено') break;
    const checked = (row[dayCol + 1] || '').toString().trim().toUpperCase() === 'TRUE';
    (checked ? done : pending).push(taskText);
  }
  return { done, pending };
}

async function runWeeklyProgress() {
  if (!SHEET_ID || !SHEETS_API_KEY) {
    console.error('Не заданы GOOGLE_SHEET_ID / GOOGLE_SHEETS_API_KEY');
    return { statusCode: 200, body: 'not configured' };
  }

  try {
    const title = await findWeekSheetTitle();
    const valuesData = await sheetsGet(`/values/${encodeURIComponent(title)}`);
    const rows = valuesData.values || [];

    const today = new Date();
    const todayLabel = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;

    const result = parseTodayTasks(rows, todayLabel);
    if (!result) {
      await sendTelegramMessage(
        `⚠️ Не нашёл сегодняшний день (${escapeHtml(todayLabel)}) на вкладке «${escapeHtml(title)}» — проверь структуру таблицы.`
      );
      return { statusCode: 200, body: 'day not found' };
    }

    const { done, pending } = result;
    const lines = [];
    lines.push(done.length ? '<b>Сделано за сегодня:</b>' : '<b>Сделано за сегодня — пока пусто</b>');
    done.forEach((t, i) => lines.push(`${i + 1}. ${escapeHtml(t)}`));
    lines.push('');
    lines.push(pending.length ? '<b>Осталось выполнить за сегодня:</b>' : '<b>Осталось выполнить за сегодня — всё сделано 🎉</b>');
    pending.forEach((t, i) => lines.push(`${i + 1}. ${escapeHtml(t)}`));

    await sendTelegramMessage(lines.join('\n'));
  } catch (err) {
    console.error(err);
    await sendTelegramMessage('⚠️ Не получилось прочитать таблицу с планом, гляну логи.');
  }

  return { statusCode: 200, body: 'ok' };
}

module.exports = { runWeeklyProgress };
