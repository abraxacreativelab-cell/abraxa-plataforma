# H0 · Las dos rutas heredadas que quedan, y de quién son

**Fecha:** 2026-09-01 · **Emite:** H0 (orquestación) · **Para:** `h1-fundacion` y el carril de la voz

## Qué pasó

`/Volumes/FRAGUA/CLAUDE CODE` dejó de ser el workspace activo el 2026-08-31 (bloque B0): el código
se mudó al disco interno del Mac y ese SSD quedó como archivo histórico de sólo consulta. Este repo
traía **50 menciones** de la ruta vieja. Cuarenta y ocho estaban en `docs/handoffs/H1…H18` y ya se
corrigieron en el PR que trae este documento: eran instrucciones vivas que mandaban al constructor a
un worktree que hoy no es el bueno.

**Quedan dos**, y las dos viven fuera del árbol de H0. La regla 1 del contrato de propiedad dice que
no se escribe en el árbol ajeno cuando la corrección puede esperar, y ésta puede: mientras el SSD
siga montado no rompe nada. El día que se desconecte, las dos frases mienten.

## Las dos, con su corrección exacta

### 1. `README.md` línea 11 — dueño: `h1-fundacion`

```diff
-> de ABRAXA. GARDEN vive en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN` y **no se
+> de ABRAXA. GARDEN vive en el checkout de `GARDEN` del workspace activo y **no se
```

### 2. `apps/web/src/voz/README.md` línea 167 — dueño: el carril de la voz

```diff
-Las cinco están hoy en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN/.env`. **No están en el `.env` de la
+Las cinco están hoy en el `.env` del checkout de `GARDEN` del workspace. **No están en el `.env` de la
```

## Cómo se comprueba que se aplicó

```bash
node scripts/check-rutas-heredadas.mjs
```

Hoy dice `ocurrencias=2` y las declara en `docs/RUTAS-HEREDADAS.md` con este handoff como motivo.
Cuando el dueño aplique las dos correcciones, hay que **borrar sus dos filas** de ese archivo: si se
dejan, el propio gate las marca como entradas muertas y se pone rojo. Un permiso que nadie retira es
un permiso permanente — la misma lección del `venceEn` de las excepciones transversales.
