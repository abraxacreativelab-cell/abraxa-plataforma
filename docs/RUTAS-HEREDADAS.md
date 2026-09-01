# Rutas heredadas que sobreviven, justificadas una por una

`/Volumes/FRAGUA/CLAUDE CODE` fue el workspace activo hasta el 2026-08-31 (bloque B0). Desde
entonces es **archivo histórico**: se consulta, no se construye ni se ejecuta desde ahí.

De las 50 ocurrencias que traía este repo, **48 se corrigieron**: estaban en los 18 handoffs de
carril `H1`…`H18` y no eran historia, eran instrucciones vivas que mandaban al constructor a un
worktree del disco viejo. Quedan **dos**, y no por descuido: viven en archivos de OTRO carril, y la
regla 1 del contrato de propiedad dice que no se escribe en el árbol ajeno. La corrección exacta
está redactada en `docs/handoffs/H0-rutas-heredadas.md` para que la aplique su dueño.

Este archivo vive en `docs/` —y no en la raíz— por la misma razón: la raíz es de `h1-fundacion`.

## Ejecutable — línea por línea

Clases admitidas: `patron-guardia` (la ruta es el dato de una lista de archivo/denegación),
`comentario` (prosa dentro de código que narra el defecto), `prueba-guardia` (una aserción que
exige que la ruta NO se use), `dato-historico` (un registro fechado).

| archivo | sha | clase | motivo |
|---|---|---|---|

## Historia — archivo por archivo, con su cuenta exacta

| archivo | ocurrencias | motivo |
|---|---|---|
| README.md | 1 | Pertenece a `h1-fundacion`, no a este carril. Corrección redactada en `docs/handoffs/H0-rutas-heredadas.md`; escribirla aquí rompería la regla 1 del contrato de propiedad. |
| apps/web/src/voz/README.md | 1 | Pertenece al carril de la voz (`h18-identidad`). Misma razón y mismo handoff con la corrección exacta. |
