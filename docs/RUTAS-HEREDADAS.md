# Rutas heredadas que sobreviven, justificadas una por una

`/Volumes/FRAGUA/CLAUDE CODE` fue el workspace activo hasta el 2026-08-31 (bloque B0). Desde
entonces es **archivo histórico**: se consulta, no se construye ni se ejecuta desde ahí.

De las 50 ocurrencias que traía este repo, **48 se corrigieron**: estaban en los 18 handoffs de
carril `H1`…`H18` y no eran historia, eran instrucciones vivas que mandaban al constructor a un
worktree del disco viejo. Quedan **dos**, y no por descuido: viven en archivos de OTRO carril, y la
regla 1 del contrato de propiedad dice que no se escribe en el árbol ajeno. La corrección exacta
está redactada en `docs/handoffs/H0-rutas-heredadas.md` —de ahí las tres ocurrencias de ese
documento: son el diff que las borra—.

Este archivo vive en `docs/` —y no en la raíz— por la misma razón: la raíz es de `h1-fundacion`.

El esqueleto lo genera `--sellar`; el motivo lo pone una persona.

## Ejecutable — línea por línea

Clases admitidas: `patron-guardia` (la ruta es el dato de una lista de archivo/denegación),
`comentario` (prosa dentro de código que narra el defecto), `prueba-guardia` (una aserción que
exige que la ruta NO se use), `correccion-pendiente` (la ruta citada dentro del diff que la
corrige), `dato-historico` (un registro fechado).

| archivo | sha | clase | motivo |
|---|---|---|---|
| docs/handoffs/H0-rutas-heredadas.md | 7367a07bccdd | correccion-pendiente | Es el diff que corrige las otras dos ocurrencias: tiene que citar la ruta vieja para poder borrarla. Caduca sola cuando el dueño lo aplique. |
| docs/handoffs/H0-rutas-heredadas.md | 8e3778aec796 | correccion-pendiente | Es el diff que corrige las otras dos ocurrencias: tiene que citar la ruta vieja para poder borrarla. Caduca sola cuando el dueño lo aplique. |
| docs/handoffs/H0-rutas-heredadas.md | 6c64bf7a2f68 | correccion-pendiente | Es el diff que corrige las otras dos ocurrencias: tiene que citar la ruta vieja para poder borrarla. Caduca sola cuando el dueño lo aplique. |

## Historia — archivo por archivo, con su cuenta exacta

| archivo | ocurrencias | motivo |
|---|---|---|
| README.md | 1 | Pertenece a `h1-fundacion`, no a este carril. Corrección redactada en `docs/handoffs/H0-rutas-heredadas.md`; escribirla aquí rompería la regla 1 del contrato de propiedad. |
| apps/web/src/voz/README.md | 1 | Pertenece al carril de la voz. Misma razón y mismo handoff con la corrección exacta. |
