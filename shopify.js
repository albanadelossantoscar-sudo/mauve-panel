'use strict';
const { pedir } = require('./http');

const base = (shop) => process.env.SHOPIFY_BASE_URL || `https://${String(shop).trim().replace(/\.myshopify\.com$/, '')}.myshopify.com`;

async function token(shop, id, secret) {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: String(id).trim(), client_secret: String(secret).trim() }).toString();
  let url = `${base(shop)}/admin/oauth/access_token`;
  const pasos = [];
  let r;
  for (let i = 0; i < 4; i++) {
    r = await pedir(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    pasos.push(`${r.status} ${new URL(url).host}`);
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
    break;
  }
  if (!r.ok) {
    let detalle = '';
    try { const t = (await r.text()).replace(/\s+/g, ' '); const m = t.match(/<title>([^<]*)/); const p = t.match(/Oauth error[^<]*/); detalle = (p ? p[0] : (m ? m[1] : t)).slice(0, 300); } catch (e) { /* sin detalle */ }
    throw new Error(`Shopify no entregó el token (${pasos.join(' -> ')}): ${detalle}. Revisá SHOPIFY_SHOP, SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET, y que la app esté instalada en la tienda.`);
  }
  const j = await r.json();
  if (!j.access_token) throw new Error('Shopify respondió sin access_token.');
  return j.access_token;
}

function cliente(shop, tok, version) {
  const url = `${base(shop)}/admin/api/${version}/graphql.json`;
  return async function gql(query, variables) {
    const r = await pedir(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': tok }, body: JSON.stringify({ query, variables }) });
    if (!r.ok) throw new Error(`Shopify GraphQL HTTP ${r.status}`);
    const j = await r.json();
    if (j.errors) throw new Error('Shopify GraphQL: ' + JSON.stringify(j.errors).slice(0, 400));
    return j.data;
  };
}

const ORDERS = `query($after: String) { orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true) {
  pageInfo { hasNextPage endCursor }
  nodes { name createdAt displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet { shopMoney { amount } }
    lineItems(first: 5) { nodes { title quantity discountedTotalSet { shopMoney { amount } } } } } } }`;

// Mismas filas que arma el panel original (una por línea de pedido).
async function pedidos(gql) {
  const rows = []; let after = null;
  for (let pag = 0; pag < 200; pag++) {
    const d = await gql(ORDERS, { after });
    for (const n of d.orders.nodes) {
      const dia = new Date(Date.parse(n.createdAt) - 3 * 3600e3).toISOString().slice(0, 10);
      n.lineItems.nodes.forEach((l, i) => rows.push({
        pedido: n.name, linea: i + 1, dia, pago: n.displayFinancialStatus, envio: n.displayFulfillmentStatus,
        total: Number(n.currentTotalPriceSet.shopMoney.amount), articulo: l.title, cantidad: l.quantity, lista: Number(l.discountedTotalSet.shopMoney.amount),
      }));
    }
    if (!d.orders.pageInfo.hasNextPage) break;
    after = d.orders.pageInfo.endCursor;
  }
  return rows;
}

async function tabla(gql, q) {
  const d = await gql(`query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }`, { q });
  const r = d.shopifyqlQuery;
  if (!r) throw new Error('ShopifyQL no devolvió respuesta');
  if (r.parseErrors && r.parseErrors.length) throw new Error('ShopifyQL: ' + JSON.stringify(r.parseErrors).slice(0, 300));
  const names = r.tableData.columns.map((c) => c.name);
  return r.tableData.rows.map((row) => Array.isArray(row) ? Object.fromEntries(names.map((n, i) => [n, row[i]])) : row);
}

async function obtener({ shop, id, secret, version, desde, esperada }) {
  const tok = await token(shop, id, secret);
  const gql = cliente(shop, tok, version);
  const info = (await gql('{ shop { name myshopifyDomain } }')).shop;
  if (!new RegExp(esperada, 'i').test(info.name)) throw new Error(`La tienda de Shopify es "${info.name}", no ${esperada}. No se publica nada.`);
  const sq = (s) => `FROM sessions SHOW ${s} SINCE ${desde} UNTIL today`;
  const campos = 'sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate';
  return {
    tienda: info.name,
    lines: await pedidos(gql),
    funnel: await tabla(gql, sq(campos)),
    traffic: await tabla(gql, sq('sessions GROUP BY referrer_source')),
    funnelDia: await tabla(gql, `FROM sessions SHOW ${campos} TIMESERIES day SINCE ${desde} UNTIL today`),
    trafficDia: await tabla(gql, `FROM sessions SHOW sessions TIMESERIES day GROUP BY referrer_source SINCE ${desde} UNTIL today`),
  };
}
module.exports = { obtener };
