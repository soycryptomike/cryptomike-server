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

// Archivo para guardar UIDs
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
      res.on('end', () => {
        console.log('Telegram sent:', data.substring(0, 100));
        resolve(data);
      });
    }).on('error', (e) => {
      console.error('Telegram error:', e.message);
      resolve(null);
    });
  });
}

async function sendEmail(subject, body) {
  try {
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER || ADMIN_EMAIL,
        pass: process.env.EMAIL_PASS || ''
      }
    });
    
    await transporter.sendMail({
      from: ADMIN_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[CryptoMike VIP] ${subject}`,
      html: body
    });
    console.log('Email sent');
  } catch(e) {
    console.error('Email error:', e.message);
  }
}

// ═══════════════════════════
// HEALTH CHECK
// ═══════════════════════════
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'CryptoMike VIP Server v11 (Plan Orders)',
    password_expires_in_days: getDaysUntilExpiry()
  });
});

// ═══════════════════════════
// VERIFICAR CONTRASEÑA + REGISTRAR UID
// ═══════════════════════════
app.post('/auth', async (req, res) => {
  const { password, uid, exchange } = req.body;
  
  if (!password || !uid) {
    return res.status(400).json({ success: false, error: 'Faltan datos' });
  }
  
  const currentPass = getCurrentPassword();
  
  if (password.toUpperCase() !== currentPass.toUpperCase()) {
    console.log(`Auth failed: uid=${uid}, password=${password}, expected=${currentPass}`);
    return res.json({ success: false, error: 'Contraseña incorrecta o expirada' });
  }
  
  const users = loadUsers();
  const existingIndex = users.findIndex(u => u.uid === uid);
  const userData = {
    uid,
    exchange: exchange || 'desconocido',
    lastAccess: new Date().toISOString(),
    firstAccess: existingIndex >= 0 ? users[existingIndex].firstAccess : new Date().toISOString()
  };
  
  const isNew = existingIndex < 0;
  if (existingIndex >= 0) {
    users[existingIndex] = userData;
  } else {
    users.push(userData);
  }
  saveUsers(users);
  
  if (isNew) {
    const msg = `🆕 <b>Nuevo usuario CryptoMike VIP</b>\n\n👤 UID: <code>${uid}</code>\n📊 Exchange: ${exchange}\n📅 Fecha: ${new Date().toLocaleString('es-ES')}\n\n✅ Acceso concedido`;
    await sendTelegram(msg);
    await sendEmail(
      `Nuevo usuario: ${uid}`,
      `<h2>Nuevo usuario en CryptoMike VIP</h2><p><b>UID:</b> ${uid}</p><p><b>Exchange:</b> ${exchange}</p><p><b>Fecha:</b> ${new Date().toLocaleString('es-ES')}</p>`
    );
  }
  
  res.json({ 
    success: true, 
    daysUntilExpiry: getDaysUntilExpiry(),
    message: `Acceso concedido. La contraseña expira en ${getDaysUntilExpiry()} días.`
  });
});

// ═══════════════════════════
// PANEL ADMIN — ver usuarios
// ═══════════════════════════
app.get('/admin/users', (req, res) => {
  const secret = req.headers['admin-secret'] || req.query.secret;
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  
  const users = loadUsers();
  const currentPass = getCurrentPassword();
  
  res.json({
    total_users: users.length,
    current_password: currentPass,
    password_expires_in_days: getDaysUntilExpiry(),
    password_expiry: getPasswordExpiry().toISOString(),
    users: users.sort((a, b) => new Date(b.lastAccess) - new Date(a.lastAccess))
  });
});

// ═══════════════════════════
// OBTENER CONTRASEÑA ACTUAL (solo admin)
// ═══════════════════════════
app.get('/admin/password', async (req, res) => {
  const secret = req.headers['admin-secret'] || req.query.secret;
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  
  const currentPass = getCurrentPassword();
  const daysLeft = getDaysUntilExpiry();
  
  const msg = `🔑 <b>Contraseña CryptoMike VIP</b>\n\n🗝️ Contraseña: <code>${currentPass}</code>\n⏱️ Expira en: ${daysLeft} días\n📅 Fecha consulta: ${new Date().toLocaleString('es-ES')}\n\n📢 Envía esta contraseña a tu canal VIP`;
  await sendTelegram(msg);
  
  res.json({
    password: currentPass,
    expires_in_days: daysLeft,
    expiry_date: getPasswordExpiry().toISOString()
  });
});

// ═══════════════════════════
// BITUNIX
// ═══════════════════════════
function signBitunix(apiKey, secret, nonce, timestamp, queryStr, bodyStr) {
  const digestInput = nonce + timestamp + apiKey + (queryStr || '') + (bodyStr || '');
  const digest = crypto.createHash('sha256').update(digestInput).digest('hex');
  const sign = crypto.createHash('sha256').update(digest + secret).digest('hex');
  return sign;
}

function buildQueryStr(params) {
  if (!params || Object.keys(params).length === 0) return '';
  return Object.keys(params).sort().map(k => k + params[k]).join('');
}

function buildBodyStr(obj) {
  if (!obj) return '';
  return JSON.stringify(obj);
}

function bitunixCall(method, path, apiKey, secret, queryParams, bodyObj) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex').substring(0, 32);
    const bodyStr = buildBodyStr(bodyObj);
    const queryStr = buildQueryStr(queryParams);
    const sign = signBitunix(apiKey, secret, nonce, ts, queryStr, bodyStr);

    let fullPath = path;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const urlParams = new URLSearchParams(queryParams).toString();
      fullPath = `${path}?${urlParams}`;
    }

    const headers = {
      'Content-Type': 'application/json',
      'api-key': apiKey,
      'nonce': nonce,
      'timestamp': ts,
      'sign': sign,
      'language': 'en-US'
    };

    console.log(`Bitunix ${method} ${path}`);

    const options = {
      hostname: 'fapi.bitunix.com',
      port: 443,
      path: fullPath,
      method: method,
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ raw: data }); }
      });
    });

    req.on('error', (e) => reject(e));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.post('/bitunix/positions', async (req, res) => {
  const { apiKey, secret } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitunixCall('GET', '/api/v1/futures/position/get_pending_positions', apiKey, secret, {}, null);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/leverage', async (req, res) => {
  const { apiKey, secret, symbol, leverage } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitunixCall('POST', '/api/v1/futures/account/change_leverage', apiKey, secret, null, {
      symbol, leverage: parseInt(leverage), marginCoin: 'USDT'
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🚀 EJECUCIÓN INTELIGENTE EN BITUNIX (CORREGIDO PARA PLAN ORDERS)
app.post('/bitunix/order', async (req, res) => {
  const { apiKey, secret, symbol, side, qty, sl, tp, orderType, price, triggerPrice } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  
  try {
    // 1. SI ES UNA ORDEN TRIGGER (Ruptura/Espera) -> Usamos "Plan Order"
    if (orderType === 'stop_market') {
       const planBody = {
         symbol,
         qty: String(qty),
         side: side === 'LONG' ? 'BUY' : 'SELL',
         tradeSide: 'OPEN',
         orderType: 'MARKET', // Cuando rompa el nivel, que ejecute a mercado
         triggerPrice: String(triggerPrice),
         triggerType: 'MARK'
       };

       if (tp && parseFloat(tp) > 0) { planBody.tpPrice = String(tp); planBody.tpStopType = 'MARK'; }
       if (sl && parseFloat(sl) > 0) { planBody.slPrice = String(sl); planBody.slStopType = 'MARK'; }

       const result = await bitunixCall('POST', '/api/v1/futures/trade/place_plan_order', apiKey, secret, null, planBody);
       return res.json(result);
    }

    // 2. SI ES UNA ORDEN NORMAL (Limit o Market) -> Usamos orden estándar
    const body = {
      symbol,
      qty: String(qty),
      side: side === 'LONG' ? 'BUY' : 'SELL',
      tradeSide: 'OPEN',
      effect: 'GTC',
      reduceOnly: false
    };

    if (orderType === 'limit') {
      body.orderType = 'LIMIT';
      body.price = String(price);
    } else {
      body.orderType = 'MARKET';
    }

    if (tp && parseFloat(tp) > 0) { body.tpPrice = String(tp); body.tpStopType = 'MARK'; }
    if (sl && parseFloat(sl) > 0) { body.slPrice = String(sl); body.slStopType = 'MARK'; }
    
    const result = await bitunixCall('POST', '/api/v1/futures/trade/place_order', apiKey, secret, null, body);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/close', async (req, res) => {
  const { apiKey, secret, symbol } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitunixCall('POST', '/api/v1/futures/trade/close_all_position', apiKey, secret, null, { symbol });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    const headers = {
      'Content-Type': 'application/json',
      'X-BM-KEY': apiKey,
      'X-BM-TIMESTAMP': timestamp,
      'X-BM-SIGN': sign
    };
    if (memo && memo.trim() !== '') headers['X-BM-MEMO'] = memo;
    const options = {
      hostname: 'api-cloud-v2.bitmart.com',
      port: 443, path, method, headers
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ raw: data }); }
      });
    });
    req.on('error', (e) => reject(e));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.post('/positions', async (req, res) => {
  const { apiKey, secret, memo } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitmartCall('GET', '/contract/private/position', apiKey, secret, memo, null);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/leverage', async (req, res) => {
  const { apiKey, secret, memo, symbol, leverage, openType } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitmartCall('POST', '/contract/private/submit-leverage', apiKey, secret, memo,
      { symbol, leverage: String(leverage), open_type: openType || 'isolated' });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🚀 EJECUCIÓN INTELIGENTE EN BITMART
app.post('/order', async (req, res) => {
  const { apiKey, secret, memo, symbol, side, size, sl, tp, orderType, price, triggerPrice } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  
  try {
    if (orderType === 'stop_market') {
       const body = { 
         symbol, 
         side: side === 'LONG' ? 1 : 4, 
         type: 'market', 
         size: parseInt(size),
         trigger_price: String(triggerPrice), 
         executive_price: String(price || triggerPrice),
         price_way: 1, 
         price_type: 1
       };
       if (tp && parseFloat(tp) > 0) body.preset_take_profit_price = String(tp);
       if (sl && parseFloat(sl) > 0) body.preset_stop_loss_price = String(sl);
       
       const result = await bitmartCall('POST', '/contract/private/submit-plan-order', apiKey, secret, memo, body);
       return res.json(result);
    }

    const body = { symbol, side: side === 'LONG' ? 1 : 4, size: parseInt(size) };
    
    if (orderType === 'limit') {
       body.type = 'limit';
       body.price = String(price);
    } else {
       body.type = 'market';
    }

    if (tp && parseFloat(tp) > 0) body.preset_take_profit_price = String(tp);
    if (sl && parseFloat(sl) > 0) body.preset_stop_loss_price = String(sl);
    
    const result = await bitmartCall('POST', '/contract/private/submit-order', apiKey, secret, memo, body);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/close', async (req, res) => {
  const { apiKey, secret, memo, symbol } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitmartCall('POST', '/contract/private/cancel-all-order', apiKey, secret, memo, { symbol });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

async function notifyPasswordOnStart() {
  const pass = getCurrentPassword();
  const days = getDaysUntilExpiry();
  const msg = `🚀 <b>CryptoMike VIP Server iniciado</b>\n\n🔑 Contraseña actual: <code>${pass}</code>\n⏱️ Expira en: ${days} días`;
  await sendTelegram(msg);
  console.log(`Server started. Current password: ${pass} (expires in ${days} days)`);
}

app.listen(PORT, () => {
  console.log(`CryptoMike VIP Server v11 running on port ${PORT}`);
  notifyPasswordOnStart();
});
