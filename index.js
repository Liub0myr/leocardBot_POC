const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const tgManager = require('./modules/tgManager/index.js');
const provider = require('./modules/tgManager/easyPay/index.js');

let config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const bot = new TelegramBot(config.token, {polling: {autoStart: true, interval: 1000}});
delete config.token;

let options = {
    parse_mode: "Markdown",
    reply_markup: {
      resize_keyboard: true,
      keyboard: [
        [{ text: config.localization.uk.keyboard.status}],
        [{ text: config.localization.uk.keyboard.add_card}, { text: config.localization.uk.keyboard.remove_card}],
        [{ text: config.localization.uk.keyboard.enable_notifications}, { text: config.localization.uk.keyboard.disable_notifications}],
        //[{ text: config.localization.uk.keyboard.help}]
      ],
      one_time_keyboard: true,
      //input_field_placeholder: '30000000001'
      //,remove_keyboard: true
      
    }
};

provider.init((chatId, cardId, newBalance, diff) => {
  if (tgManager.leocard.notifications.state(chatId, cardId) === true) {
    let text;
    if (diff > 0) {
      text = config.localization.uk.notifications.debit + diff;
    }
    else {
      text = config.localization.uk.notifications.credit + Math.abs(diff);
    }
    text += config.localization.uk.notifications.card + cardId + 
      config.localization.uk.notifications.balance + newBalance + ' ₴';
    try {
      bot.sendMessage(chatId, text, options);
    }
    catch (err) {
      console.error(`Помилка відправлення сповіщення користувачу ${chatId}:   `, err); 
    }
  } 
});

async function cardSelector(chatId, event) {
  let cardsList = tgManager.leocard.list(chatId);
  if (cardsList.length === 0) {
    bot.sendMessage(chatId, config.localization.uk.noCards, options);
    return;
  }
  let keyboard = {
    reply_markup: {
      resize_keyboard: true,
      inline_keyboard: [],
      one_time_keyboard: true
    }
  };
  cardsList.forEach((cardNumber) => {
    keyboard.reply_markup.inline_keyboard.push([{text: cardNumber, callback_data: `${event}.${cardNumber}`}]);
  });
  bot.sendMessage(chatId, config.localization.uk.chooseCard, keyboard);
}

