const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CryptoMike Server v9 — firma oficial Bitunix' });
});

function signBitunix(apiKey, secret, nonce, timestamp, queryStr, bodyStr) {
  // digest = SHA256(nonce + timestamp + apiKey + queryParams + body)
  // sign   = SHA256(digest + secretKey)
  const digestInput = nonce + timestamp + apiKey + (queryStr || '') + (bodyStr || '');
  const digest = crypto.createHash('sha256').update(digestInput).digest('hex');
  const sign = crypto.createHash('sha256').update(digest + secret).digest('hex');
  return sign;
}

function buildQueryStr(params) {
  if (!params || Object.keys(params).length === 0) return '';
  // Ordenar por Key en ASCII ascendente y concatenar sin separadores
  return Object.keys(params).sort().map(k => k + params[k]).join('');
}

function buildBodyStr(obj) {
  if (!obj) return '';
  // Sin espacios - JSON.stringify por defecto no añade espacios
  return JSON.stringify(obj);
}

function bitunixCall(method, path, apiKey, secret, queryParams, bodyObj) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex').substring(0, 32);
    const bodyStr = buildBodyStr(bodyObj);
    const queryStr = buildQueryStr(queryParams);
    const sign = signBitunix(apiKey, secret, nonce, ts, queryStr, bodyStr);

    // Para GET con query params, añadirlos a la URL en orden normal
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

    console.log(`Bitunix ${method} ${path} | nonce:${nonce.substring(0,8)}... | queryStr:"${queryStr}" | bodyStr:"${bodyStr.substring(0,80)}"`);

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

// Posiciones
app.post('/bitunix/positions', async (req, res) => {
  const { apiKey, secret } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitunixCall('GET', '/api/v1/futures/position/get_pending_positions', apiKey, secret, {}, null);
    console.log('Positions:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Positions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Apalancamiento
app.post('/bitunix/leverage', async (req, res) => {
  const { apiKey, secret, symbol, leverage } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitunixCall('POST', '/api/v1/futures/account/change_leverage', apiKey, secret, null, {
      symbol,
      leverage: parseInt(leverage),
      marginCoin: 'USDT'
    });
    console.log('Leverage:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Leverage error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Ejecutar orden
app.post('/bitunix/order', async (req, res) => {
  const { apiKey, secret, symbol, side, qty, sl, tp } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const body = {
      symbol,
      qty: String(qty),
      side: side === 'LONG' ? 'BUY' : 'SELL',
      tradeSide: 'OPEN',
      orderType: 'MARKET',
      effect: 'GTC',
      reduceOnly: false
    };
    if (tp && parseFloat(tp) > 0) { body.tpPrice = String(tp); body.tpStopType = 'MARK'; }
    if (sl && parseFloat(sl) > 0) { body.slPrice = String(sl); body.slStopType = 'MARK'; }

    console.log('Order body:', JSON.stringify(body));
    const result = await bitunixCall('POST', '/api/v1/futures/trade/place_order', apiKey, secret, null, body);
    console.log('Order result:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Order error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Cerrar posición
app.post('/bitunix/close', async (req, res) => {
  const { apiKey, secret, symbol } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const result = await bitunixCall('POST', '/api/v1/futures/trade/flash_close_position', apiKey, secret, null, {
      symbol,
      side: 'BUY'
    });
    console.log('Close:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Close error:', e.message);
    res.status(500).json({ error: e.message });
  }
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
      port: 443,
      path: path,
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

app.post('/order', async (req, res) => {
  const { apiKey, secret, memo, symbol, side, size, sl, tp } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'Faltan credenciales' });
  try {
    const body = { symbol, side: side === 'LONG' ? 1 : 4, type: 'market', size: parseInt(size) };
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

app.listen(PORT, () => {
  console.log(`CryptoMike Server v7 running on port ${PORT}`);
});
