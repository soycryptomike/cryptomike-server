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
  res.json({ status: 'ok', message: 'CryptoMike VIP Server v25 (Removed Pionex - Clean Version)', password_expires_in_days: getDaysUntilExpiry() });
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
  const { email, uid, exchange } = req.body;
  if (!email || !uid) return res.status(400).json({ success: false, error: 'Faltan datos' });

  const msg = `📝 <b>NUEVA SOLICITUD DE REGISTRO</b>\n\n📧 Correo: <code>${email}</code>\n👤 UID: <code>${uid}</code>\n📊 Exchange: ${exchange}\n\n<i>Revisa tu panel de referidos. Si todo está OK, envíale la contraseña de la quincena.</i>`;

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

// ═══════════════════════════
// BITMART
// ═══════════════════════════
function signBitmart(secret, timestamp, memo, bodyStr) {
  const message = timestamp + '#' + (memo || '') + '#' + (bodyStr || '');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function bitmartCall(method, path, apiKey, secret, memo, bodyObj) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const sign = signBitmart(secret, timestamp, memo, bodyStr);
    const headers = { 'Content-Type': 'application/json', 'X-BM-KEY': apiKey, 'X-BM-TIMESTAMP': timestamp, 'X-BM-SIGN': sign };
    if (memo && memo.trim() !== '') headers['X-BM-MEMO'] = memo;
    
    const req = https.request({ hostname: 'api-cloud-v2.bitmart.com', port: 443, path, method, headers }, (res) => {
      let data = ''; res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); } });
    });
    req.on('error', reject); if (bodyStr) req.write(bodyStr); req.end();
  });
}

app.post('/positions', async (req, res) => {
  const { apiKey, secret, memo } = req.body;
  try { res.json(await bitmartCall('GET', '/contract/private/position', apiKey, secret, memo, null)); } 
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/leverage', async (req, res) => {
  const { apiKey, secret, memo, symbol, leverage, openType } = req.body;
  try { res.json(await bitmartCall('POST', '/contract/private/submit-leverage', apiKey, secret, memo, { symbol, leverage: String(leverage), open_type: openType || 'isolated' })); } 
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/orders', async (req, res) => {
  const { apiKey, secret, memo } = req.body;
  try {
    let orders = [];
    try { const open = await bitmartCall('GET', '/contract/private/get-open-orders', apiKey, secret, memo, null); if (open && open.data) orders = orders.concat(open.data); } catch(e) {}
    try { const plan = await bitmartCall('GET', '/contract/private/get-plan-order', apiKey, secret, memo, null); if (plan && plan.data) orders = orders.concat(plan.data); } catch(e) {}
    res.json({ code: 1000, data: orders });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/order', async (req, res) => {
  const { apiKey, secret, memo, symbol, side, size, sl, tp, orderType, price, triggerPrice } = req.body;
  
  try {
    if (orderType === 'stop_market') {
       const body = { 
         symbol, side: side === 'LONG' ? 1 : 4, type: 'market', size: parseInt(size),
         trigger_price: String(triggerPrice), executive_price: String(price || triggerPrice), price_way: 1, price_type: 1
       };
       if (tp && parseFloat(tp) > 0) body.preset_take_profit_price = String(tp);
       if (sl && parseFloat(sl) > 0) body.preset_stop_loss_price = String(sl);
       return res.json(await bitmartCall('POST', '/contract/private/submit-plan-order', apiKey, secret, memo, body));
    }

    const body = { symbol, side: side === 'LONG' ? 1 : 4, size: parseInt(size) };
    if (orderType === 'limit') { body.type = 'limit'; body.price = String(price); } else { body.type = 'market'; }
    if (tp && parseFloat(tp) > 0) body.preset_take_profit_price = String(tp);
    if (sl && parseFloat(sl) > 0) body.preset_stop_loss_price = String(sl);
    res.json(await bitmartCall('POST', '/contract/private/submit-order', apiKey, secret, memo, body));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/close', async (req, res) => {
  const { apiKey, secret, memo, symbol } = req.body;
  try { res.json(await bitmartCall('POST', '/contract/private/cancel-all-order', apiKey, secret, memo, { symbol })); } 
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
