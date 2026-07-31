<!--
  Antes de abrir: `node scripts/ownership-gate.mjs` en local te dice lo mismo
  que CI, en dos segundos y sin esperar el runner.
-->

## Qué hace

<!-- Una o dos frases. Qué cambia para el emprendedor que usa el producto. -->

## Handoff

<!-- H2 / H3 / … — y el enlace a docs/handoffs/HN-*.md -->

## Criterios observables verificados

<!--
  Los de la sección "Criterios observables de 'listo'" de tu handoff, uno por
  uno, con evidencia real: salida de comando, captura, id de fila. "Lo probé"
  no cuenta como evidencia.
-->

- [ ]
- [ ]

## Las cinco reglas

- [ ] Escribí **sólo en mi árbol** (`.ownership.json`)
- [ ] Mis migraciones están **dentro de mi bloque de 10**
- [ ] **No toqué el cableado central** (`apps/api/src/packages.ts`, `packages/db/`)
- [ ] **No instalé dependencias** (si falta una, la anoto abajo)
- [ ] Programé **contra los ports**, no contra implementaciones de otros handoffs

## Dependencias que hicieron falta

<!-- Anótalas aquí; NO las instales. Las agrega H1 en una pasada. -->

## Notas para el orquestador

<!-- Migraciones a aplicar, variables de entorno nuevas, orden de merge. -->
