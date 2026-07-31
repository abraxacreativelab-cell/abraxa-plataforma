/**
 * El worker. H1 deja el andamio; los handoffs registran sus colas.
 *
 * `batchSize: 1` es DELIBERADO y viene de GARDEN: con lotes, un paso que falla
 * arrastra a sus vecinos y los re-ejecuta. Un mensaje mandado dos veces al
 * cliente final de alguien es un error caro. No lo subas.
 *
 * Para registrar tu cola, expórtala desde TU paquete y añádela a `QUEUES` —
 * o mejor, llama a `registerQueue()` desde el index de tu paquete y no toques
 * este archivo.
 */
import PgBoss from 'pg-boss';

export interface QueueHandler {
  name: string;
  handler: (job: unknown) => Promise<void>;
  options?: { batchSize?: number; pollingIntervalSeconds?: number };
}

const cola: QueueHandler[] = [];

/** Lo llama cada paquete desde su propio index. Nadie edita este archivo. */
export function registerQueue(q: QueueHandler): void {
  cola.push(q);
}

export async function start(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL es obligatorio para el worker. Copia .env.example a .env.');
  }

  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (e) => console.error('[worker] pg-boss', e));
  await boss.start();

  for (const q of cola) {
    await boss.createQueue(q.name);
    await boss.work(q.name, { batchSize: 1, ...q.options }, async (jobs) => {
      for (const job of jobs) await q.handler(job);
    });
    console.warn(`[worker] cola activa: ${q.name}`);
  }

  console.warn(`[worker] arriba con ${cola.length} cola(s)`);
  return boss;
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((e: unknown) => {
    console.error('[worker] no arrancó', e);
    process.exit(1);
  });
}