function timestampToDate(timestamp) {
  let today = new Date(timestamp);
  let day = String(today.getDate()).padStart(2, '0');
  let month = String(today.getMonth() + 1).padStart(2, '0');
  let year = String(today.getFullYear()).slice(2);
  let hours = String(today.getHours()).padStart(2, '0');
  let minutes = String(today.getMinutes()).padStart(2, '0');
  let seconds = String(today.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds} ${day}.${month}.${year}` ;
}

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (chatId < 0) {
    bot.sendMessage(chatId, 'Бот не підтримує групові чати');
    return;
  }
  if (tgManager.banned(chatId)) {
    bot.sendMessage(chatId, 'Ви були забанені');
    return;
  }
  
  // Блок обробки команд
  if (msg.text === config.localization.uk.keyboard.status) {
    tgManager.state.change(chatId, 0);
    let data = tgManager.status(chatId);
    let text = config.localization.uk.status.header;
    for (let key in data) {
      text += config.localization.uk.status.number + key + '\n';
      if (data[key].balance !== undefined)
        text += `${config.localization.uk.status.balance} ${data[key].balance} ₴\n`;
      if (data[key].lastUpdate !== undefined)
        text += `${config.localization.uk.status.lastUpdate} ${timestampToDate(data[key].lastUpdate)}\n`;
      if (data[key].type !== undefined)
        text += `${config.localization.uk.status.type} ${data[key].type}\n`;
      if (data[key].notifications !== undefined)
        text += config.localization.uk.status.notifications[data[key].notifications];
      
      /*for (let item in config.state.list)
        if (data[key][item] !== undefined)
          text += `${config.localization.uk.status[item]} ${data[key][item]}\n`;*/
      
    }
    text += config.localization.uk.status.footer;
    bot.sendMessage(chatId, text, options);
  }
  else if (msg.text === config.localization.uk.keyboard.add_card) {
    if (tgManager.leocard.card.amount(chatId) >= 3) {
      bot.sendMessage(chatId, config.localization.uk.card.add.limit, options);
      return;
    }
    tgManager.state.change(chatId, 1);
    bot.sendMessage(chatId, config.localization.uk.enterCardNumber);
  }
  else if (msg.text === config.localization.uk.keyboard.remove_card) {
    tgManager.state.change(chatId, 0);
    cardSelector(chatId, 'card.remove');
    //tgManager.leocard.remove(chatId, cardNumber);
  }
  else if (msg.text === config.localization.uk.keyboard.enable_notifications) {
    tgManager.state.change(chatId, 0);
    cardSelector(chatId, 'notifications.enable');
  }
  else if (msg.text === config.localization.uk.keyboard.disable_notifications) {
    tgManager.state.change(chatId, 0);
    cardSelector(chatId, 'notifications.disable');
  }
  else if (/\/start/.test(msg.text)) {
    tgManager.state.change(chatId, 0);
    bot.sendMessage(chatId, config.localization.uk.welcome, options);
  }
  else if (msg.text === config.localization.uk.keyboard.help) {
    tgManager.state.change(chatId, 0);
    bot.sendMessage(chatId, config.localization.uk.help, options);
    // tgManager.save();
    // provider.save();
  }
  else {
    // Блок обробки станів
    const state = tgManager.state.get(chatId);
    if (state === 1) {
      const cardNumber = msg.text;
      if (/^\d{11,}$/.test(cardNumber)) {
        try {
          tgManager.state.change(chatId, 0);
          let messageId = 0;
          let promise = bot.sendMessage(chatId, config.localization.uk.card.add.wait, {parse_mode: "Markdown"})
          .then(message => {messageId = message.message_id;});
          
          tgManager.leocard.card.add(chatId, cardNumber, async (result) => {
            await promise;
            if (messageId !== 0) bot.deleteMessage(chatId, messageId);
            if (result === false) {
              bot.sendMessage(chatId, config.localization.uk.card.add.success, options);
            }
            else if (result === true) {
              tgManager.state.change(chatId, 1);
              bot.sendMessage(chatId, config.localization.uk.error);
            }
            else if (result === undefined) {
              tgManager.state.change(chatId, 0);
              bot.sendMessage(chatId, config.localization.uk.error, options);
              console.error(`undefined при додаванні при додаванні картки: ${cardNumber} користувачем ${chatId}`);
            }
            else {
              tgManager.state.change(chatId, 1);
              bot.sendMessage(chatId, config.localization.uk.card.add[result]);
            }
          });

          
        }
        catch (err) {
          bot.sendMessage(chatId, config.localization.uk.error);
          console.error(`Помилка блоку обробки станів `, err);
        }
      }
      else {
        bot.sendMessage(chatId, config.localization.uk.card.add.invalidCardNumber);
      }
    }
    else {
      bot.sendMessage(chatId, config.localization.uk.command404, options);
    }
  }
});


bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  if (chatId < 0) {
    bot.answerCallbackQuery(callbackQuery.id);
    bot.sendMessage(chatId, 'Бот не підтримує групові чати');
    return;
  }
  if (tgManager.banned(chatId)) {
    bot.answerCallbackQuery(callbackQuery.id);
    bot.sendMessage(chatId, 'Ви були забанені');
    return;
  }

  /*bot.editMessageText(callbackQuery.message.text,{
    chat_id: chatId,
    message_id: callbackQuery.message.message_id,
    inline_keyboard: []
  });*/
  
  let query = callbackQuery.data.split('.');
  
  try {
    if (tgManager.leocard[query[0]][query[1]] !== undefined) {
      let result = tgManager.leocard[query[0]][query[1]](chatId, query[2]);
      //bot.answerCallbackQuery(callbackQuery.id);
      bot.deleteMessage(chatId, callbackQuery.message.message_id);
      if (result === true) {
        bot.sendMessage(chatId, config.localization.uk.error, options);
      }
      else if (result === undefined) {
        console.warn(`undefined при ${query[0]}`);
        bot.sendMessage(chatId, config.localization.uk.error, options);
      }
      else {
        bot.sendMessage(chatId, config.localization.uk.queries[query[0]][query[1]][result] + query[2], options);
      }
    }
    
    else {
      bot.answerCallbackQuery(callbackQuery.id);
      bot.sendMessage(chatId, config.localization.uk.queries.notFound, options);
    }
  }
  catch {
    bot.answerCallbackQuery(callbackQuery.id);
    bot.sendMessage(chatId, config.localization.uk.error);
  }

});

process.stdin.on('data', (data) => {
  let command = data.toString().trim();
  switch(command) {
    case 'exit':
      if (tgManager.save() || provider.save()) console.warn("Закриття скасовано через помилку збереження даних");
      else process.exit(0);
      break;
    case 'save':
      if (tgManager.save() || provider.save()) console.warn("При збережені сталась помилка");
      else console.log("Збережено");
      break;
    default:
      console.log('Невідома команда');
      break;
  }
})