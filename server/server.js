'use strict';
// Backend proprio do painel Terral (cozinha/caixa). Roda na VPS via pm2,
// atras do nginx em /terral/api/. Guarda os pedidos em um arquivo JSON local
// (orders.json, ao lado deste arquivo). Sem dependencias externas.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5190);
const PIN = process.env.TEAM_PIN || '1987';
const DATA_FILE = path.join(__dirname, 'orders.json');
const MAX_BODY = 2 * 1024 * 1024;

function loadOrders() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}
function saveOrders(orders) {
  fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(orders));
  fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
}
let orders = loadOrders();

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Team-Pin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
const checkPin = req => (req.headers['x-team-pin'] || '') === PIN;

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Team-Pin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    return res.end();
  }
  let url;
  try { url = new URL(req.url, 'http://internal'); } catch { return send(res, 400, { error: 'bad_request' }); }
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // POST /orders  -> cliente cria/atualiza um pedido (sem PIN: uso publico do cardapio)
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'orders') {
      const body = await readBody(req);
      const o = body && body.order;
      if (!o || !o.code) return send(res, 400, { error: 'invalid_order' });
      orders[o.code] = o;
      saveOrders(orders);
      return send(res, 200, { ok: true });
    }
    // GET /orders?status=a,b,c -> painel lista pedidos (exige PIN da equipe)
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'orders') {
      if (!checkPin(req)) return send(res, 401, { error: 'unauthorized' });
      const statuses = (url.searchParams.get('status') || '').split(',').filter(Boolean);
      const list = Object.values(orders)
        .filter(o => !statuses.length || statuses.includes(o.status))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      return send(res, 200, { orders: list });
    }
    // GET /orders/:code -> um pedido (exige PIN)
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'orders') {
      if (!checkPin(req)) return send(res, 401, { error: 'unauthorized' });
      const o = orders[parts[1]];
      if (!o) return send(res, 404, { error: 'not_found' });
      return send(res, 200, { order: o });
    }
    // POST /orders/:code/pay -> caixa confirma pagamento (exige PIN)
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'orders' && parts[2] === 'pay') {
      if (!checkPin(req)) return send(res, 401, { error: 'unauthorized' });
      const o = orders[parts[1]];
      if (!o) return send(res, 404, { error: 'not_found' });
      o.status = 'pago';
      o.paidAt = Date.now();
      orders[parts[1]] = o;
      saveOrders(orders);
      return send(res, 200, { order: o });
    }
    send(res, 404, { error: 'not_found' });
  } catch {
    send(res, 500, { error: 'server_error' });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('terral-api ouvindo em 127.0.0.1:' + PORT));
