const TelegramBot = require('node-telegram-bot-api');

let bot = null;

const initBot = () => {
  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.warn('Warning: TELEGRAM_BOT_TOKEN is not configured. Telegram OTP will not work.');
    return null;
  }
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  console.log('Telegram bot initialized');
  return bot;
};

const getBot = () => {
  if (!bot) return initBot();
  return bot;
};

const sendOTP = async (chatId, code) => {
  const b = getBot();
  if (!b) {
    console.error('Telegram bot not initialized. Cannot send OTP.');
    return false;
  }
  try {
    const message = [
      '*Scholarship System - Verification Code*',
      '',
      `Your verification code is: \`${code}\``,
      '',
      'This code expires in ' + (process.env.OTP_EXPIRY_MINUTES || 10) + ' minutes.',
      'Do not share this code with anyone.'
    ].join('\n');

    await b.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    return true;
  } catch (error) {
    console.error('Failed to send Telegram OTP:', error.message);
    return false;
  }
};

const sendMessage = async (chatId, text) => {
  const b = getBot();
  if (!b) return false;
  try {
    await b.sendMessage(chatId, text);
    return true;
  } catch (error) {
    console.error('Failed to send Telegram message:', error.message);
    return false;
  }
};

const setupWebhook = (app, db) => {
  const b = getBot();
  if (!b) return;

  app.post('/auth/telegram-webhook', async (req, res) => {
    try {
      const update = req.body;

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        const phone = update.message.contact ? update.message.contact.phone_number : null;

        if (text === '/start' || text === '/start verify') {
          const keyboard = {
            reply_markup: {
              keyboard: [[{ text: 'Share My Phone Number', request_contact: true }]],
              one_time_keyboard: true,
              resize_keyboard: true
            }
          };
          await b.sendMessage(chatId, 'Welcome to Scholarship Bot!\n\nPlease share your phone number so we can send you a verification code.\n\nស្វាគមន៍មកកាន់ Scholarship Bot!\n\nសូមចែករំលែកលេខទូរស័ព្ទរបស់អ្នកដើម្បីទទួលបានកូដបញ្ជាក់។', keyboard);
        } else if (phone) {
          const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;
          try {
            // Remove old pending entry for this phone
            await db.query('DELETE FROM telegram_pending WHERE phone = ?', [normalizedPhone]);
            // Store new pending session
            await db.query(
              'INSERT INTO telegram_pending (phone, chat_id) VALUES (?, ?)',
              [normalizedPhone, String(chatId)]
            );
            // Also update users table if user already registered
            await db.query(
              'UPDATE users SET telegram_chat_id = ? WHERE phone = ?',
              [String(chatId), normalizedPhone]
            );
            await b.sendMessage(chatId, 'Phone number connected successfully!\n\nYou can now register on the website. Make sure to use this same phone number: ' + normalizedPhone + '\n\nលេខទូរស័ព្ទបានភ្ជាប់ជោគជ័យ!\n\nឥឡូវអ្នកអាចចុះឈ្មោះនៅគេហទំព័របាន។ សូមប្រើលេខទូរស័ព្ទដូចគ្នា៖ ' + normalizedPhone);
          } catch (err) {
            console.error('Error saving telegram session:', err.message);
            await b.sendMessage(chatId, 'An error occurred. Please try again later.');
          }
        }
      }

      res.sendStatus(200);
    } catch (error) {
      console.error('Telegram webhook error:', error);
      res.sendStatus(200);
    }
  });
};

module.exports = { initBot, getBot, sendOTP, sendMessage, setupWebhook };
