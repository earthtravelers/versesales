// STUPIDS (Verse) satis bildirimi botu
// Ethereum'daki koleksiyon kontratini izler; her yeni mint (birincil satis) ve
// transfer (ikincil satis / cuzdan cekme) icin e-posta gonderir.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const nodemailer = require('nodemailer');

// ---------- Ayarlar ----------
const CONTRACT = (process.env.CONTRACT || '0x00c2d197bc6a99c916b0b6bc405c23186ede7f1b').toLowerCase();
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'STUPIDS';
const TOTAL = Number(process.env.TOTAL_SUPPLY || 200);
const RPC_URL = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com';
const POLL_MS = Number(process.env.POLL_SECONDS || 60) * 1000;
const CONFIRMATIONS = 2;          // yeniden duzenlenen bloklari atlamak icin
const MAX_RANGE = 2000;           // RPC getLogs blok araligi siniri
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const NOTIFY_TRANSFERS = process.env.NOTIFY_TRANSFERS !== 'false';

const MAIL_TO = process.env.MAIL_TO;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend: alan adi dogrulamadan yalnizca Resend hesabini actigin adrese gonderebilir.
const MAIL_FROM = process.env.MAIL_FROM || `${process.env.COLLECTION_NAME || 'STUPIDS'} Bot <onboarding@resend.dev>`;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (!MAIL_TO || (!RESEND_API_KEY && !(GMAIL_USER && GMAIL_APP_PASSWORD))) {
  console.error('Eksik ayar: MAIL_TO ve RESEND_API_KEY tanimli olmali (ya da Gmail icin GMAIL_USER + GMAIL_APP_PASSWORD).');
  process.exit(1);
}

const ZERO = '0x0000000000000000000000000000000000000000';

// ---------- Ethereum ----------
const provider = new ethers.JsonRpcProvider(RPC_URL, 1, { staticNetwork: true });
const iface = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function totalSupply() view returns (uint256)',
]);
const TRANSFER_TOPIC = iface.getEvent('Transfer').topicHash;
const contract = new ethers.Contract(CONTRACT, iface, provider);

// ---------- E-posta ----------
// Railway, Pro plan disinda SMTP'yi engelledigi icin varsayilan yol Resend (HTTPS API).
// RESEND_API_KEY yoksa Gmail SMTP kullanilir (bilgisayarda calistirirken).
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
    if (!res.ok) throw new Error(`Resend hatasi ${res.status}: ${await res.text()}`);
    return;
  }
  await gmail.sendMail({ from: `"${COLLECTION_NAME} Bot" <${GMAIL_USER}>`, to: MAIL_TO, subject, text, html });
}

// ---------- Durum (kaldigi yeri hatirlamak icin) ----------
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

