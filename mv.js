// ---- Lógica pura del panel (sin DOM) ----
const MV = {};
MV.PRODUCTOS = ['Corpiños Seamless', 'Bodys Premium', 'Remeras Siena', 'Body reductor', 'Body modelador'];
MV.PACK = { 'Corpiños Seamless': 3, 'Bodys Premium': 2, 'Remeras Siena': 2, 'Body reductor': 3, 'Body modelador': 2 };
MV.REGLAS = [['Corpiños Seamless', 'CORPI'], ['Body reductor', 'REDUCTOR'], ['Body modelador', 'MODELADOR'], ['Bodys Premium', 'BODY'], ['Remeras Siena', 'REME']];
MV.producto = (t) => { for (const [nombre, re] of MV.REGLAS) if (new RegExp(re, 'i').test(t)) return nombre; return null; };
// Configuración desde config/compras.json (productos: [{nombre, palabras_clave, prendas_por_pack, prioridad}])
MV.configurar = (cfg) => {
  if (cfg.productos && cfg.productos.length) {
    MV.PRODUCTOS = cfg.productos.map((p) => p.nombre);
    MV.PACK = Object.fromEntries(cfg.productos.map((p) => [p.nombre, p.prendas_por_pack]));
    MV.REGLAS = [...cfg.productos].sort((a, b) => (a.prioridad ?? 99) - (b.prioridad ?? 99)).map((p) => [p.nombre, p.palabras_clave]);
  }
  if (cfg.meta_inicio) MV.META_INICIO = cfg.meta_inicio;
};

MV.txt = (a) => typeof a === 'string' ? a : Array.isArray(a) ? a.map(MV.txt).join('\n') : a && typeof a === 'object' ? (a.text != null ? MV.txt(a.text) : a.content ? MV.txt(a.content) : JSON.stringify(a)) : String(a ?? '');
MV.find = (a, ok) => {
  if (a && typeof a === 'object' && !Array.isArray(a) && ok(a)) return a;
  const s = MV.txt(a);
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let d = 0, q = false, e = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (q) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') q = false; }
      else if (c === '"') q = true;
      else if (c === '{') d++;
      else if (c === '}' && --d === 0) { try { const o = JSON.parse(s.slice(i, j + 1)); if (ok(o)) return o; } catch (_) {} break; }
    }
  }
  return null;
};

MV.parseOrders = (result) => {
  const o = MV.find(result && result.content ? result.content : result, (x) => x.errors || (x.data && x.data.orders));
  if (!o) throw new Error('Shopify no devolvió pedidos');
  if (o.errors) throw new Error(o.errors.map((x) => x.message).join('; '));
  const rows = [];
  for (const n of o.data.orders.nodes) {
    const dia = new Date(Date.parse(n.createdAt) - 3 * 3600e3).toISOString().slice(0, 10);
    n.lineItems.nodes.forEach((l, i) => rows.push({
      pedido: n.name, linea: i + 1, dia,
      pago: n.displayFinancialStatus, envio: n.displayFulfillmentStatus,
      total: Number(n.currentTotalPriceSet.shopMoney.amount),
      articulo: l.title, cantidad: l.quantity, lista: Number(l.discountedTotalSet.shopMoney.amount),
    }));
  }
  return rows;
};
MV.parseTable = (result) => {
  const o = MV.find(result && result.content ? result.content : result, (x) => Array.isArray(x.columns) && Array.isArray(x.rows));
  if (!o) throw new Error('Shopify no devolvió la tabla');
  const names = o.columns.map((c) => c.name);
  return o.rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
};
MV.parseShop = (result) => {
  const s = MV.txt(result && result.content ? result.content : result);
  const m = s.match(/"name"\s*:\s*"([^"]+)"/) || s.match(/Shop:\s*"([^"]+)"/);
  return m ? m[1] : null;
};
MV.parseMeta = (result) => {
  const s = MV.txt(result && result.content ? result.content : result);
  const start = s.indexOf('## All Campaigns');
  if (start < 0) throw new Error('Meta Ads no devolvió la tabla de campañas');
  const rows = []; let header = null;
  for (const line of s.slice(start).split('\n').slice(1)) {
    const t = line.trim();
    if (t.startsWith('## ')) break;
    if (!t.startsWith('|')) continue;
    const cells = t.slice(1, -1).split('|').map((c) => c.trim());
    if (!header) { header = cells; continue; }
    if (cells.every((c) => /^-+$/.test(c))) continue;
    const get = (n) => cells[header.indexOf(n)];
    const num = (v) => Number(String(v ?? '').replace(/[$x,]/g, ''));
    rows.push({ campana: get('Campaign'), estado: get('Status'), gasto_usd: num(get('Spend')), roas: num(get('ROAS')), conversiones: num(get('Conversions')) });
  }
  return rows;
};

