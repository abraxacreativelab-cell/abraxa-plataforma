/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Rotar la llave de cifrado, por lotes y sin apagar nada
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      # 1. Se agrega la llave nueva al entorno. Nada más.
 *      INTEGRATIONS_KEY_2="$(openssl rand -base64 32)"
 *
 *      # 2. Desde ese momento, lo que se conecte se cifra con la 2 y lo que ya
 *      #    estaba se sigue leyendo con la 1. El sistema no se entera.
 *
 *      # 3. Cuando dé la gana:
 *      node scripts/… rotate          (ver §10 del handoff: el enganche del bin)
 *
 *      # 4. Cuando `pendientesDeRotar()` dé 0, se retira INTEGRATIONS_KEY.
 *
 *  Rotar SIN versión obliga a lo contrario: descifrar todo y volver a cifrarlo
 *  en una sola operación, con el sistema detenido, y si falla a la mitad la
 *  base queda partida en dos mundos. Por eso `key_version` está desde el día
 *  uno y no "cuando haga falta rotar" — cuando haga falta ya es tarde.
 *
 *  ── `adminDb()` ────────────────────────────────────────────────────────────
 *
 *  Rotar es de la plataforma entera y no de una empresa. Igual que el repaso:
 *  la LISTA se lee sin contexto, y cada escritura vuelve al carril aislado con
 *  el contexto armado desde el `tenant_id` de la propia fila.
 */
import { pathToFileURL } from 'node:url';
import { adminDb } from '@abraxa/db';
import { aHex, deHex, tieneBytes } from '../crypto/bytea';
import { abrir, cerrar, hayLlave, nombreDeLlave, versionActual } from '../crypto/secret-box';
import { registrar } from '../events';
import { COLUMNAS, ahora, ataduraDe, contextoDelSistema, type FilaIntegracion } from '../store';

export interface ResumenRotacion {
  versionDestino: number;
  rotadas: number;
  fallidas: number;
  motivo?: string;
}

/** Cuántas filas siguen cifradas con una versión anterior a la actual. */
export async function pendientesDeRotar(): Promise<number> {
  const destino = versionActual();
  const { data, error } = await adminDb()
    .from('tenant_integrations')
    .select('id,key_version')
    .lt('key_version', destino);
  if (error) return 0;
  return (data ?? []).length;
}

/**
 * Re-cifra por lotes lo que quedó atrás.
 *
 * Una fila que no se puede descifrar —llave retirada antes de tiempo, dato
 * alterado— se cuenta como fallida y **se deja intacta**. Rotar no destruye lo
 * que no entiende: una credencial ilegible se vuelve a conectar en dos
 * minutos; una pisada con basura ya no se recupera.
 */