// ---------- Yardimcilar ----------
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const blockTimes = new Map();
async function blockTime(n) {
  if (!blockTimes.has(n)) {
    const b = await provider.getBlock(n);
    blockTimes.set(n, b ? b.timestamp : Math.floor(Date.now() / 1000));
  }
  return new Date(blockTimes.get(n) * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
}
async function mintedCount() {
  try {
    return Number(await contract.totalSupply());
  } catch {
    return null; // kontrat totalSupply desteklemiyorsa
  }
}
const links = (id, tx) => ({
  verse: `https://verse.works/items/ethereum/${CONTRACT}/${id}`,
  opensea: `https://opensea.io/assets/ethereum/${CONTRACT}/${id}`,
  tx: `https://etherscan.io/tx/${tx}`,
});

// ---------- Bildirim ----------
async function sendMail(events) {
  const mints = events.filter((e) => e.type === 'mint');
  const transfers = events.filter((e) => e.type === 'transfer');
  const count = await mintedCount();

  const parts = [];
  if (mints.length) parts.push(`${mints.length} yeni mint`);
  if (transfers.length) parts.push(`${transfers.length} transfer`);
  const subject = `${COLLECTION_NAME}: ${parts.join(', ')}${count !== null ? ` (${count}/${TOTAL})` : ''}`;

  const rows = events.map((e) => {
    const l = links(e.tokenId, e.tx);
    const title = e.type === 'mint'
      ? `🟢 Yeni mint — #${e.tokenId}`
      : `🔁 Transfer — #${e.tokenId}`;
    const who = e.type === 'mint'
      ? `Alıcı: ${e.to}`
      : `Gönderen: ${e.from}<br>Alan: ${e.to}`;
    return `
      <div style="padding:14px 0;border-bottom:1px solid #eee">
        <div style="font-size:16px;font-weight:bold">${title}</div>
        <div style="color:#555;font-size:13px;margin:4px 0">${e.time}</div>
        <div style="font-size:13px;font-family:monospace">${who}</div>
        <div style="margin-top:6px;font-size:13px">
          <a href="${l.verse}">Verse</a> · <a href="${l.opensea}">OpenSea</a> · <a href="${l.tx}">Etherscan</a>
        </div>
      </div>`;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px">${COLLECTION_NAME}</h2>
      ${count !== null ? `<div style="color:#555">Toplam mint: <b>${count}/${TOTAL}</b></div>` : ''}
      ${rows}
      <div style="color:#999;font-size:11px;margin-top:12px">Kontrat: ${CONTRACT}</div>
    </div>`;

  const text = events.map((e) => {
    const l = links(e.tokenId, e.tx);
    return e.type === 'mint'
      ? `Yeni mint #${e.tokenId} — alıcı ${e.to} — ${e.time}\n${l.verse}\n${l.tx}`
      : `Transfer #${e.tokenId} — ${e.from} → ${e.to} — ${e.time}\n${l.verse}\n${l.tx}`;
  }).join('\n\n');

  await deliver({ subject, text, html });
  console.log(`E-posta gönderildi: ${subject}`);
}

// ---------- Izleme dongusu ----------
async function poll() {
  const latest = await provider.getBlockNumber();
  const safe = latest - CONFIRMATIONS;

  if (state.lastBlock === null) {
    state.lastBlock = Number(process.env.START_BLOCK || safe);
    saveState();
    console.log(`İzleme ${state.lastBlock}. bloktan başlıyor.`);
    return;
  }

  let from = state.lastBlock + 1;
  while (from <= safe) {
    const to = Math.min(from + MAX_RANGE - 1, safe);
    const logs = await provider.getLogs({ address: CONTRACT, topics: [TRANSFER_TOPIC], fromBlock: from, toBlock: to });

    const events = [];
    for (const log of logs) {
      const key = `${log.transactionHash}:${log.index}`;
      if (state.sent.includes(key)) continue;
      const parsed = iface.parseLog(log);
      if (!parsed) continue;
      const fromAddr = parsed.args.from.toLowerCase();
      const type = fromAddr === ZERO ? 'mint' : 'transfer';
      if (type === 'transfer' && !NOTIFY_TRANSFERS) continue;
      events.push({
        key,
        type,
        tokenId: parsed.args.tokenId.toString(),
        from: parsed.args.from,
        to: parsed.args.to,
        tx: log.transactionHash,
        time: await blockTime(log.blockNumber),
      });
    }

    if (events.length) {
      await sendMail(events);             // e-posta basarisiz olursa hata firlatir, blok ilerlemez
      state.sent.push(...events.map((e) => e.key));
    }
    state.lastBlock = to;
    saveState();
    from = to + 1;
  }
}

async function main() {
  console.log(`${COLLECTION_NAME} botu çalışıyor — kontrat ${CONTRACT}, her ${POLL_MS / 1000} sn kontrol.`);

  console.log(`E-posta yolu: ${RESEND_API_KEY ? 'Resend' : 'Gmail SMTP'} → ${MAIL_TO}`);

  if ((process.env.TEST_MAIL || '').trim().toLowerCase() === 'true') {
    try {
      await deliver({
        subject: `${COLLECTION_NAME} bot testi`,
        text: 'Bot çalışıyor. Yeni satışlarda bu adrese e-posta gelecek.',
        html: '<p>Bot çalışıyor. Yeni satışlarda bu adrese e-posta gelecek.</p>',
      });
      console.log('Test e-postası gönderildi.');
    } catch (err) {
      console.error('Test e-postası gönderilemedi:', err.message);
    }
  }

  for (;;) {
    try {
      await poll();
    } catch (err) {
      console.error('Hata (bir sonraki turda tekrar denenecek):', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
