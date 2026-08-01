/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @abraxa/auth — H18 · Identidad
 *
 *  Quién entra, con qué empresa, y por qué el navegador no puede mentir.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo lo que hay aquí es PURO: sin React, sin Next, sin Express, sin base de
 *  datos y sin una sola cabecera HTTP escrita a mano. Lo que toca el mundo real
 *  —el handler de NextAuth, el transporte a la API, el sellado de cabeceras—
 *  vive en `apps/web`, porque el BFF es el único lugar del sistema donde poner
 *  una cabecera de identidad es correcto (y así lo dice la exención por ruta de
 *  `eslint.config.mjs`).
 *
 *  Ese corte no es estético. Es lo que hace que el aislamiento entre invitados
 *  se pueda PROBAR sin levantar Next, sin Google y sin Postgres: `empresaDe()`
 *  recibe un transporte, `decidir()` recibe una ruta, `sellarIdentidad()`
 *  recibe unas cabeceras. Ver `aislamiento.test.ts`.
 *
 *  Este barril NO lo importa `middleware.ts`: el middleware corre en el runtime
 *  Edge e importa sólo los módulos que necesita, para no arrastrar nada más.
 */

export {
  correosPermitidos,
  normalizarCorreo,
  puedeEntrar,
  type Entorno as EntornoDeAcceso,
} from './acceso';

export {
  baseDeLaApi,
  credencialesDeGoogle,
  diagnosticoDeIdentidad,
  origenAutorizado,
  secretoDeProxy,
  secretoDeSesion,
  uriDeRedireccion,
  type CredencialesDeGoogle,
  type Diagnostico,
  type Entorno,
} from './entorno';

export {
  empresaDe,
  type EmpresaResumen,
  type PeticionApi,
  type RespuestaApi,
  type ResultadoEmpresa,
  type Transporte,
} from './empresa';

export {
  decidir,
  esRutaDeDatos,
  esRutaPublica,
  normalizarRuta,
  PREFIJOS_PUBLICOS,
  RUTA_DE_ENTRADA,
  RUTAS_PUBLICAS,
  type Decision,
  type IdentidadVerificada,
} from './identidad';

export {
  DESTINO_POR_DEFECTO,
  destinoDeRedireccion,
  origenPublico,
  type CabecerasLeibles,
} from './redireccion';

export { FORMATO_SLUG, huella, nombreDeEmpresa, slugAlternativo, slugDeCorreo } from './slug';
