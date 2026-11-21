# Mauve — Panel público

Panel de comercio de Mauve (ventas, productos, costos, márgenes, stock, embudo/tráfico y Meta Ads), publicado en GitHub Pages y actualizado cada hora por GitHub Actions.

- `compras.json`: compras, costos, tipo de cambio y productos. Es el único archivo que se edita a mano.
- `build.js` (+ `shopify.js`, `meta.js`, `http.js`, `mv.js`, `template.html`, `d3.min.js`): traen datos de Shopify y Meta, calculan y generan `site/index.html` y `site/data.json`. Si algo falla, no se publica nada.
- `.github/workflows/actualizar.yml`: cron horario, botón manual y publicación en Pages.

Secretos del repositorio (Settings > Secrets and variables > Actions): `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `META_ACCESS_TOKEN`. Nunca van en el código.
