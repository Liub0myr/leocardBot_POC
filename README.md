# leocardBot
Telegram bot for the leocard transport card that allows you to conveniently check the balance and receive notifications about balance changes.

## How it works?
After adding a unique card id, it is added to *modules/tgManager/easyPay/cards.json*. Periodically, the bot checks the balance of all cards in this json via the EasyPay API, which was obtained by reverse engineering. Later, I found and downloaded the file *EasyPayMerchantApi(Beta1.0).docx* from the Internet archive. Although the API described there is slightly different from the modern one, everything is basically the same.

When you send a top-up request, the server returns payment details and the current card balance. However, if you send too many such requests, the server will refuse to serve you. That's why I split the requests into different Appids so that EasyPay seems like it's not one user, but hundreds of different ones (as you know, many ISPs use NAT).
If the balance has changed since the last check, the user receives a notification about this.
If another user adds an card id that is already present in cards.json, the server will simply attach another user to the already existing card.

## What does POC mean?
According to the system documentation, there are no limits on the number of API requests, but they must be divided into Apps. This surprised me a lot, and I decided to test it in practice by quickly creating a **proof of concept** prototype. That is why I don't use any databases, it is impossible to change the localization, and some comments in the code are written in Ukrainian    
As it turned out, only about 10k requests per day are available for one IP (an existing VM in Azure was used).
Apparently, due to the use of NAT by mobile operators, it is possible to bypass this limit using an LTE modem, but these are crutches, so I decided not to continue the development of this pet project.

## Does it make sense?
Due to EasyPay's limit of 10k requests per day, this bot can serve up to ~100 cards.
You will have to choose between the speed of notifications and the number of cards.
An example of calculating the number of generated requests per day

    10*(60/1)*24=14400

where
* 10 - the number of cards
* 1 - pollingInterval (see settings section)
* 60 - the number of minutes in an hour
* 24 - the number of hours in a day

Accordingly, if you want to serve 100 cards, then set pollingInterval to the value:

     100*60*24/9500=15.16

where
* 100 - the number of cards
* 9500 is the maximum number of requests per day

Notes:
* always round **UP** pollingInterval
* when the user adds a unique card id, the server sends a balance request, that's why I specified 9500 instead of 10000

## settings
The settings here are split into 3 separate files
* config.json
  * INSERT_YOUR_TELEGRAM_BOT_TOKEN_HERE
  * contains localization. since this is a prototype, I made only the Ukrainian localization without the possibility to change it
* modules/tgManager/config.json - not used (you can remove it)
* modules/tgManager/easyPay/config.json
  * zeroBalanceChecks - periodically, EasyPay returns 0.00 when checking the balance. In order to avoid false notifications about debiting and crediting of funds, the bot will ignore zero balance and only after a certain number of checks will notify the user about the zero balance
  * pollingInterval - the interval, in minutes, between the start of the server polling cycles for the balance of all cards
  * number of cards for one appid (appid is described in the EasyPay documentation)

## Console commands
* save - saves the bot's current state
* exit - saves the bot's current state and exits if the save was successful

**DO NOT use CTRL+C or other methods of closing, because in this case the server will not save the current state**