export async function rotar(o: { lote?: number } = {}): Promise<ResumenRotacion> {
  const destino = versionActual();
  const resumen: ResumenRotacion = { versionDestino: destino, rotadas: 0, fallidas: 0 };

  if (destino <= 1 || !hayLlave(destino)) {
    resumen.motivo =
      `No hay una versión más alta que la 1: agrega ${nombreDeLlave(2)} al entorno ` +
      '(openssl rand -base64 32) y vuelve a correr esto. Sin llave nueva no hay nada que rotar.';
    return resumen;
  }

  const lote = Math.min(Math.max(o.lote ?? 100, 1), 500);
  const cuando = ahora();
  // Las filas que no se pudieron descifrar: se saltan en la siguiente vuelta
  // para no quedarse dando círculos sobre las mismas.
  const atoradas = new Set<string>();

  for (;;) {
    const { data, error } = await adminDb()
      .from('tenant_integrations')
      .select(COLUMNAS)
      .lt('key_version', destino)
      .limit(lote);

    if (error) {
      resumen.motivo = `No se pudieron leer las filas por rotar: ${error.message}`;
      return resumen;
    }

    const filas = ((data ?? []) as FilaIntegracion[]).filter((f) => !atoradas.has(f.id));
    if (filas.length === 0) return resumen;

    for (const fila of filas) {
      // Una fila sin secreto (OAuth a medias, o revocada) sólo sube de versión:
      // no hay nada que re-cifrar y dejarla atrás la mantendría en la lista
      // para siempre.
      if (!tieneBytes(fila.secret_ct)) {
        await adminDb()
          .from('tenant_integrations')
          .update({ key_version: destino, updated_at: cuando })
          .eq('id', fila.id);
        resumen.rotadas += 1;
        continue;
      }

      const atadura = ataduraDe(fila.tenant_id, fila.provider);
      let claro: string;
      try {
        claro = abrir(
          {
            ct: deHex(fila.secret_ct),
            iv: deHex(fila.secret_iv),
            tag: deHex(fila.secret_tag),
            version: Number(fila.key_version) || 1,
          },
          atadura,
        );
      } catch {
        resumen.fallidas += 1;
        atoradas.add(fila.id);
        console.error('[integrations] no se pudo descifrar para rotar; se deja como está', {
          integrationId: fila.id,
          provider: fila.provider,
          keyVersion: fila.key_version,
        });
        continue;
      }

      const sobre = cerrar(claro, atadura);
      const { error: errorEscritura } = await adminDb()
        .from('tenant_integrations')
        .update({
          secret_ct: aHex(sobre.ct),
          secret_iv: aHex(sobre.iv),
          secret_tag: aHex(sobre.tag),
          key_version: sobre.version,
          updated_at: cuando,
        })
        .eq('id', fila.id);

      if (errorEscritura) {
        resumen.fallidas += 1;
        atoradas.add(fila.id);
        continue;
      }

      resumen.rotadas += 1;
      await registrar(contextoDelSistema(fila.tenant_id), {
        integrationId: fila.id,
        provider: fila.provider,
        type: 'rotate',
        // Ni el secreto ni la llave: sólo de qué versión a cuál.
        detail: { from: Number(fila.key_version) || 1, to: sobre.version },
        secretos: [claro],
      });
    }
  }
}

/**
 * Cuenta cuántas quedan por empresa, para el informe.
 *
 * Se mantiene aparte de `rotar()` porque contestar "¿ya puedo retirar la llave
 * vieja?" tiene que poder hacerse sin escribir nada.
 */
export async function pendientesPorEmpresa(): Promise<Record<string, number>> {
  const destino = versionActual();
  const { data, error } = await adminDb()
    .from('tenant_integrations')
    .select('id,tenant_id,key_version')
    .lt('key_version', destino);
  if (error) return {};

  const cuenta: Record<string, number> = {};
  for (const f of (data ?? []) as Array<{ tenant_id: string }>) {
    cuenta[f.tenant_id] = (cuenta[f.tenant_id] ?? 0) + 1;
  }
  return cuenta;
}

/**
 * ── Correrlo como comando ──────────────────────────────────────────────────
 *
 * Los paquetes no se compilan (se consumen como fuente), así que un `.ts` no se
 * ejecuta solo. Se bundlea con esbuild —que ya está instalado y es lo que usa
 * `apps/api`— y se corre con node. Sin `tsx`:
 *
 *     npx esbuild packages/integrations/src/bin/rotate.ts \
 *       --bundle --platform=node --format=esm --packages=external \
 *       --outfile=/tmp/rotate.mjs && node /tmp/rotate.mjs
 *
 *     node /tmp/rotate.mjs --dry    # sólo cuenta, no escribe
 *
 * El bloque de abajo sólo corre cuando el módulo ES el punto de entrada:
 * importarlo desde una prueba o desde el paquete no dispara nada.
 */
async function main(): Promise<void> {
  const soloContar = process.argv.includes('--dry');
  if (soloContar) {
    const pendientes = await pendientesDeRotar();
    console.warn(`[rotate] ${pendientes} credencial(es) por rotar a la v${versionActual()}`);
    console.warn('[rotate] por empresa:', await pendientesPorEmpresa());
    return;
  }

  const r = await rotar();
  console.warn('[rotate]', r);
  // Fallar ruidosamente: una rotación con filas que no se pudieron descifrar no
  // es un éxito, y un cron que la da por buena esconde justo lo que hay que ver.
  if (r.fallidas > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e: unknown) => {
    console.error('[rotate] falló', e);
    process.exitCode = 1;
  });
}
