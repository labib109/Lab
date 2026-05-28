const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// ============================================================
//  ⚙️  الإعدادات — عدّل هذي الأسطر الثلاثة فقط
// ============================================================
const BOT_TOKEN      = '8111033892:AAFGtKC_GWCQ-ei2zd5JTKadm1am-cIimhA'; // ← غيّر هذا
const SUPABASE_URL   = 'https://YOUR_PROJECT_ID.supabase.co';               // ← غيّر هذا
const SUPABASE_KEY   = 'sb_publishable_u_zumVUhZxvbKaV31TSD6A_Vni0Lq7N';   // ← غيّر هذا
// ============================================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// حالة كل مستخدم (عشان نعرف هو في أي خطوة)
const userState = {};

// ─── دوال Supabase ───────────────────────────────────────────

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function getStats() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_contacts?select=*`, { headers });
  const data = await res.json();
  const total = data.length;
  const spam  = data.filter(r => r.is_spam).length;
  const top   = [...data].sort((a,b) => b.spam_score - a.spam_score).slice(0, 3);
  return { total, spam, top };
}

async function searchNumber(phone) {
  const encoded = encodeURIComponent(`eq.${phone}`);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_contacts?phone_number=${encoded}&select=*`,
    { headers }
  );
  return await res.json();
}

async function getRecentNumbers(limit = 10) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_contacts?select=*&order=created_at.desc&limit=${limit}`,
    { headers }
  );
  return await res.json();
}

async function addOrUpdateNumber(phone, name, isSpam, spamScore) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_contacts`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ phone_number: phone, name, is_spam: isSpam, spam_score: spamScore })
  });
  return res.ok;
}

async function deleteNumber(phone) {
  const encoded = encodeURIComponent(`eq.${phone}`);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_contacts?phone_number=${encoded}`,
    { method: 'DELETE', headers }
  );
  return res.ok;
}

async function updateSpamScore(phone, score) {
  const encoded = encodeURIComponent(`eq.${phone}`);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_contacts?phone_number=${encoded}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ spam_score: score, is_spam: score >= 70 })
    }
  );
  return res.ok;
}

// ─── لوحة المفاتيح ───────────────────────────────────────────

const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 الإحصائيات',         callback_data: 'stats'        }],
      [{ text: '🔍 بحث عن رقم',         callback_data: 'search'       }],
      [{ text: '➕ إضافة رقم محظور',    callback_data: 'add'          }],
      [{ text: '🗑️ حذف رقم',            callback_data: 'delete'       }],
      [{ text: '⚡ تعديل درجة السبام',  callback_data: 'edit_score'   }],
      [{ text: '📋 آخر الأرقام المضافة',callback_data: 'recent'       }],
    ]
  }
};

const backBtn = [[{ text: '🔙 القائمة الرئيسية', callback_data: 'main' }]];

// ─── /start ──────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'صديقي';
  bot.sendMessage(msg.chat.id,
    `👋 أهلاً ${name}!\n\nأنا بوت لوحة تحكم *كاشف الأرقام* 🛡️\nاختر من القائمة:`,
    { parse_mode: 'Markdown', ...mainMenu }
  );
});

// ─── Callbacks (الأزرار) ─────────────────────────────────────

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const data   = query.data;

  bot.answerCallbackQuery(query.id);

  // ── القائمة الرئيسية ──
  if (data === 'main') {
    userState[chatId] = null;
    bot.editMessageText('اختر من القائمة:', {
      chat_id: chatId, message_id: msgId, ...mainMenu
    });
    return;
  }

  // ── الإحصائيات ──
  if (data === 'stats') {
    bot.editMessageText('⏳ جاري التحميل...', { chat_id: chatId, message_id: msgId });
    try {
      const { total, spam, top } = await getStats();
      let topText = top.map((r, i) =>
        `${i+1}. \`${r.phone_number}\` — ${r.name} (${r.spam_score}%)`
      ).join('\n') || 'لا يوجد';

      bot.editMessageText(
        `📊 *إحصائيات قاعدة البيانات*\n\n` +
        `👥 إجمالي الأرقام: *${total}*\n` +
        `🚫 أرقام سبام: *${spam}*\n` +
        `✅ أرقام موثوقة: *${total - spam}*\n\n` +
        `🔥 *أعلى درجات سبام:*\n${topText}`,
        {
          chat_id: chatId, message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: backBtn }
        }
      );
    } catch (e) {
      bot.editMessageText('❌ خطأ في الاتصال بقاعدة البيانات', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: backBtn }
      });
    }
    return;
  }

  // ── آخر الأرقام ──
  if (data === 'recent') {
    bot.editMessageText('⏳ جاري التحميل...', { chat_id: chatId, message_id: msgId });
    try {
      const numbers = await getRecentNumbers(10);
      if (!numbers.length) {
        bot.editMessageText('📋 لا توجد أرقام في القاعدة', {
          chat_id: chatId, message_id: msgId,
          reply_markup: { inline_keyboard: backBtn }
        });
        return;
      }
      const text = numbers.map((r, i) =>
        `${i+1}. \`${r.phone_number}\`\n` +
        `    👤 ${r.name} | 🔥 ${r.spam_score}% | ${r.is_spam ? '🚫 سبام' : '✅ موثوق'}`
      ).join('\n\n');

      bot.editMessageText(`📋 *آخر 10 أرقام مضافة:*\n\n${text}`, {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      });
    } catch (e) {
      bot.editMessageText('❌ خطأ في التحميل', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: backBtn }
      });
    }
    return;
  }

  // ── بحث عن رقم ──
  if (data === 'search') {
    userState[chatId] = { step: 'search_phone' };
    bot.editMessageText(
      '🔍 *بحث عن رقم*\n\nأرسل رقم الهاتف:',
      {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      }
    );
    return;
  }

  // ── إضافة رقم ──
  if (data === 'add') {
    userState[chatId] = { step: 'add_phone' };
    bot.editMessageText(
      '➕ *إضافة رقم محظور*\n\nأرسل رقم الهاتف:',
      {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      }
    );
    return;
  }

  // ── حذف رقم ──
  if (data === 'delete') {
    userState[chatId] = { step: 'delete_phone' };
    bot.editMessageText(
      '🗑️ *حذف رقم*\n\nأرسل رقم الهاتف اللي تبي تحذفه:',
      {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      }
    );
    return;
  }

  // ── تعديل درجة السبام ──
  if (data === 'edit_score') {
    userState[chatId] = { step: 'edit_phone' };
    bot.editMessageText(
      '⚡ *تعديل درجة السبام*\n\nأرسل رقم الهاتف:',
      {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      }
    );
    return;
  }

  // ── تأكيد الحذف ──
  if (data.startsWith('confirm_delete_')) {
    const phone = data.replace('confirm_delete_', '');
    const ok = await deleteNumber(phone);
    bot.editMessageText(
      ok ? `✅ تم حذف الرقم \`${phone}\` بنجاح` : '❌ فشل الحذف',
      {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      }
    );
    userState[chatId] = null;
    return;
  }

  // ── اختيار درجة السبام ──
  if (data.startsWith('score_')) {
    const parts = data.split('_');
    const score = parseInt(parts[1]);
    const phone = parts.slice(2).join('_');
    const ok = await updateSpamScore(phone, score);
    bot.editMessageText(
      ok
        ? `✅ تم تحديث درجة السبام للرقم \`${phone}\` إلى *${score}%*\n${score >= 70 ? '🚫 صار سبام' : '✅ موثوق'}`
        : '❌ فشل التحديث',
      {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      }
    );
    userState[chatId] = null;
    return;
  }

  // ── نوع الرقم عند الإضافة ──
  if (data.startsWith('type_')) {
    const parts  = data.split('_');
    const isSpam = parts[1] === 'spam';
    const phone  = parts.slice(2).join('_');
    const state  = userState[chatId];
    if (!state) return;

    const ok = await addOrUpdateNumber(phone, state.name, isSpam, isSpam ? 85 : 10);
    bot.editMessageText(
      ok
        ? `✅ تم إضافة الرقم \`${phone}\`\n👤 ${state.name}\n${isSpam ? '🚫 مصنّف سبام' : '✅ مصنّف موثوق'}`
        : '❌ فشلت الإضافة',
      {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backBtn }
      }
    );
    userState[chatId] = null;
    return;
  }
});

