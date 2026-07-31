import { createApp } from './app';
import { PACKAGE_META } from './packages';

const port = Number(process.env.API_PORT ?? 3100);

const app = createApp();

app.listen(port, () => {
  const listos = PACKAGE_META.filter((p) => p.ready).length;
  console.warn(
    `[api] abraxa-plataforma escuchando en :${port} — ` +
      `${PACKAGE_META.length} paquetes importados, ${listos} con implementación`,
  );
});
