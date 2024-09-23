const fs = require('fs');
const axios = require('axios');
let config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`, 'utf8'));
let cards = JSON.parse(fs.readFileSync(`${__dirname}/cards.json`, 'utf8'));

let workers = JSON.parse(fs.readFileSync(`${__dirname}/workers.json`, 'utf8'));;
let bot = () => {};

exports.init = (callback) => {
    bot = callback;
};

exports.save = () => {
    try {
        fs.writeFileSync(`${__dirname}/cards.json`, JSON.stringify(cards), 'utf8');
        fs.writeFileSync(`${__dirname}/workers.json`, JSON.stringify(workers), 'utf8');
    }
    catch (e) {
        console.log('[EP] save error: ' + e);
        return true;
    }
};

exports.add_card = (leocardId, chatId, callback) => {
    let card = cards[leocardId];
    if (card === undefined) {
        cards[leocardId] = {tg: [chatId]};
        checkCard(leocardId, async (result) => {
            if (result !== false) {
                if (cards[leocardId].tg.length === 1) {
                    delete cards[leocardId];
                }
                else {
                    card.tg.splice(card.tg.indexOf(chatId), 1)
                }
            }
            callback(result);
        }, chatId);
    }
    else if (card.tg.includes(chatId)){
        console.warn(`[EP] Користувач ${chatId} вже доданий до картки ${leocardId}`);
        callback('already');
        return;
    }
    else {
        if (!card.tg.includes(chatId)) card.tg.push(chatId);
        callback(false);
    }
};

exports.remove_card = (leocardId, chatId) => {
    let card = cards[leocardId];
    if (card === undefined) {
        console.warn(`[EP:warn] Користувач ${chatId} спробував видалити неіснуючу картку ${leocardId}`);
        return 'already';
    }
    let index = card.tg.indexOf(chatId);
    if (index !== -1) {
        let check = card.tg.splice(index, 1)[0];
        if (card.tg.length === 0) {
            delete cards[leocardId];
        }
        else if (check != chatId) {
            console.error(`[EP:error] З картки ${leocardId} видалено користувача ${check} замість ${chatId}`);
            card.tg.push(check);
            return 'asyncError';
        }
        return 'success';
    }
    else {
        console.warn(`[EP:warn] У картці ${leocardId} немає користувача ${chatId}`);
        return 'already';
    }
}

exports.getState = (leocardId) => {
    let temp = {...cards[leocardId]};
    delete temp.tg;
    return temp;
}

setInterval(checkBalance, config.pollingInterval * 60 * 1000);
//setInterval(checkBalance, 10 * 1000);
if (workers.length == 0) // створення першого воркера
	axios.post('https://api.easypay.ua/api/system/createApp', config.axios.params)
	.then(({data}) => {
		workers.push([data.appId, data.pageId]);
	})
	.catch((error) => {
		console.error(error);
	});


async function checkBalance() {
    let cardsArray = Object.keys(cards);
    let cardsLength = cardsArray.length;
    let workersAmount = workers.length;
    let needWorkers = Math.ceil(cardsLength / config.CardsPerWorker);
    let addWorkers = needWorkers - workersAmount;
    if (addWorkers > 0) {
        let workersPromises = [];
        for (let i = 0; i < addWorkers; i++) {
            workersPromises.push(axios.post('https://api.easypay.ua/api/system/createApp', config.axios.params)
            .then(({data}) => {
                workers.push([data.appId, data.pageId]);
            })
            .catch((error) => {
                console.error(error);
            }));
        }
        await Promise.all(workersPromises);
    }
    // to the second to last worker
    // -1 because the last worker may be not full
    let iter = needWorkers - 1;
    if (iter === -1) return;
    for (let i = 0; i < iter; i++) {
        workerDo(cardsArray, i, (i+1) * config.CardsPerWorker);
    }
    workerDo(cardsArray, iter, cardsLength);
}



async function workerDo(cardsArray, workerIndex, end) {
    if (workers[workerIndex] === undefined) {
        console.error(`[EP:workerDo404] ${cardsArray}, ${workerIndex}, ${end}`);
        return;
    }
    let axiosOptions = {
        headers: {
            ...config.axios.params.headers,
            AppId: workers[workerIndex][0],
            PageId: workers[workerIndex][1]
        }
    };
    let json = {...config.axios.jsonTemplate};
    let i = workerIndex * config.CardsPerWorker;
    async function loop() {
        if (i >= end) return;
        json.fields[0].fieldValue = cardsArray[i];
        axios.post('https://api.easypay.ua/api/genericPaymentFlow/check', json, axiosOptions)
        .then(({data}) => {
            let newBalance = data.accountInfo.Balance.split(' ')[0];
            if (isNaN(newBalance)) {
                console.warn(`[EP:warn] Не вдалося отримати баланс картки ${cardsArray[i]}`);
                return;
            }
            let card = cards[cardsArray[i]];
            if (card.balance != newBalance) {
                /* фікс для міфічних 0 грн на балансі
                   просто робим декілька перевірок щоб переконатись чи це справді так
                   ну якщо 0 так і залишиться, то це вже велика рідкість */
                if (newBalance === 0) {
                    if (card.zero === undefined) card.zero = 0; // якщо лічильник не існує, то створюєм
                    if (card.zero < config.zeroBalanceChecks) {
                        card.zero += 1;
                        i++;
                        setTimeout(loop, 800);
                        return;
                    }
                }
                else delete card.zero; // скидуєм лічильник якщо не нуль
                
                if (card.balance !== undefined) {
                    let diff = newBalance - card.balance;
                    card.tg.forEach(chatId => { // відправка сповіщення КОЖНОМУ tg користувачу
                        bot(chatId, cardsArray[i], newBalance, diff);
                    });
                }
                card.balance = newBalance;
            }
            card.type = data.accountInfo.Cardname;
            card.lastUpdate = Date.now();
            i++;
            setTimeout(loop, 800);
        })
        .catch((e) => {
            try {
                if (e.response.data.error.errorCode === "PAGE_NOT_FOUND") {
                    delete axiosOptions.headers.PageId;
                    axios.post('https://api.easypay.ua/api/system/createSession', null, axiosOptions)
                    .then(({data}) => {
                        workers[workerIndex][1] = data.pageId;
                        axiosOptions.headers.PageId = data.pageId;
                        loop();
                    })
                    .catch((e) => {
                        console.error("[EP:error] Не вдалося створити сторінку для сесії");
                    });
                }
            }
            catch {}
        });
    }
    loop();
}

async function checkCard(leocardId, callback) {
    let workerIndex = workers.length - 1;
    let axiosOptions = {
        headers: {
            ...config.axios.params.headers,
            AppId: workers[workerIndex][0],
            PageId: workers[workerIndex][1]
        }
    };
    let json = {...config.axios.jsonTemplate};
    json.fields[0].fieldValue = leocardId;

    axios.post('https://api.easypay.ua/api/genericPaymentFlow/check', json, axiosOptions)
    .then(({data}) => {
        let newBalance = data.accountInfo.Balance.split(' ')[0];
        if (isNaN(newBalance)) {
            console.warn(`[EP:warn] Не вдалося отримати баланс картки ${leocardId}`);
            callback('badBalance');
            return;
        }

        let card = cards[leocardId];
        card.type = data.accountInfo.Cardname;
        card.balance = newBalance;
        card.lastUpdate = Date.now();
        callback(false);
        return;
    })
    .catch((e) => {
        try {
            if (e.response.data.error.errorCode === "PAGE_NOT_FOUND") {
                delete axiosOptions.headers.PageId;
                axios.post('https://api.easypay.ua/api/system/createSession', null, axiosOptions)
                .then(({data}) => {
                    workers[workerIndex][1] = data.pageId;
                    axiosOptions.headers.PageId = data.pageId;
                    checkCard(leocardId, callback);
                })
                .catch((e) => {
                    console.error("[EP:error] Не вдалося створити сторінку для сесії " + workers[workerIndex][0]);
                    callback('serverProblem');
                    return;
                });
            }
            else if (e.response.data.error.errorCode === "PROVIDER_ERROR") {
                callback('invalidCardNumber');
                return;
            }
            else {
                callback(true);
                console.error("[EP:error] check failed: " + e);
                return;
            }
        }
        catch (ee) {
            callback(true);
            console.error("[EP:error] не вдалось отримати PageId: " + ee);
            return;
        }
    });
}