const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// ═══════════════════════════
// CONFIG
// ═══════════════════════════
const TELEGRAM_TOKEN = '8693040210:AAHRZmAnwDT1MMgIGZgtm0yxwXCUm-bCvFQ';
const TELEGRAM_CHAT_ID = '828991968';
const ADMIN_EMAIL = 'miguel.tradingm@gmail.com';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'cryptomike_admin_2026';

const DATA_FILE = '/tmp/cryptomike_users.json';

// ═══════════════════════════
// UTILIDADES
// ═══════════════════════════
function loadUsers() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch(e) {}
  return [];
}

function saveUsers(users) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
  } catch(e) {
    console.error('Error saving users:', e.message);
  }
}

// ═══════════════════════════
// SISTEMA DE CONTRASEÑA AUTOMÁTICA
// ═══════════════════════════
function getCurrentPassword() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const period = day <= 15 ? 1 : 2;
  
  const seed = `cryptomike_${year}_${month}_${period}_vip2026`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '23456789';
  let pass = '';
  for (let i = 0; i < 4; i++) pass += letters[parseInt(hash.substring(i*2, i*2+2), 16) % letters.length];
  for (let i = 4; i < 8; i++) pass += numbers[parseInt(hash.substring(i*2, i*2+2), 16) % numbers.length];
  
  return pass;
}

function getPasswordExpiry() {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  if (day <= 15) {
    return new Date(year, month, 16, 0, 0, 0);
  } else {
    return new Date(year, month + 1, 1, 0, 0, 0);
  }
}

