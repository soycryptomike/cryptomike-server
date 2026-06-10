const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BITMART_HOST = 'api-cloud.bitmart.com';

// ═══════════════════════════
// HEALTH CHECK
// ═══════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CryptoMike BitMart Server running v2' });
});

// ═══════════════════════════
// FIRMA BITMART
// ═══════════════════════════
function signBitmart(secret, timestamp, memo, body) {
  const message = `${timestamp}#${memo}#${body}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// ═══════════════════════════
// LLAMADA A BITMART
// ═══════════════════════════
function bitmartCall(method, path, apiKey, secret, memo, bodyObj) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const sign = signBitmart(secret, timestamp, memo || '', bodyStr);

    const headers = {
      'Content-Type': 'application/json',
      'X-BM-KEY': apiKey,
      'X-BM-TIMESTAMP': timestamp,
      'X-BM-SIGN': sign
    };
    if (memo) headers['X-BM-MEMO'] = memo;

    const options = {
      hostname: BITMART_HOST,
      port: 443,
      path: path,
      method: method,
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (e) => reject(e));

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ═══════════════════════════
// POSICIONES
// ═══════════════════════════
app.post('/positions', async (req, res) => {
  const { apiKey, secret, memo } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });
  try {
    const result = await bitmartCall('GET', '/contract/private/position', apiKey, secret, memo, null);
    console.log('Positions response:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Positions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════
// APALANCAMIENTO
// ═══════════════════════════
app.post('/leverage', async (req, res) => {
  const { apiKey, secret, memo, symbol, leverage, openType } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });
  try {
    const body = { symbol, leverage: String(leverage), open_type: openType || 'isolated' };
    const result = await bitmartCall('POST', '/contract/private/submit-leverage', apiKey, secret, memo, body);
    console.log('Leverage response:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Leverage error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════
// EJECUTAR ORDEN
// ═══════════════════════════
app.post('/order', async (req, res) => {
  const { apiKey, secret, memo, symbol, side, size, sl, tp } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });
  try {
    const body = {
      symbol,
      side: side === 'LONG' ? 1 : 4,
      type: 'market',
      size: parseInt(size)
    };
    if (tp) body.preset_take_profit_price = String(tp);
    if (sl) body.preset_stop_loss_price = String(sl);

    console.log('Order body:', JSON.stringify(body));
    const result = await bitmartCall('POST', '/contract/private/submit-order', apiKey, secret, memo, body);
    console.log('Order response:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Order error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════
// CERRAR POSICIÓN
// ═══════════════════════════
app.post('/close', async (req, res) => {
  const { apiKey, secret, memo, symbol } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });
  try {
    const result = await bitmartCall('POST', '/contract/private/cancel-all-order', apiKey, secret, memo, { symbol });
    console.log('Close response:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch(e) {
    console.error('Close error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`CryptoMike BitMart Server v2 running on port ${PORT}`);
});
