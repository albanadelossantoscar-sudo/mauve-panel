'use strict';
// fetch con reintentos para 429 / 5xx. Nunca imprime tokens ni secretos.
async function pedir(url, opts = {}, intentos = 4) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status === 429 || r.status >= 500) { ultimo = new Error('HTTP ' + r.status); }
      else return r;
    } catch (e) { ultimo = e; }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1) ** 2 * (process.env.TEST_FAST ? 0.001 : 1)));
  }
  throw new Error('Falló la conexión: ' + (ultimo && ultimo.message));
}
module.exports = { pedir };
