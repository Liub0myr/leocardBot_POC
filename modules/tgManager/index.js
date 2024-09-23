const fs = require('fs');
const provider = require('./easyPay/index.js');
const { get } = require('http');
let lastStates = JSON.parse(fs.readFileSync(`${__dirname}/lastStates.json`, 'utf8'));
//let config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`, 'utf8'));

async function logger(text, chatId) {
    console.log(text + " " + chatId);
}

exports.banned = (chatId) => {
    if (lastStates[chatId] === undefined) {
        lastStates[chatId] = [0, false, {}];
        return false;
    }
    return lastStates[chatId][1];
}

exports.status = (chatId) => {
    let cards = {};
    for (let key in lastStates[chatId][2]) {
        cards[key] = provider.getState(key);
        cards[key].notifications = lastStates[chatId][2][key].notifications;
    }
    return cards;
}

exports.state = {
    change: (chatId, state) => {
        try {
            lastStates[chatId][0] = state;
        }
        catch (e) {
            lastStates[chatId] = [state, false, {}];
            logger("Спроба присвоїти стан неіснуючому користувачу:", chatId);
        }
    },
    get: (chatId) => {
        if (lastStates[chatId] === undefined) {
            lastStates[chatId] = [0, false, {}];
            logger("Спроба отримати стан неіснуйочого користувача:", chatId);
            return 0;
        }
        return lastStates[chatId][0];
    }
};

exports.leocard = {
    list: (chatId) => {
        try {
            return Object.keys(lastStates[chatId][2]);
        }
        catch (e) {
            lastStates[chatId] = [0, false, {}];
            logger("Спроба отримати список карт для неіснуйочого користувача", chatId);
            return [];
        }
    },
    getParams: (chatId, id) => {
        return lastStates[chatId][2];
    },
    card: {
        add: async (chatId, id, callback) => {
            if (lastStates[chatId][2][id] !== undefined) {
                callback('already');
                return;
            }
            provider.add_card(id, chatId, async (result) => {
                if (result === false) {
                    lastStates[chatId][2][id] = {notifications: true};
                    callback(false);
                }
                else callback(result);
            });
        },
        remove: (chatId, id) => {
            const result = provider.remove_card(id, chatId);
            if (result === 'success' || result === 'already') delete lastStates[chatId][2][id];
            return result;
        },
        amount: (chatId) => {
            return Object.keys(lastStates[chatId][2]).length;
        }
    },
    notifications: {
        enable: (chatId, id) => {
            lastStates[chatId][2][id].notifications = true;
            return 'success';
        },
        disable: (chatId, id) => {
            lastStates[chatId][2][id].notifications = false;
            return 'success';
        },
        state: (chatId, id) => {
            return lastStates[chatId][2][id].notifications;
        }
    }
};

exports.save = () => {
    try {
        fs.writeFileSync(`${__dirname}/lastStates.json`, JSON.stringify(lastStates), 'utf8')
    }
    catch (e) {
        console.log('[tgManager] save error: ' + e);
        return true;
    }
}