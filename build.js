'use strict';
// Uso: node src/build.js   (variables: SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, META_ACCESS_TOKEN)
// Si cualquier fuente falla, termina con error y NO escribe site/ (queda publicada la versión anterior).
const fs = require('fs'); const path = require('path');
const MV = require('./mv');
const shopify = require('./shopify'); const meta = require('./meta');
const raiz = __dirname;

function requerida(n) { const v = process.env[n]; if (!v) throw new Error(`Falta el secreto ${n}`); return v; }

function cargarCompras(cfg) {
  return cfg.compras.map((c, i) => ({ ...c, creado: c.creado || `${c.fecha}T00:00:00.${String(i).padStart(3, '0')}Z` }));
}
function validarCompras(cfg) {
  const nombres = cfg.productos.map((p) => p.nombre);
  for (const c of cfg.compras) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) throw new Error('compras.json: fecha inválida en ' + JSON.stringify(c));
    if (!nombres.includes(c.producto)) throw new Error('compras.json: producto desconocido "' + c.producto + '"');
    if (!(Number(c.costo_unitario) > 0)) throw new Error('compras.json: costo_unitario inválido en ' + c.id);
    if (!['desde', 'historico'].includes(c.modo)) throw new Error('compras.json: modo inválido en ' + c.id);
  }
  if (!(Number(cfg.tipo_cambio) > 0)) throw new Error('compras.json: tipo_cambio inválido');
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(raiz, 'compras.json'), 'utf8'));
  validarCompras(cfg); MV.configurar(cfg);
  const ahora = new Date(); const mvd = new Date(ahora.getTime() - 3 * 3600e3);
  const hoy = mvd.toISOString().slice(0, 10);
  const version = process.env.SHOPIFY_API_VERSION || '2026-10';
  const S = await shopify.obtener({ shop: requerida('SHOPIFY_SHOP'), id: requerida('SHOPIFY_CLIENT_ID'), secret: requerida('SHOPIFY_CLIENT_SECRET'), version, desde: cfg.shopify_desde, esperada: cfg.tienda_esperada });
  if (!S.lines.length) throw new Error('Shopify no devolvió pedidos: no se publica.');
  if (!S.funnelDia.length) throw new Error('Shopify no devolvió sesiones: no se publica.');
  const M = await meta.obtener({ cuenta: process.env.META_AD_ACCOUNT_ID || cfg.cuenta_meta, token: requerida('META_ACCESS_TOKEN'), version: process.env.META_API_VERSION || cfg.meta_api_version || 'v23.0', desde: cfg.meta_inicio, hasta: hoy });

  const compras = cargarCompras(cfg);
  const gastoPorCamp = new Map();
  for (const rows of Object.values(M.dias)) for (const c of rows) gastoPorCamp.set(c.id, (gastoPorCamp.get(c.id) || 0) + c.gasto);
  const metaRows = [...gastoPorCamp].map(([, g]) => ({ gasto_usd: g }));
  const R = MV.calcular({ lines: S.lines, compras, metaRows, tipoCambio: cfg.tipo_cambio });

  const fmt = new Intl.DateTimeFormat('es-UY', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Montevideo' });
  const data = {
    actualizado_en: fmt.format(ahora), actualizado_iso: ahora.toISOString(), tienda: S.tienda,
    config: { tipo_cambio: cfg.tipo_cambio, productos: cfg.productos, meta_inicio: cfg.meta_inicio, pendientes: cfg.pendientes },
    lines: S.lines, funnel: S.funnel, traffic: S.traffic, funnelDia: S.funnelDia, trafficDia: S.trafficDia,
    meta: { cuenta: M.cuenta, dias: M.dias }, compras,
    resumen: { ...R.tot, productos: R.productos.map(({ linea, ...p }) => p) },
  };
  const out = process.env.OUT_DIR || path.join(raiz, 'site');
  fs.mkdirSync(out, { recursive: true });
  const json = JSON.stringify(data);
  const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const html = tpl.replace('{{D3_JS}}', () => fs.readFileSync(path.join(raiz, 'd3.min.js'), 'utf8'))
    .replace('{{MV_JS}}', () => fs.readFileSync(path.join(__dirname, 'mv.js'), 'utf8'))
    .replace('{{DATA_JSON}}', () => json.replace(/</g, '\\u003c'));
  fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(data, null, 1));
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  console.log(`OK ${data.actualizado_en}: ${R.tot.pedidos_pagos} pedidos pagos, cobrado $${Math.round(R.tot.cobrado)}, Meta U$S ${(R.tot.meta_usd || 0).toFixed(2)}`);
}
main().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