// ─── معالجة الرسائل النصية (خطوات متعددة) ───────────────────

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();
  const state  = userState[chatId];
  if (!state || !text) return;

  // ── بحث: استلام الرقم ──
  if (state.step === 'search_phone') {
    userState[chatId] = null;
    const results = await searchNumber(text);
    if (!results.length) {
      bot.sendMessage(chatId,
        `🔍 الرقم \`${text}\` غير موجود في القاعدة`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: backBtn } }
      );
      return;
    }
    const r = results[0];
    bot.sendMessage(chatId,
      `🔍 *نتيجة البحث*\n\n` +
      `📞 الرقم: \`${r.phone_number}\`\n` +
      `👤 الاسم: ${r.name}\n` +
      `🔥 درجة السبام: *${r.spam_score}%*\n` +
      `${r.is_spam ? '🚫 مصنّف: سبام' : '✅ مصنّف: موثوق'}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: backBtn } }
    );
    return;
  }

  // ── إضافة: استلام الرقم ──
  if (state.step === 'add_phone') {
    userState[chatId] = { ...state, step: 'add_name', phone: text };
    bot.sendMessage(chatId, `👤 أرسل اسم صاحب الرقم \`${text}\`:`, {
      parse_mode: 'Markdown'
    });
    return;
  }

  // ── إضافة: استلام الاسم ──
  if (state.step === 'add_name') {
    userState[chatId] = { ...state, step: 'add_type', name: text };
    bot.sendMessage(chatId,
      `📋 نوع الرقم \`${state.phone}\`؟`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚫 سبام / محتال',   callback_data: `type_spam_${state.phone}` }],
            [{ text: '✅ موثوق / عادي',   callback_data: `type_safe_${state.phone}` }],
            [{ text: '🔙 إلغاء',          callback_data: 'main' }],
          ]
        }
      }
    );
    return;
  }

  // ── حذف: استلام الرقم ──
  if (state.step === 'delete_phone') {
    userState[chatId] = null;
    bot.sendMessage(chatId,
      `⚠️ هل أنت متأكد من حذف الرقم \`${text}\`؟`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ نعم، احذفه', callback_data: `confirm_delete_${text}` }],
            [{ text: '❌ لا، إلغاء',  callback_data: 'main'                   }],
          ]
        }
      }
    );
    return;
  }

  // ── تعديل درجة السبام: استلام الرقم ──
  if (state.step === 'edit_phone') {
    userState[chatId] = { ...state, step: 'edit_score_val', phone: text };
    bot.sendMessage(chatId,
      `⚡ اختر درجة السبام للرقم \`${text}\`:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '0% ✅ آمن',    callback_data: `score_0_${text}`  },
              { text: '30% 🟡 مشبوه', callback_data: `score_30_${text}` },
            ],
            [
              { text: '70% 🟠 سبام',  callback_data: `score_70_${text}` },
              { text: '99% 🔴 خطير',  callback_data: `score_99_${text}` },
            ],
            [{ text: '🔙 إلغاء', callback_data: 'main' }],
          ]
        }
      }
    );
    return;
  }
});

console.log('🤖 البوت شغّال...');