function getDaysUntilExpiry() {
  const expiry = getPasswordExpiry();
  const now = new Date();
  const diff = expiry - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ═══════════════════════════
// NOTIFICACIONES
// ═══════════════════════════
function sendTelegram(message) {
  const text = encodeURIComponent(message);
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${text}&parse_mode=HTML`;
  
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(null));
  });
}

async function sendEmail(subject, body) {
  try {
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER || ADMIN_EMAIL, pass: process.env.EMAIL_PASS || '' }
    });
    await transporter.sendMail({ from: ADMIN_EMAIL, to: ADMIN_EMAIL, subject: `[CryptoMike VIP] ${subject}`, html: body });
  } catch(e) {}
}

// ═══════════════════════════
// HEALTH CHECK
// ═══════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CryptoMike VIP Server v25 (Removed BitMart - Clean Version)', password_expires_in_days: getDaysUntilExpiry() });
});

// ═══════════════════════════
// AUTH
// ═══════════════════════════
app.post('/auth', async (req, res) => {
  const { password, uid, exchange } = req.body;
  if (!password || !uid) return res.status(400).json({ success: false, error: 'Faltan datos' });
  
  const currentPass = getCurrentPassword();
  if (password.toUpperCase() !== currentPass.toUpperCase()) {
    return res.json({ success: false, error: 'Contraseña incorrecta o expirada' });
  }
  
  const users = loadUsers();
  const existingIndex = users.findIndex(u => u.uid === uid);
  const isNew = existingIndex < 0;
  
  const userData = {
    uid, exchange: exchange || 'desconocido',
    lastAccess: new Date().toISOString(),
    firstAccess: existingIndex >= 0 ? users[existingIndex].firstAccess : new Date().toISOString()
  };
  
  if (existingIndex >= 0) users[existingIndex] = userData; else users.push(userData);
  saveUsers(users);
  
  if (isNew) {
    await sendTelegram(`🆕 <b>Nuevo usuario CryptoMike VIP</b>\n\n👤 UID: <code>${uid}</code>\n📊 Exchange: ${exchange}`);
  }
  
  res.json({ success: true, daysUntilExpiry: getDaysUntilExpiry(), message: `Acceso concedido.` });
});

// ═══════════════════════════
// REGISTRO DE NUEVOS USUARIOS
// ═══════════════════════════
app.post('/registro', async (req, res) => {
  const { email, uid, exchange, telegramUser } = req.body;
  if (!email || !uid || !telegramUser) return res.status(400).json({ success: false, error: 'Faltan datos' });

  const cleanTelegram = telegramUser.startsWith('@') ? telegramUser : '@' + telegramUser;

  const msg = `📝 <b>NUEVA SOLICITUD DE REGISTRO</b>\n\n📧 Correo: <code>${email}</code>\n👤 UID: <code>${uid}</code>\n📊 Exchange: ${exchange}\n✈️ Telegram: ${cleanTelegram}\n\n<i>Revisa tu panel de referidos. Si todo está OK, mándale un correo dándole la bienvenida.</i>`;

  await sendTelegram(msg);

  res.json({ success: true, message: 'En 24/48h recibirás un correo por parte del equipo de CryptoMike.' });
});

// ═══════════════════════════
// BITUNIX CORE
// ═══════════════════════════
function signBitunix(apiKey, secret, nonce, timestamp, queryStr, bodyStr) {
  const digestInput = nonce + timestamp + apiKey + (queryStr || '') + (bodyStr || '');
  const digest = crypto.createHash('sha256').update(digestInput).digest('hex');
  return crypto.createHash('sha256').update(digest + secret).digest('hex');
}

function buildQueryStr(params) {
  if (!params || Object.keys(params).length === 0) return '';
  return Object.keys(params).sort().map(k => k + params[k]).join('');
}

function bitunixCall(method, path, apiKey, secret, queryParams, bodyObj) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex').substring(0, 32);
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const queryStr = buildQueryStr(queryParams);
    const sign = signBitunix(apiKey, secret, nonce, ts, queryStr, bodyStr);

    let fullPath = path;
    if (queryParams && Object.keys(queryParams).length > 0) {
      fullPath = `${path}?${new URLSearchParams(queryParams).toString()}`;
    }

    const req = https.request({
      hostname: 'fapi.bitunix.com', port: 443, path: fullPath, method: method,
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey, 'nonce': nonce, 'timestamp': ts, 'sign': sign, 'language': 'en-US' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); } });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.post('/bitunix/positions', async (req, res) => {
  const { apiKey, secret } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try { res.json(await bitunixCall('GET', '/api/v1/futures/position/get_pending_positions', apiKey, secret, {}, null)); } 
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/leverage', async (req, res) => {
  const { apiKey, secret, symbol, leverage } = req.body;
  try { res.json(await bitunixCall('POST', '/api/v1/futures/account/change_leverage', apiKey, secret, null, { symbol, leverage: parseInt(leverage), marginCoin: 'USDT' })); } 
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/orders', async (req, res) => {
  const { apiKey, secret } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    let orders = [];
    try { 
      const open = await bitunixCall('GET', '/api/v1/futures/trade/open_orders', apiKey, secret, {}, null); 
      if (open && open.data) orders = orders.concat(open.data.list || open.data); 
    } catch(e) {}
    try { 
      const plan = await bitunixCall('GET', '/api/v1/futures/trade/plan_open_orders', apiKey, secret, {}, null); 
      if (plan && plan.data) orders = orders.concat(plan.data.list || plan.data); 
    } catch(e) {}
    res.json({ code: 0, data: orders });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/order', async (req, res) => {
  const { apiKey, secret, symbol, side, qty, sl, tp, orderType, price, triggerPrice } = req.body;
  
  try {
    const body = {
      symbol,
      qty: String(qty),
      side: side === 'LONG' ? 'BUY' : 'SELL',
      tradeSide: 'OPEN',
      effect: 'GTC',
      reduceOnly: false
    };

    if (orderType === 'stop_market') {
      if (price && parseFloat(price) !== parseFloat(triggerPrice)) {
        body.orderType = 'STOP'; 
        body.price = String(price);
      } else {
        body.orderType = 'STOP_MARKET'; 
      }
      body.stopPrice = String(triggerPrice); 
    } else if (orderType === 'limit') {
      body.orderType = 'LIMIT';
      body.price = String(price);
    } else {
      body.orderType = 'MARKET';
    }

    if (tp && parseFloat(tp) > 0) { body.tpPrice = String(tp); body.tpStopType = 1; }
    if (sl && parseFloat(sl) > 0) { body.slPrice = String(sl); body.slStopType = 1; }
    
    res.json(await bitunixCall('POST', '/api/v1/futures/trade/place_order', apiKey, secret, null, body));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/close', async (req, res) => {
  const { apiKey, secret, symbol } = req.body;
  try { res.json(await bitunixCall('POST', '/api/v1/futures/trade/close_all_position', apiKey, secret, null, { symbol })); } 
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, async () => {
  console.log(`CryptoMike VIP Server running`);
  
  // Generamos la contraseña actual
  const currentPass = getCurrentPassword();
  
  // 1. La imprime en los logs de Render (por si acaso)
  console.log(`=================================`);
  console.log(`🔑 CONTRASEÑA ACTUAL: ${currentPass}`);
  console.log(`=================================`);
  
  // 2. Te la envía por mensaje a tu Telegram automáticamente
  await sendTelegram(`🔑 <b>SISTEMA REINICIADO / NUEVA QUINCENA</b>\n\nTu contraseña VIP actual es:\n<code>${currentPass}</code>\n\n<i>Cópiala y pégala en la web.</i>`);
});
