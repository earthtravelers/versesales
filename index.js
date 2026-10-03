// STUPIDS (Verse) sales notification bot
// Watches the collection contract on Ethereum and sends an email with the price for every secondary sale.
// Transfers without a payment (an owner moving the NFT to another wallet) are not sales and are not reported.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const nodemailer = require('nodemailer');

// ---------- Settings ----------
const CONTRACT = (process.env.CONTRACT || '0x00c2d197bc6a99c916b0b6bc405c23186ede7f1b').toLowerCase();
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'STUPIDS';
const RPC_URL = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com';
const POLL_MS = Number(process.env.POLL_SECONDS || 60) * 1000;
const CONFIRMATIONS = 2;          // skip blocks that may still be reorganized
const MAX_RANGE = 2000;           // max block range per RPC getLogs call
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');

const MAIL_TO = process.env.MAIL_TO;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend: without a verified domain it can only send to the address you signed up with.
const MAIL_FROM = process.env.MAIL_FROM || `${process.env.COLLECTION_NAME || 'STUPIDS'} Bot <onboarding@resend.dev>`;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (!MAIL_TO || (!RESEND_API_KEY && !(GMAIL_USER && GMAIL_APP_PASSWORD))) {
  console.error('Missing settings: MAIL_TO and RESEND_API_KEY are required (or GMAIL_USER + GMAIL_APP_PASSWORD for Gmail).');
  process.exit(1);
}

const ZERO = '0x0000000000000000000000000000000000000000';

// ---------- Ethereum ----------
const provider = new ethers.JsonRpcProvider(RPC_URL, 1, { staticNetwork: true });
const iface = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function tokenURI(uint256 tokenId) view returns (string)',
]);
const TRANSFER_TOPIC = iface.getEvent('Transfer').topicHash;
const nftContract = new ethers.Contract(CONTRACT, iface, provider);

// ---------- Email ----------
// Railway blocks SMTP outside the Pro plan, so the default is Resend (HTTPS API).
// Without RESEND_API_KEY, Gmail SMTP is used (e.g. when running on your own computer).
const gmail = RESEND_API_KEY ? null : nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  connectionTimeout: 20000,
});

async function deliver({ subject, text, html }) {
  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [MAIL_TO], subject, text, html }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    return;
  }
  await gmail.sendMail({ from: `"${COLLECTION_NAME} Bot" <${GMAIL_USER}>`, to: MAIL_TO, subject, text, html });
}

