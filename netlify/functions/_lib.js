/* ===== Общие хелперы для обеих функций ===== */

async function sendTelegramMessage(text, { replyToMessageId, replyMarkup } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Не заданы TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
  }

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  }
  return data;
}

async function askDeepSeek(systemPrompt, userPrompt) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('Не задан DEEPSEEK_API_KEY');

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
    }),
  });

  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error(`DeepSeek API error: ${JSON.stringify(data)}`);
  }
  return data.choices[0].message.content.trim();
}

// Telegram HTML parse_mode понимает только узкий набор тегов —
// экранируем то, что может прилететь от модели или из заголовков новостей.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { sendTelegramMessage, askDeepSeek, escapeHtml };
