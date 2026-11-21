'use strict';
const { pedir } = require('./http');
const base = () => process.env.META_BASE_URL || 'https://graph.facebook.com';
const num = (v) => Number(v) || 0;

async function paginar(url0, token) {
  const out = []; let url = url0;
  for (let i = 0; i < 500 && url; i++) {
    // El token va en el header, no en la URL, para que no aparezca en logs.
    const r = await pedir(url, { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Meta Ads: ${(j.error && j.error.message) || 'HTTP ' + r.status}`.slice(0, 300));
    out.push(...(j.data || []));
    url = j.paging && j.paging.next ? j.paging.next : null;
  }
  return out;
}

const elegir = (lista, orden) => {
  for (const t of orden) { const x = (lista || []).find((y) => y.action_type === t); if (x) return num(x.value); }
  return 0;
};
const ACC = {
  carrito: ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart'],
  pago: ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout'],
  compra: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'],
};

// Devuelve { dias: { 'YYYY-MM-DD': [filas por campaña] } } con las mismas filas que arma el panel (montos en USD).
async function obtener({ cuenta, token, version, desde, hasta, acciones }) {
  const A = acciones || ACC;
  const B = `${base()}/${version}/${cuenta}`;
  const camps = await paginar(`${B}/campaigns?fields=id,name,effective_status&limit=500`, token);
  const estado = new Map(camps.map((c) => [String(c.id), c.effective_status]));
  const ins = await paginar(`${B}/insights?level=campaign&time_increment=1&limit=500&fields=${encodeURIComponent('campaign_id,campaign_name,spend,impressions,clicks,reach,outbound_clicks,actions,action_values,date_start')}&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: hasta }))}`, token);
  const dias = {};
  for (let d = new Date(desde + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) dias[d.toISOString().slice(0, 10)] = [];
  for (const r of ins) {
    const dia = r.date_start;
    if (!dias[dia]) dias[dia] = [];
    dias[dia].push({
      id: String(r.campaign_id), campana: r.campaign_name, estado: estado.get(String(r.campaign_id)) || 'UNKNOWN',
      gasto: num(r.spend), impresiones: num(r.impressions), clics: num(r.clicks),
      salientes: num((r.outbound_clicks || []).reduce((s, x) => s + num(x.value), 0)), alcance: num(r.reach),
      carritos: elegir(r.actions, A.carrito), pagos: elegir(r.actions, A.pago), compras: elegir(r.actions, A.compra), valor: elegir(r.action_values, A.compra),
    });
  }
  return { cuenta, dias };
}
module.exports = { obtener };
