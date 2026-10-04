# STUPIDS sales notification bot

Watches the STUPIDS collection contract on Ethereum (`0x00c2…7f1b`) and sends an email for every
**secondary sale**, with the sale price.

Example email:

```
Subject: STUPIDS Collection Piece Sold For 0.05 ETH

STUPIDS
Sold on secondary

Sale Price: 0.05 ETH
Buyer: 0x2222…2222
Seller: 0x1111…1111
Link: https://verse.works/series/stupids-by-demon-ego/activity
```

- **Price** is read from the transaction itself. It can be ETH bought on a marketplace, an accepted
  WETH offer (the full price including fees), or the average price per item when several NFTs were
  bought together.
- **Transfers without a payment** (an owner moving an NFT to another wallet) are not sales and are
  not emailed.
- A sale paid off-chain (for example, by card) is still emailed, with the price shown as "unknown".

## 1. Email setup

**Resend (recommended, works on Railway):**

1. Create a free account at <https://resend.com> and create an API key.
2. Set `RESEND_API_KEY`. Without a verified domain, Resend can only send to the email address you
   signed up with. Use that address as `MAIL_TO`.

**Gmail (only when running on your own computer; Railway blocks SMTP):**

1. Turn on 2-Step Verification for your Google account.
2. Go to <https://myaccount.google.com/apppasswords>, create an app password, and copy the 16
   characters without spaces.
3. Set `GMAIL_USER` and `GMAIL_APP_PASSWORD`.

## 2. Deploy on Railway

1. Railway → **New Project** → **Deploy from GitHub** → select this repository.
2. Under **Variables**, enter the values from `.env.example`. At minimum, set `MAIL_TO` and
   `RESEND_API_KEY`.
3. If `TEST_MAIL=true`, the bot sends a sample sale email (marked `[TEST]`, example price and addresses) on start. Once it
   arrives, set `TEST_MAIL` to `false`.
4. Optional: add a Volume and set `STATE_FILE=/data/state.json`. With this, a redeploy continues
   from where the bot stopped and does not skip sales.

## Run on your own computer

    cp .env.example .env   # fill in the values
    npm install
    npm start

## Notes

- The bot watches from the moment it starts and does not email past sales. To start from an
  earlier point, set `START_BLOCK` to a block number.
- Every email links to the collection's activity page on Verse. To change the link, set
  `SALES_URL`.
