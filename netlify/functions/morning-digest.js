const Parser = require('rss-parser');
const { getStore } = require('@netlify/blobs');
const { sendTelegramMessage, askDeepSeek } = require('./_lib');

const parser = new Parser({ timeout: 8000 });

/* ===== Источники новостей — правь список здесь, ключи не нужны ===== */
const FEEDS = [
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'DeepMind', url: 'https://deepmind.google/blog/feed/basic/' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'Hacker News (AI)', url: 'https://hnrss.org/newest?q=AI+OR+LLM&points=50' },
];

// Статичное описание — запасной вариант, используется только если живой снепшот
// от приложения ещё не пришёл (SNAPSHOT_URL в index.html не настроен или пока пусто).
const STATIC_PROJECT_CONTEXT = `
Проект пользователя: приложение-трекер обучения "Artem" — один файл index.html без фреймворков,
14 дней по 4 модуля (A/B теория+практика, C сборка, D разбор+экзамен), деплой на Netlify.
Стек: localStorage, несколько ИИ-агентов (DeepSeek/OpenAI/Claude/OpenRouter), вкладки Заметки/Чат/Курс/Прогресс/Ещё,
дизайн — Manrope + JetBrains Mono, Liquid Glass, светлая/тёмная тема через CSS-переменные.
Пользователь учится ИИ-автоматизации 5 часов в день, цель — уйти в IT/фриланс за 3 месяца.
`.trim();

async function buildProjectContext() {
  try {
    const store = getStore('app-state');
    const snapshot = await store.get('snapshot', { type: 'json' });
    if (!snapshot) return STATIC_PROJECT_CONTEXT;

    const ageHours = (Date.now() - (snapshot.updatedAt || 0)) / 3_600_000;
    const notesLine = (snapshot.lastNotes || [])
      .map((n) => `«${n.title}»`)
      .join(', ');

    return `
Живой прогресс из приложения (снепшот ${ageHours < 1 ? 'меньше часа' : Math.round(ageHours) + ' ч.'} назад):
Текущий день обучения: ${snapshot.currentDay ?? '—'} из 14. Прогресс недели: ${snapshot.progressPercent}%. Стрик: ${snapshot.streakDays} дн.
Последние заметки пользователя: ${notesLine || 'нет'}.
Это приложение-трекер "Artem" (один файл index.html, localStorage, деплой на Netlify, дизайн Manrope + Liquid Glass).
Пользователь учится ИИ-автоматизации 5 часов в день, цель — уйти в IT/фриланс за 3 месяца.
`.trim();
  } catch (e) {
    console.error('snapshot read failed', e.message);
    return STATIC_PROJECT_CONTEXT;
  }
}

// Сколько последних новостей брать с каждого источника
const ITEMS_PER_FEED = 4;

async function collectHeadlines() {
  const results = await Promise.allSettled(FEEDS.map((f) => parser.parseURL(f.url)));

  const lines = [];
  results.forEach((r, i) => {
    const source = FEEDS[i].name;
    if (r.status !== 'fulfilled') {
      console.error(`Feed failed: ${source}`, r.reason?.message);
      return;
    }
    const items = (r.value.items || []).slice(0, ITEMS_PER_FEED);
    items.forEach((item) => {
      lines.push(`[${source}] ${item.title}`);
    });
  });
  return lines;
}

/* ===== GitHub-находки — правь темы поиска здесь, ключ не обязателен ===== */
const GITHUB_TOPICS = ['ai-agents', 'llm-automation', 'n8n', 'prompt-engineering', 'ai-automation'];
const GITHUB_REPOS_PER_DIGEST = 3;

async function collectGithubFindings() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const topicQuery = GITHUB_TOPICS.map((t) => `topic:${t}`).join(' OR ');
    const q = encodeURIComponent(`(${topicQuery}) pushed:>${since}`);

    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'artem-telegram-bot' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=8`, {
      headers,
    });
    const data = await res.json();
    if (!data.items) {
      console.error('GitHub search failed', data.message);
      return [];
    }

    return data.items.slice(0, GITHUB_REPOS_PER_DIGEST).map((repo) => ({
      name: repo.full_name,
      url: repo.html_url,
      description: repo.description || 'без описания',
      stars: repo.stargazers_count,
      openIssues: repo.open_issues_count,
      updatedAt: (repo.pushed_at || '').slice(0, 10),
      language: repo.language || '—',
    }));
  } catch (e) {
    console.error('github findings failed', e.message);
    return [];
  }
}

function formatGithubBlock(repos) {
  if (!repos.length) return 'Свежих подходящих репозиториев на GitHub сегодня не нашлось.';
  return repos
    .map(
      (r) =>
        `- ${r.name} (${r.stars}★, ${r.language}, обновлён ${r.updatedAt}, открытых issues: ${r.openIssues})\n  Описание: ${r.description}\n  Ссылка: ${r.url}`
    )
    .join('\n');
}

exports.handler = async () => {
  try {
    const [headlines, githubRepos] = await Promise.all([collectHeadlines(), collectGithubFindings()]);

    if (headlines.length === 0) {
      await sendTelegramMessage('Не удалось собрать новости сегодня — все источники недоступны. Проверю позже.');
      return { statusCode: 200, body: 'no headlines' };
    }

    const projectContext = await buildProjectContext();

    const userPrompt = `
Вот свежие заголовки новостей из мира ИИ за последние сутки:

${headlines.join('\n')}

Свежие репозитории с GitHub за последнюю неделю (темы — ИИ-агенты, автоматизация, n8n, промпт-инжиниринг):

${formatGithubBlock(githubRepos)}

Контекст проекта пользователя:
${projectContext}

Составь утренний дайджест на русском для Telegram (используй только HTML-теги <b> и <i>, без markdown-звёздочек):
1. Раздел "Новости" — выбери 4-6 самых значимых заголовков, для каждого 1 короткая строка своими словами (не переписывай заголовок дословно), без ссылок.
2. Раздел "Фича/приём" — один конкретный полезный приём или фича ИИ-агентов/автоматизации, которую стоит попробовать сегодня.
3. Раздел "GitHub находки" — по каждому репозиторию из списка выше кратко: что это и для кого полезно, сильные стороны, слабые стороны (учитывай звёзды/issues/дату обновления как сигналы качества и активности). В конце каждого репозитория дай его ссылку отдельной строкой. Если репозиториев нет — напиши одну строку, что сегодня ничего не нашлось, и пропусти раздел.
4. Раздел "Совет по проекту" — одна короткая практическая идея, как продвинуть проект пользователя, с учётом его актуального прогресса из контекста выше (если там есть конкретный день или тема — совет должен быть привязан к ней, а не общий).
Пиши компактно, это сообщение в мессенджер, не длиннее ~220 слов суммарно.
`.trim();

    const digest = await askDeepSeek(
      'Ты — лаконичный технический ассистент, который готовит утренние дайджесты по ИИ на русском языке.',
      userPrompt
    );

    const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    await sendTelegramMessage(`<b>☀️ Дайджест на ${today}</b>\n\n${digest}`);

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error(err);
    // Не даём функции упасть молча — если что-то сломалось, хотим увидеть это в группе
    try {
      await sendTelegramMessage(`⚠️ Дайджест сегодня не собрался: ${err.message}`);
    } catch (_) {}
    return { statusCode: 500, body: err.message };
  }
};