// Ventas: una fila por producto y pedido pago, con prendas físicas.
// Pedido con descuento sobre el total (promo vieja): cada unidad es una prenda. Pedido a precio de lista: cada unidad es un pack.
MV.ventas = (lines) => {
  const pagos = lines.filter((r) => r.pago === 'PAID' && r.total > 0);
  const porPedido = new Map();
  for (const r of pagos) { if (!porPedido.has(r.pedido)) porPedido.set(r.pedido, []); porPedido.get(r.pedido).push(r); }
  const out = [];
  for (const [pedido, ls] of porPedido) {
    const lista = ls.reduce((s, l) => s + l.lista, 0);
    const total = ls[0].total;
    const conDescuento = total < lista * 0.95;
    for (const l of ls) {
      const p = MV.producto(l.articulo);
      if (!p) continue;
      out.push({ pedido, dia: l.dia, producto: p, prendas: conDescuento ? l.cantidad : l.cantidad * (MV.PACK[p] || 1), cobrado: lista ? total * l.lista / lista : 0 });
    }
  }
  return out;
};

// Costos: cada compra con costo arma la línea de tiempo de su producto, en el orden en que se cargó.
// 'historico' reemplaza el costo de todas las fechas; 'desde' cambia el costo solo desde su fecha.
MV.lineaCostos = (compras) => {
  const porProd = new Map();
  const ordenadas = [...compras].filter((c) => c.costo_unitario > 0).sort((a, b) => String(a.creado).localeCompare(String(b.creado)));
  for (const c of ordenadas) {
    let tl = porProd.get(c.producto) || [];
    if (c.modo === 'historico') tl = [{ desde: null, costo: c.costo_unitario, id: c.id }];
    else {
      tl = tl.filter((s) => s.desde === null || s.desde < c.fecha);
      tl.push({ desde: c.fecha, costo: c.costo_unitario, id: c.id });
      tl.sort((a, b) => (a.desde === null ? '' : a.desde).localeCompare(b.desde === null ? '' : b.desde));
    }
    porProd.set(c.producto, tl);
  }
  return porProd;
};
MV.costoEn = (tl, dia) => {
  if (!tl || !tl.length) return null;
  let r = null;
  for (const s of tl) if (s.desde === null || s.desde <= dia) r = s;
  return r ? r.costo : tl[0].costo; // venta anterior al primer costo cargado: usa el más antiguo
};

