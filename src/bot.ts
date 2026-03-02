import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
import dotenv from 'dotenv';
import {
  createBook,
  deleteBook,
  listReservations,
  updateReservationStatus,
} from './api';

/** Payload from backend when a new reservation is created (POST /notify/new-reservation). */
export interface NewReservationNotifyPayload {
  id: string;
  bookId: string;
  fullName?: string | null;
  phone?: string | null;
  subdivision?: string | null;
  comment?: string | null;
  createdAt: string;
  book?: { title?: string; author?: string } | null;
}

/** Formats "issued to" line from reservation contact fields. */
const formatIssuedTo = (order: {
  fullName?: string | null;
  phone?: string | null;
  subdivision?: string | null;
}): string => {
  const parts = [
    order.fullName?.trim(),
    order.phone?.trim(),
    order.subdivision?.trim(),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
};

dotenv.config();

interface WizardState {
  addBook?: {
    title?: string;
    author?: string;
    coverUrl?: string;
    description?: string;
  };
  deleteBook?: {
    id?: string;
  };
}

type BotContext = Scenes.WizardContext;

const BOT_TOKEN = process.env.BOT_TOKEN;
const NOTIFY_WEBHOOK_SECRET = process.env.NOTIFY_WEBHOOK_SECRET;
const NOTIFY_PORT = Number(process.env.NOTIFY_PORT) || 3131;

const CHAT_IDS_FILE = path.join(process.cwd(), 'data', 'chat-ids.json');

/** Loads persisted chat IDs (users who have used the bot). */
function loadChatIds(): number[] {
  try {
    const raw = fs.readFileSync(CHAT_IDS_FILE, 'utf-8');
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** Adds a chat ID and persists to file. */
function addChatId(chatId: number): void {
  const ids = loadChatIds();
  if (ids.includes(chatId)) return;
  ids.push(chatId);
  const dir = path.dirname(CHAT_IDS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHAT_IDS_FILE, JSON.stringify(ids, null, 2), 'utf-8');
}

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Check your .env file.');
  process.exit(1);
}

const getTextFromMessage = (ctx: BotContext): string | undefined => {
  const message: unknown = ctx.message;
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  if ('text' in message && typeof (message as { text: unknown }).text === 'string') {
    return (message as { text: string }).text;
  }

  return undefined;
};

const getWizardState = (ctx: BotContext): WizardState => {
  return ctx.wizard.state as WizardState;
};

const addBookWizard = new Scenes.WizardScene<BotContext>(
  'add-book-wizard',
  async (ctx) => {
    const state = getWizardState(ctx);
    state.addBook = {};
    await ctx.reply('Введи назву книги:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = getTextFromMessage(ctx);
    if (!text) {
      await ctx.reply('Надішли, будь ласка, текстову назву книги.');
      return;
    }

    const state = getWizardState(ctx);
    state.addBook = {
      ...(state.addBook ?? {}),
      title: text.trim(),
    };

    await ctx.reply('Введи автора книги:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = getTextFromMessage(ctx);
    if (!text) {
      await ctx.reply('Надішли, будь ласка, текстове імʼя автора.');
      return;
    }

    const state = getWizardState(ctx);
    state.addBook = {
      ...(state.addBook ?? {}),
      author: text.trim(),
    };

    await ctx.reply('Встав URL обкладинки (coverUrl):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = getTextFromMessage(ctx);
    if (!text) {
      await ctx.reply('Надішли, будь ласка, валідний URL обкладинки.');
      return;
    }

    const state = getWizardState(ctx);
    state.addBook = {
      ...(state.addBook ?? {}),
      coverUrl: text.trim(),
    };

    await ctx.reply(
      'Короткий опис книги (або надішли "-" щоб пропустити):',
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = getTextFromMessage(ctx);
    const description =
      text && text.trim() !== '-' ? text.trim() : undefined;

    const state = getWizardState(ctx);
    const payload = {
      title: state.addBook?.title ?? '',
      author: state.addBook?.author ?? '',
      coverUrl: state.addBook?.coverUrl ?? '',
      description,
    };

    try {
      await ctx.reply('Створюю книгу...');
      const created = await createBook(payload);
      await ctx.reply(
        `Книгу створено ✅\n\nID: ${created.id}\nНазва: ${created.title}\nАвтор: ${created.author}`,
      );
    } catch (error) {
      await ctx.reply(
        error instanceof Error
          ? error.message
          : 'Сталася помилка під час створення книги.',
      );
    } finally {
      const state = getWizardState(ctx);
      state.addBook = undefined;
      return ctx.scene.leave();
    }
  },
);

const deleteBookWizard = new Scenes.WizardScene<BotContext>(
  'delete-book-wizard',
  async (ctx) => {
    const state = getWizardState(ctx);
    state.deleteBook = {};
    await ctx.reply(
      'Введи ID книги для видалення (ID можна скопіювати з адмінки або відповіді API):',
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = getTextFromMessage(ctx);
    if (!text) {
      await ctx.reply('Надішли, будь ласка, текстовий ID книги.');
      return;
    }

    const id = text.trim();

    try {
      await ctx.reply('Видаляю книгу...');
      await deleteBook(id);
      await ctx.reply(`Книгу з ID ${id} видалено ✅`);
    } catch (error) {
      await ctx.reply(
        error instanceof Error
          ? error.message
          : 'Сталася помилка під час видалення книги.',
      );
    } finally {
      const state = getWizardState(ctx);
      state.deleteBook = undefined;
      return ctx.scene.leave();
    }
  },
);

const bot = new Telegraf<BotContext>(BOT_TOKEN);
const stage = new Scenes.Stage<BotContext>([
  addBookWizard,
  deleteBookWizard,
]);

bot.use(session());
bot.use(stage.middleware());

/** Register chat ID so this user receives new-reservation notifications. */
bot.use((ctx, next) => {
  const id = ctx.chat?.id;
  if (id != null && typeof id === 'number') addChatId(id);
  return next();
});

const mainKeyboard = Markup.keyboard([
  ['➕ Додати книгу', '🗑 Видалити книгу'],
  ['📚 Замовлення', '✅ Підтверджені'],
]).resize();

/**
 * Sends a list of pending reservations with inline keyboard actions.
 */
const sendPendingOrders = async (ctx: BotContext): Promise<void> => {
  try {
    await ctx.reply('Завантажую замовлення...');
    const reservations = await listReservations({
      status: 'pending',
      page: 1,
      pageSize: 20,
    });

    if (!reservations.items.length) {
      await ctx.reply('Немає нових замовлень 📭');
      return;
    }

    for (const order of reservations.items) {
      const createdAt = new Date(order.createdAt).toLocaleString('uk-UA', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const title = order.book?.title ?? '—';
      const author = order.book?.author ?? '—';
      const issuedTo = formatIssuedTo(order);
      const lines = [
        `📌 Замовлення #${order.id}`,
        `📖 Книга: ${title} — ${author}`,
        `👤 Хто замовив: ${issuedTo}`,
        `📦 Статус: ${order.status}`,
        `📅 Створено: ${createdAt}`,
      ];
      if (order.comment?.trim()) {
        lines.push(`💬 Коментар: ${order.comment.trim()}`);
      }
      const text = lines.join('\n');

      await ctx.reply(
        text,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Прийняти',
              `order_confirm:${order.id}`,
            ),
            Markup.button.callback(
              '❌ Відхилити',
              `order_reject:${order.id}`,
            ),
          ],
        ]),
      );
    }
  } catch (error) {
    await ctx.reply(
      error instanceof Error
        ? error.message
        : 'Сталася помилка під час завантаження замовлень.',
    );
  }
};

/**
 * Sends a list of confirmed reservations; each as a separate message with "Повернено" button.
 */
const sendConfirmedReservations = async (ctx: BotContext): Promise<void> => {
  try {
    await ctx.reply('Завантажую підтверджені замовлення...');
    const reservations = await listReservations({
      status: 'confirmed',
      page: 1,
      pageSize: 50,
    });

    if (!reservations.items.length) {
      await ctx.reply('Немає підтверджених замовлень 📭');
      return;
    }

    await ctx.reply(
      `✅ Підтверджені замовлення (${reservations.totalItems}). Натисни «Повернено», коли книга повернута:`,
    );

    for (const order of reservations.items) {
      const book = order.book;
      const title = book?.title ?? '—';
      const author = book?.author ?? '—';
      const issuedTo = formatIssuedTo(order);
      const createdAt = new Date(order.createdAt).toLocaleString('uk-UA', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const lines = [
        `📌 Замовлення #${order.id}`,
        `📖 Книга: ${title} — ${author}`,
        `👤 Кому видана: ${issuedTo}`,
        `📅 Підтверджено: ${createdAt}`,
      ];
      if (order.comment?.trim()) {
        lines.push(`💬 Коментар: ${order.comment.trim()}`);
      }
      const text = lines.join('\n');

      await ctx.reply(
        text,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '📥 Повернено',
              `order_returned:${order.id}`,
            ),
          ],
        ]),
      );
    }
  } catch (error) {
    await ctx.reply(
      error instanceof Error
        ? error.message
        : 'Сталася помилка під час завантаження підтверджених замовлень.',
    );
  }
};

bot.start(async (ctx) => {
  await ctx.reply(
    'Вітаю в бібліотеці! Обери дію з меню нижче.',
    mainKeyboard,
  );
});


bot.hears('➕ Додати книгу', (ctx) => ctx.scene.enter('add-book-wizard'));
bot.command('addbook', (ctx) => ctx.scene.enter('add-book-wizard'));

bot.hears('🗑 Видалити книгу', (ctx) =>
  ctx.scene.enter('delete-book-wizard'),
);
bot.command('deletebook', (ctx) =>
  ctx.scene.enter('delete-book-wizard'),
);

bot.hears('📚 Замовлення', sendPendingOrders);
bot.command('orders', sendPendingOrders);

bot.hears('✅ Підтверджені', sendConfirmedReservations);
bot.command('confirmed', sendConfirmedReservations);

bot.action(/order_confirm:(.+)/, async (ctx) => {
  const [, id] = ctx.match as RegExpMatchArray;

  try {
    await ctx.answerCbQuery();
    await updateReservationStatus(id, 'confirmed');
    await ctx.editMessageText(`Замовлення #${id} підтверджено ✅`);
  } catch (error) {
    await ctx.answerCbQuery('Не вдалося оновити статус', {
      show_alert: true,
    });
    await ctx.reply(
      error instanceof Error
        ? error.message
        : 'Сталася помилка під час оновлення статусу.',
    );
  }
});

bot.action(/order_reject:(.+)/, async (ctx) => {
  const [, id] = ctx.match as RegExpMatchArray;

  try {
    await ctx.answerCbQuery();
    await updateReservationStatus(id, 'rejected');
    await ctx.editMessageText(`Замовлення #${id} відхилено ❌`);
  } catch (error) {
    await ctx.answerCbQuery('Не вдалося оновити статус', {
      show_alert: true,
    });
    await ctx.reply(
      error instanceof Error
        ? error.message
        : 'Сталася помилка під час оновлення статусу.',
    );
  }
});

bot.action(/order_returned:(.+)/, async (ctx) => {
  const [, id] = ctx.match as RegExpMatchArray;

  try {
    await ctx.answerCbQuery();
    await updateReservationStatus(id, 'returned');
    const prevText =
      ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message
        ? String(ctx.callbackQuery.message.text ?? '')
        : '';
    await ctx.editMessageText(prevText + '\n\n📥 Книгу повернено.', {
      reply_markup: { inline_keyboard: [] },
    });
  } catch (error) {
    await ctx.answerCbQuery('Не вдалося оновити статус', {
      show_alert: true,
    });
    await ctx.reply(
      error instanceof Error
        ? error.message
        : 'Сталася помилка під час оновлення статусу.',
    );
  }
});

bot.catch(async (err, ctx) => {
  console.error('Bot error', err);
  await ctx.reply(
    'Сталася неочікувана помилка. Спробуй ще раз трохи пізніше.',
  );
});

/**
 * HTTP server for backend webhook: POST /notify/new-reservation.
 * Sends a Telegram message to all users who have ever used the bot (stored in data/chat-ids.json).
 */
function createNotifyServer(telegram: Telegraf<BotContext>['telegram']): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/notify/new-reservation', (req: Request, res: Response) => {
    if (NOTIFY_WEBHOOK_SECRET) {
      const secret =
        req.headers['x-notify-secret'] ?? req.body?.secret ?? '';
      if (secret !== NOTIFY_WEBHOOK_SECRET) {
        res.status(401).json({ error: 'Invalid or missing secret' });
        return;
      }
    }

    const body = req.body as NewReservationNotifyPayload;
    const id = body?.id;
    const bookId = body?.bookId;
    const createdAt = body?.createdAt;

    if (!id || !bookId || !createdAt) {
      res.status(400).json({
        error: 'Missing required fields: id, bookId, createdAt',
      });
      return;
    }

    const issuedTo = [
      body.fullName?.trim(),
      body.phone?.trim(),
      body.subdivision?.trim(),
    ]
      .filter(Boolean)
      .join(', ') || '—';

    const title = body.book?.title ?? '—';
    const author = body.book?.author ?? '—';
    const dateStr = new Date(createdAt).toLocaleString('uk-UA', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const lines = [
      '🆕 Нове бронювання',
      '',
      `📌 Замовлення #${id}`,
      `📖 Книга: ${title} — ${author}`,
      `👤 Хто замовив: ${issuedTo}`,
      `📅 Створено: ${dateStr}`,
    ];
    if (body.comment?.trim()) {
      lines.push(`💬 Коментар: ${body.comment.trim()}`);
    }
    const text = lines.join('\n');

    const chatIds = loadChatIds();
    if (chatIds.length === 0) {
      res.status(200).json({ ok: true, sent: 0 });
      return;
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Прийняти', `order_confirm:${id}`),
        Markup.button.callback('❌ Відхилити', `order_reject:${id}`),
      ],
    ]);

    Promise.all(
      chatIds.map((chatId) =>
        telegram
          .sendMessage(chatId, text, keyboard)
          .catch((err: unknown) => {
            console.error(`Notify sendMessage to ${chatId} failed`, err);
          }),
      ),
    ).then(() => {
      res.status(200).json({ ok: true, sent: chatIds.length });
    });
  });

  return app;
}

bot.launch().then(() => {
  console.log('Telegram bot is running...');
  const notifyApp = createNotifyServer(bot.telegram);
  notifyApp.listen(NOTIFY_PORT, () => {
    console.log(
      `Notify server on port ${NOTIFY_PORT} (POST /notify/new-reservation → всім користувачам бота)`,
    );
  });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

