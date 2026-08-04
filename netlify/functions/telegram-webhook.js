const { sendTelegramMessage, askDeepSeek, escapeHtml } = require('./_lib');

const SYSTEM_PROMPT = `
Ты — консультант в личной телеграм-группе пользователя, который уходит из госструктуры в IT/ИИ-автоматизацию
и учится 5 часов в день. Отвечай на русском, по делу, коротко (обычно 3-6 предложений, без воды).
Если вопрос про код, автоматизацию, ИИ-агентов, n8n или карьеру в IT — давай конкретику, а не общие слова.
`.trim();

exports.handler = async (event) => {
  // Секрет, который Telegram присылает в заголовке — защита от чужих запросов на этот URL
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const gotSecret = event.headers['x-telegram-bot-api-secret-token'];
  if (expectedSecret && gotSecret !== expectedSecret) {
    return { statusCode: 401, body: 'unauthorized' };
  }

  let update;
  try {
    update = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'bad json' };
  }

  const message = update.message;
  if (!message || !message.text) {
    return { statusCode: 200, body: 'ignored' };
  }

  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');

  // /app — кнопка вызова Mini App прямым t.me-линком (работает в группах, в отличие от web_app-кнопок)
  if (message.text.replace(/@\w+$/, '').trim() === '/app') {
    const shortName = process.env.TELEGRAM_MINIAPP_SHORTNAME;
    if (!shortName || !botUsername) {
      await sendTelegramMessage('⚠️ Mini App ещё не настроен (нет TELEGRAM_MINIAPP_SHORTNAME).', {
        replyToMessageId: message.message_id,
      });
      return { statusCode: 200, body: 'miniapp not configured' };
    }
    await sendTelegramMessage('📚 Открыть Artem', {
      replyToMessageId: message.message_id,
      replyMarkup: {
        inline_keyboard: [[{ text: '📚 Открыть Artem', url: `https://t.me/${botUsername}/${shortName}` }]],
      },
    });
    return { statusCode: 200, body: 'app button sent' };
  }
  const isReplyToBot =
    message.reply_to_message?.from?.is_bot &&
    message.reply_to_message.from.username?.toLowerCase() === botUsername.toLowerCase();
  const isMention = botUsername && message.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);

  // Реагируем только когда бота упомянули или ответили на его сообщение — не на каждое сообщение в группе
  if (!isReplyToBot && !isMention) {
    return { statusCode: 200, body: 'not addressed to bot' };
  }

  const question = message.text.replace(new RegExp(`@${botUsername}`, 'ig'), '').trim();
  if (!question) {
    return { statusCode: 200, body: 'empty question' };
  }

  try {
    const answer = await askDeepSeek(SYSTEM_PROMPT, question);
    await sendTelegramMessage(escapeHtml(answer), { replyToMessageId: message.message_id });
  } catch (err) {
    console.error(err);
    await sendTelegramMessage('⚠️ Не получилось ответить, попробуй ещё раз чуть позже.', {
      replyToMessageId: message.message_id,
    });
  }

  return { statusCode: 200, body: 'ok' };
};