MV.calcular = ({ lines, compras, metaRows, tipoCambio }) => {
  const ventas = lines ? MV.ventas(lines) : [];
  const tl = MV.lineaCostos(compras);
  const nombres = [...new Set([...MV.PRODUCTOS, ...compras.map((c) => c.producto), ...ventas.map((v) => v.producto)])];
  const productos = nombres.map((p) => {
    const vs = ventas.filter((v) => v.producto === p);
    const cs = compras.filter((c) => c.producto === p);
    const t = tl.get(p);
    let costoVendido = 0, sinCosto = 0;
    for (const v of vs) { const c = MV.costoEn(t, v.dia); if (c == null) sinCosto += v.prendas; else costoVendido += c * v.prendas; }
    const vendidas = vs.reduce((s, v) => s + v.prendas, 0);
    const cobrado = vs.reduce((s, v) => s + v.cobrado, 0);
    const compradas = cs.reduce((s, c) => s + (Number(c.unidades) || 0), 0);
    const costoCompras = cs.reduce((s, c) => s + (Number(c.unidades) || 0) * (Number(c.costo_unitario) || 0), 0);
    const costoActual = t && t.length ? t[t.length - 1].costo : null;
    const stock = compradas - vendidas;
    return {
      producto: p, pedidos: new Set(vs.map((v) => v.pedido)).size, vendidas, cobrado,
      costo_actual: costoActual, costo_vendido: costoVendido, sin_costo: sinCosto,
      margen: costoActual == null && vendidas ? null : cobrado - costoVendido,
      compradas, costo_compras: costoCompras, stock,
      valor_stock: stock > 0 && costoActual != null ? stock * costoActual : 0,
      linea: t || [],
    };
  }).filter((p) => p.vendidas || p.compradas || p.costo_actual != null || MV.PRODUCTOS.includes(p.producto))
    .sort((a, b) => b.cobrado - a.cobrado);

  const pedidos = lines ? [...new Map(lines.map((r) => [r.pedido, r])).values()] : [];
  const pagos = pedidos.filter((p) => p.pago === 'PAID' && p.total > 0);
  const vencidos = pedidos.filter((p) => p.pago === 'EXPIRED');
  const cobrado = pagos.reduce((s, p) => s + p.total, 0);
  const cmv = productos.reduce((s, p) => s + p.costo_vendido, 0);
  const metaUsd = metaRows ? metaRows.reduce((s, m) => s + m.gasto_usd, 0) : null;
  const metaPesos = metaUsd == null ? null : metaUsd * tipoCambio;
  const compras$ = productos.reduce((s, p) => s + p.costo_compras, 0);
  const valorStock = productos.reduce((s, p) => s + p.valor_stock, 0);
  const sinCostoProd = productos.filter((p) => p.sin_costo > 0);

  const dias = new Map();
  for (const p of pagos) { const d = dias.get(p.dia) || { dia: p.dia, cobrado: 0, pedidos: 0 }; d.cobrado += p.total; d.pedidos += 1; dias.set(p.dia, d); }
  const ventasDia = [];
  const todos = pedidos.map((p) => p.dia).sort();
  if (todos.length) {
    for (let d = new Date(todos[0] + 'T00:00:00Z'); d <= new Date(todos[todos.length - 1] + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      ventasDia.push(dias.get(k) || { dia: k, cobrado: 0, pedidos: 0 });
    }
  }
  return {
    productos, ventasDia, sinCostoProd,
    pendientes: lines ? lines.filter((r) => r.pago === 'PAID' && r.total > 0 && r.envio !== 'FULFILLED') : [],
    tot: {
      cobrado, pedidos_pagos: pagos.length, ticket: pagos.length ? cobrado / pagos.length : 0,
      pendientes: pagos.filter((p) => p.envio !== 'FULFILLED').length,
      vencidos: vencidos.length, monto_vencido: vencidos.reduce((s, p) => s + p.total, 0),
      cmv, margen: cobrado - cmv, margen_pct: cobrado ? (cobrado - cmv) / cobrado : 0,
      meta_usd: metaUsd, meta_pesos: metaPesos,
      resultado: metaPesos == null ? null : cobrado - cmv - metaPesos,
      compras: compras$, caja: metaPesos == null ? null : cobrado - compras$ - metaPesos,
      valor_stock: valorStock,
      patrimonial: metaPesos == null ? null : cobrado - compras$ - metaPesos + valorStock,
    },
  };
};

// ---------- Meta Ads por día ----------
MV.META_INICIO = '2026-10-22';
MV.parseMetaDia = (result) => {
  const s = MV.txt(result && result.content ? result.content : result);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Meta Ads no devolvió datos: ' + String(s).replace(/\s+/g, ' ').slice(0, 220));
  const j = JSON.parse(s.slice(a, b + 1));
  if (j.status && j.status !== 'success') return [];
  const num = (v) => Number(v) || 0;
  const acc = (c, k) => { const x = (c.conversion_actions || []).find((y) => y.action_type === k); return x ? { n: num(x.count), v: num(x.value) } : { n: 0, v: 0 }; };
  return (j.campaigns || []).map((c) => ({
    id: String(c.id), campana: c.name, estado: c.status, gasto: num(c.spend), impresiones: num(c.impressions), clics: num(c.clicks),
    salientes: num(c.outbound_clicks), alcance: num(c.reach), carritos: acc(c, 'add_to_cart').n, pagos: acc(c, 'initiate_checkout').n,
    compras: acc(c, 'purchase').n, valor: acc(c, 'purchase').v,
  }));
};
MV.metaCero = () => ({ gasto: 0, impresiones: 0, clics: 0, salientes: 0, alcance: 0, carritos: 0, pagos: 0, compras: 0, valor: 0, dias: 0 });
MV.metaSuma = (t, c) => { for (const k of ['gasto', 'impresiones', 'clics', 'salientes', 'alcance', 'carritos', 'pagos', 'compras', 'valor']) t[k] += c[k]; if (c.gasto > 0) t.dias += 1; return t; };
MV.metaDer = (t) => ({
  ...t,
  ctr: t.impresiones ? t.salientes / t.impresiones : null,
  cpm: t.impresiones ? t.gasto / t.impresiones * 1000 : null,
  cpc: t.salientes ? t.gasto / t.salientes : null,
  cpa: t.compras ? t.gasto / t.compras : null,
  roas: t.gasto ? t.valor / t.gasto : null,
});
// map: Map(dia -> filas de campañas); dias: días del período; estado: 'todas' | 'ACTIVE' | 'PAUSED'
MV.metaAgg = (map, dias, estado) => {
  const ult = new Map();
  for (const d of [...map.keys()].sort()) for (const c of map.get(d)) ult.set(c.id, { estado: c.estado, campana: c.campana });
  const por = new Map();
  for (const d of dias) for (const c of map.get(d) || []) {
    if (!por.has(c.id)) por.set(c.id, MV.metaCero());
    MV.metaSuma(por.get(c.id), c);
  }
  const rows = [...por].map(([id, t]) => ({ id, campana: ult.get(id).campana, estado: ult.get(id).estado, ...MV.metaDer(t) }))
    .filter((r) => estado === 'todas' || !estado || r.estado === estado);
  const tot = MV.metaCero();
  for (const r of rows) { for (const k of ['gasto', 'impresiones', 'clics', 'salientes', 'alcance', 'carritos', 'pagos', 'compras', 'valor']) tot[k] += r[k]; }
  tot.dias = new Set(dias.filter((d) => (map.get(d) || []).some((c) => c.gasto > 0 && rows.some((r) => r.id === c.id)))).size;
  return { rows, tot: MV.metaDer(tot) };
};
// Serie diaria de una métrica para una campaña (id) o para todas (id null). Día sin cargar => null.
MV.metaSerie = (map, dias, id, key, estado) => {
  const ult = new Map();
  for (const d of [...map.keys()].sort()) for (const c of map.get(d)) ult.set(c.id, c.estado);
  return dias.map((d) => {
    if (!map.has(d)) return null;
    const t = MV.metaCero();
    for (const c of map.get(d)) if ((id == null || c.id === id) && (id != null || !estado || estado === 'todas' || ult.get(c.id) === estado)) MV.metaSuma(t, c);
    const v = MV.metaDer(t)[key];
    return v == null ? null : v;
  });
};
if (typeof module !== 'undefined') module.exports = MV;