// ---------- State (remembers where it left off) ----------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastBlock: null, sent: [] };
  }
}
function saveState() {
  state.sent = state.sent.slice(-1000);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
const state = loadState();

// ---------- Helpers ----------
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const lc = (a) => (a || '').toLowerCase();
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ITEM_NAME = process.env.ITEM_NAME || COLLECTION_NAME;           // fallback name: "STUPIDS #<token id>"
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
// The same link in every email: the collection's activity (sales) page on Verse
const SALES_URL = process.env.SALES_URL || 'https://verse.works/series/stupids-by-demon-ego/activity';
const addrLink = (a) => `https://etherscan.io/address/${a}`;

const erc20 = new ethers.Interface([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);
const tokenInfo = new Map([[WETH, { symbol: 'WETH', decimals: 18 }]]);
async function tokenMeta(addr) {
  if (!tokenInfo.has(addr)) {
    const c = new ethers.Contract(addr, erc20, provider);
    const [symbol, decimals] = await Promise.all([c.symbol().catch(() => '?'), c.decimals().catch(() => 18)]);
    tokenInfo.set(addr, { symbol, decimals: Number(decimals) });
  }
  return tokenInfo.get(addr);
}

const fmt = (wei, decimals) => {
  const s = ethers.formatUnits(wei, decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

// The sale price is read from the transaction itself:
//  - Payer: whoever sent the transaction; if the seller sent it (accepting an offer), the buyer.
//  - ETH: the transaction value when the payer sent it. WETH etc.: token transfers out of the payer.
//  - Several NFTs in one transaction (sweep): the total is divided by the number of NFTs.
// No payment and the seller sent the transaction: not a sale but a wallet transfer -> null.
async function salePrice(log, seller, buyer) {
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(log.transactionHash),
    provider.getTransactionReceipt(log.transactionHash),
  ]);
  const sender = lc(tx.from);
  const payer = sender === lc(seller) ? lc(buyer) : sender;

  const totals = new Map(); // 'ETH' | token adresi -> toplam (bigint)
  if (sender === payer && tx.value > 0n) totals.set('ETH', tx.value);
  let items = 0;
  for (const l of receipt.logs) {
    if (l.topics[0] !== TRANSFER_TOPIC) continue;
    if (lc(l.address) === CONTRACT) {
      if (l.topics.length === 4 && lc(ethers.dataSlice(l.topics[1], 12)) !== ZERO) items++;
      continue;
    }
    if (l.topics.length !== 3) continue; // ERC20: from/to indexed, amount in data
    if (lc(ethers.dataSlice(l.topics[1], 12)) !== payer) continue;
    const token = lc(l.address);
    totals.set(token, (totals.get(token) || 0n) + BigInt(l.data));
  }

  if (!totals.size) {
    if (sender === lc(seller)) return null; // the owner moved the NFT to another wallet
    return { text: 'unknown (paid off-chain)' };
  }
  items = Math.max(items, 1);
  const parts = [];
  for (const [token, total] of totals) {
    const each = total / BigInt(items);
    if (token === 'ETH') parts.push(`${fmt(each, 18)} ETH`);
    else {
      const t = await tokenMeta(token);
      parts.push(`${fmt(each, t.decimals)} ${t.symbol}`);
    }
  }
  return { text: parts.join(' + ') + (items > 1 ? ` (avg. of ${items} items bought together)` : '') };
}

// The NFT's real name from its metadata. The token ID is not the number in the name
// (token 12 is "STUPIDS #73"), so "<ITEM_NAME> #<id>" is only a fallback.
const names = new Map();
function metadataUrl(uri) {
  if (uri.startsWith('ipfs://')) return IPFS_GATEWAY + uri.slice(7).replace(/^ipfs\//, '');
  if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
  return uri;
}
async function nftName(id) {
  if (names.has(id)) return names.get(id);
  try {
    const uri = await nftContract.tokenURI(id);
    let meta;
    const data = uri.match(/^data:application\/json(;base64)?,(.*)$/s);
    if (data) {
      meta = JSON.parse(data[1] ? Buffer.from(data[2], 'base64').toString('utf8') : decodeURIComponent(data[2]));
    } else {
      const res = await fetch(metadataUrl(uri), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);
      meta = await res.json();
    }
    if (meta && meta.name) {
      names.set(id, String(meta.name));
      return names.get(id);
    }
  } catch (err) {
    console.error(`Could not read the name of token ${id}:`, err.message);
  }
  return `${ITEM_NAME} #${id}`; // not cached: retried next time
}

// ---------- Notification ----------
async function sendSale(e) {
  const name = await nftName(e.tokenId);
  const link = SALES_URL;
  const subject = `${e.test ? '[TEST] ' : ''}${name} sold for ${e.price}`;
  const row = (label, value) =>
    `<tr><td style="color:#666;padding:4px 16px 4px 0;white-space:nowrap">${label}</td><td style="padding:4px 0">${value}</td></tr>`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <h2 style="margin:0">${COLLECTION_NAME}</h2>
      <div style="color:#666;margin:2px 0 14px">Sold on secondary</div>
      ${e.test ? '<div style="color:#b45309;margin:0 0 14px">Test email: example price and addresses, not a real sale.</div>' : ''}
      <table style="font-size:14px;border-collapse:collapse">
        ${row('Sale Price:', `<b>${e.price}</b>`)}
        ${row('NFT Name:', name)}
        ${row('Buyer:', `<a href="${addrLink(e.to)}" style="font-family:monospace">${short(e.to)}</a>`)}
        ${row('Seller:', `<a href="${addrLink(e.from)}" style="font-family:monospace">${short(e.from)}</a>`)}
        ${row('Link:', `<a href="${link}">${link}</a>`)}
      </table>
    </div>`;
  const text = [
    COLLECTION_NAME,
    'Sold on secondary',
    ...(e.test ? ['Test email: example price and addresses, not a real sale.'] : []),
    '',
    `Sale Price: ${e.price}`,
    `NFT Name: ${name}`,
    `Buyer: ${short(e.to)}`,
    `Seller: ${short(e.from)}`,
    `Link: ${link}`,
  ].join('\n');
  await deliver({ subject, text, html });
  console.log(`Email sent: ${subject}`);
}

// ---------- Watch loop ----------
async function poll() {
  const latest = await provider.getBlockNumber();
  const safe = latest - CONFIRMATIONS;

  if (state.lastBlock === null) {
    state.lastBlock = Number(process.env.START_BLOCK || safe);
    saveState();
    console.log(`Watching from block ${state.lastBlock}.`);
    return;
  }

  let from = state.lastBlock + 1;
  while (from <= safe) {
    const to = Math.min(from + MAX_RANGE - 1, safe);
    const logs = await provider.getLogs({ address: CONTRACT, topics: [TRANSFER_TOPIC], fromBlock: from, toBlock: to });

    for (const log of logs) {
      const key = `${log.transactionHash}:${log.index}`;
      if (state.sent.includes(key)) continue;
      const parsed = iface.parseLog(log);
      if (!parsed || lc(parsed.args.from) === ZERO) continue; // mints are not reported (secondary sales only)
      const price = await salePrice(log, parsed.args.from, parsed.args.to);
      if (price) {
        // a failed email throws, so the block is retried; emails already sent are not repeated
        await sendSale({ tokenId: parsed.args.tokenId.toString(), from: parsed.args.from, to: parsed.args.to, price: price.text });
      } else {
        console.log(`Not a sale (wallet transfer), skipped: #${parsed.args.tokenId} ${log.transactionHash}`);
      }
      state.sent.push(key);
      saveState();
    }
    state.lastBlock = to;
    saveState();
    from = to + 1;
  }
}

async function main() {
  console.log(`${COLLECTION_NAME} bot running — contract ${CONTRACT}, checking every ${POLL_MS / 1000} s.`);

  console.log(`Email via ${RESEND_API_KEY ? 'Resend' : 'Gmail SMTP'} → ${MAIL_TO}`);

  if ((process.env.TEST_MAIL || '').trim().toLowerCase() === 'true') {
    // Sample sale email in the real format (example price and addresses, real NFT name and link)
    try {
      await sendSale({
        test: true,
        tokenId: process.env.TEST_TOKEN_ID || '12',
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        price: '0.05 ETH',
      });
      console.log('Test email sent.');
    } catch (err) {
      console.error('Test email failed:', err.message);
    }
  }

  for (;;) {
    try {
      await poll();
    } catch (err) {
      console.error('Error (will retry next round):', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (require.main === module) main();

module.exports = { salePrice, sendSale, nftName, _provider: provider, _nft: nftContract };
