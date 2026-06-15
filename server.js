const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// ═══════════════════════════
// UTILIDADES BITUNIX
// ═══════════════════════════
function signBitunix(apiKey, secret, nonce, timestamp, queryStr, bodyStr) {
  const digestInput = nonce + timestamp + apiKey + (queryStr || '') + (bodyStr || '');
  const digest = crypto.createHash('sha256').update(digestInput).digest('hex');
  return crypto.createHash('sha256').update(digest + secret).digest('hex');
}

function bitunixCall(method, path, apiKey, secret, queryParams, bodyObj) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex').substring(0, 32);
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const sign = signBitunix(apiKey, secret, nonce, ts, queryParams ? new URLSearchParams(queryParams).toString() : '', bodyStr);

    let fullPath = queryParams && Object.keys(queryParams).length > 0 ? `${path}?${new URLSearchParams(queryParams).toString()}` : path;

    const req = https.request({
      hostname: 'fapi.bitunix.com', port: 443, path: fullPath, method: method,
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey, 'nonce': nonce, 'timestamp': ts, 'sign': sign, 'language': 'en-US' }
    }, (res) => {
      let data = ''; res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); } });
    });
    req.on('error', reject); if (bodyStr) req.write(bodyStr); req.end();
  });
}

// ═══════════════════════════
// UTILIDADES BITMART
// ═══════════════════════════
function signBitmart(secret, timestamp, memo, bodyStr) {
  const message = timestamp + '#' + (memo || '') + '#' + (bodyStr || '');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function bitmartCall(method, path, apiKey, secret, memo, bodyObj) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const headers = { 'Content-Type': 'application/json', 'X-BM-KEY': apiKey, 'X-BM-TIMESTAMP': timestamp, 'X-BM-SIGN': signBitmart(secret, timestamp, memo, bodyStr) };
    if (memo) headers['X-BM-MEMO'] = memo;
    
    const req = https.request({ hostname: 'api-cloud-v2.bitmart.com', port: 443, path, method, headers }, (res) => {
      let data = ''; res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); } });
    });
    req.on('error', reject); if (bodyStr) req.write(bodyStr); req.end();
  });
}

// ═══════════════════════════
// AUTH (SIMPLIFICADO POR ESPACIO)
// ═══════════════════════════
app.post('/auth', (req, res) => res.json({ success: true, daysUntilExpiry: 15 }));

// ═══════════════════════════
// RUTAS BITUNIX
// ═══════════════════════════
app.post('/bitunix/positions', async (req, res) => {
  const { apiKey, secret } = req.body;
  try { res.json(await bitunixCall('GET', '/api/v1/futures/position/get_pending_positions', apiKey, secret, {}, null)); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/leverage', async (req, res) => {
  const { apiKey, secret, symbol, leverage } = req.body;
  try { res.json(await bitunixCall('POST', '/api/v1/futures/account/change_leverage', apiKey, secret, null, { symbol, leverage: parseInt(leverage), marginCoin: 'USDT' })); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/bitunix/order', async (req, res) => {
  const { apiKey, secret, symbol, side, qty, sl, tp, orderType, price, triggerPrice } = req.body;
  try {
    const body = { symbol, qty: String(qty), side: side === 'LONG' ? 'BUY' : 'SELL', tradeSide: 'OPEN', effect: 'GTC', reduceOnly: false };
    if (orderType === 'stop_market') {
      body.orderType = 'LIMIT'; body.price = String(price); body.stopPrice = String(triggerPrice); body.effectType = 1; 
    } else if (orderType === 'limit') { body.orderType = 'LIMIT'; body.price = String(price); } else { body.orderType = 'MARKET'; }
    if (tp && parseFloat(tp) > 0) { body.tpPrice = String(tp); body.tpStopType = 1; }
    if (sl && parseFloat(sl) > 0) { body.slPrice = String(sl); body.slStopType = 1; }
    res.json(await bitunixCall('POST', '/api/v1/futures/trade/place_order', apiKey, secret, null, body));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// RUTAS NUEVAS PARA CONSULTAR ÓRDENES
app.post('/bitunix/orders', async (req, res) => {
  const { apiKey, secret } = req.body;
  try {
    let orders = [];
    try { const open = await bitunixCall('GET', '/api/v1/futures/trade/open_orders', apiKey, secret, {}, null); if (open && open.data) orders = orders.concat(open.data); } catch(e) {}
    try { const plan = await bitunixCall('GET', '/api/v1/futures/trade/plan_open_orders', apiKey, secret, {}, null); if (plan && plan.data) orders = orders.concat(plan.data); } catch(e) {}
    res.json({ code: 0, data: orders });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════
// RUTAS BITMART
// ═══════════════════════════
app.post('/positions', async (req, res) => {
  const { apiKey, secret, memo } = req.body;
  try { res.json(await bitmartCall('GET', '/contract/private/position', apiKey, secret, memo, null)); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/leverage', async (req, res) => {
  const { apiKey, secret, memo, symbol, leverage } = req.body;
  try { res.json(await bitmartCall('POST', '/contract/private/submit-leverage', apiKey, secret, memo, { symbol, leverage: String(leverage), open_type: 'isolated' })); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/order', async (req, res) => {
  const { apiKey, secret, memo, symbol, side, size, sl, tp, orderType, price, triggerPrice } = req.body;
  try {
    if (orderType === 'stop_market') {
       const body = { symbol, side: side === 'LONG' ? 1 : 4, type: 'market', size: parseInt(size), trigger_price: String(triggerPrice), executive_price: String(price || triggerPrice), price_way: 1, price_type: 1 };
       return res.json(await bitmartCall('POST', '/contract/private/submit-plan-order', apiKey, secret, memo, body));
    }
    const body = { symbol, side: side === 'LONG' ? 1 : 4, size: parseInt(size), type: orderType === 'limit' ? 'limit' : 'market' };
    if (orderType === 'limit') body.price = String(price);
    res.json(await bitmartCall('POST', '/contract/private/submit-order', apiKey, secret, memo, body));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// RUTAS NUEVAS PARA CONSULTAR ÓRDENES
app.post('/orders', async (req, res) => {
  const { apiKey, secret, memo } = req.body;
  try {
    let orders = [];
    try { const open = await bitmartCall('GET', '/contract/private/get-open-orders', apiKey, secret, memo, null); if (open && open.data) orders = orders.concat(open.data); } catch(e) {}
    try { const plan = await bitmartCall('GET', '/contract/private/get-plan-order', apiKey, secret, memo, null); if (plan && plan.data) orders = orders.concat(plan.data); } catch(e) {}
    res.json({ code: 1000, data: orders });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Server v16 running`));
