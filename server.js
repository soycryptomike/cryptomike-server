const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BITMART_BASE = 'https://api-cloud.bitmart.com';

// ═══════════════════════════
// FIRMA BITMART
// ═══════════════════════════
function signBitmart(timestamp, memo, body, secret) {
  const message = `${timestamp}#${memo}#${body}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// ═══════════════════════════
// HEALTH CHECK
// ═══════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CryptoMike BitMart Server running' });
});

// ═══════════════════════════
// OBTENER POSICIONES
// ═══════════════════════════
app.post('/positions', async (req, res) => {
  const { apiKey, secret, memo, symbol } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });

  const timestamp = Date.now().toString();
  const body = symbol ? JSON.stringify({ symbol }) : '';
  const sign = signBitmart(timestamp, memo || '', body, secret);

  try {
    const response = await axios.get(`${BITMART_BASE}/contract/private/position`, {
      headers: {
        'Content-Type': 'application/json',
        'X-BM-KEY': apiKey,
        'X-BM-TIMESTAMP': timestamp,
        'X-BM-SIGN': sign,
        ...(memo && { 'X-BM-MEMO': memo })
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ═══════════════════════════
// CONFIGURAR APALANCAMIENTO
// ═══════════════════════════
app.post('/leverage', async (req, res) => {
  const { apiKey, secret, memo, symbol, leverage, openType } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });

  const timestamp = Date.now().toString();
  const bodyData = JSON.stringify({
    symbol,
    leverage: leverage.toString(),
    open_type: openType || 'isolated'
  });
  const sign = signBitmart(timestamp, memo || '', bodyData, secret);

  try {
    const response = await axios.post(`${BITMART_BASE}/contract/private/submit-leverage`, bodyData, {
      headers: {
        'Content-Type': 'application/json',
        'X-BM-KEY': apiKey,
        'X-BM-TIMESTAMP': timestamp,
        'X-BM-SIGN': sign,
        ...(memo && { 'X-BM-MEMO': memo })
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ═══════════════════════════
// EJECUTAR ORDEN
// ═══════════════════════════
app.post('/order', async (req, res) => {
  const { apiKey, secret, memo, symbol, side, size, sl, tp } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });

  const timestamp = Date.now().toString();
  const bodyData = JSON.stringify({
    symbol,
    side: side === 'LONG' ? 1 : 4,
    type: 'market',
    size: parseInt(size),
    ...(tp && { preset_take_profit_price: tp.toString() }),
    ...(sl && { preset_stop_loss_price: sl.toString() })
  });
  const sign = signBitmart(timestamp, memo || '', bodyData, secret);

  try {
    const response = await axios.post(`${BITMART_BASE}/contract/private/submit-order`, bodyData, {
      headers: {
        'Content-Type': 'application/json',
        'X-BM-KEY': apiKey,
        'X-BM-TIMESTAMP': timestamp,
        'X-BM-SIGN': sign,
        ...(memo && { 'X-BM-MEMO': memo })
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ═══════════════════════════
// CERRAR POSICIÓN
// ═══════════════════════════
app.post('/close', async (req, res) => {
  const { apiKey, secret, memo, symbol } = req.body;
  if (!apiKey || !secret) return res.status(400).json({ error: 'API Key y Secret requeridos' });

  const timestamp = Date.now().toString();
  const bodyData = JSON.stringify({ symbol });
  const sign = signBitmart(timestamp, memo || '', bodyData, secret);

  try {
    const response = await axios.post(`${BITMART_BASE}/contract/private/cancel-all-order`, bodyData, {
      headers: {
        'Content-Type': 'application/json',
        'X-BM-KEY': apiKey,
        'X-BM-TIMESTAMP': timestamp,
        'X-BM-SIGN': sign,
        ...(memo && { 'X-BM-MEMO': memo })
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.listen(PORT, () => {
  console.log(`CryptoMike BitMart Server running on port ${PORT}`);
});
