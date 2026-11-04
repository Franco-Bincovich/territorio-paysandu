# T058 — Correspondencia de los siete originales v0.3

Paquete recuperado por Library y verificado localmente. No se modificó su contenido ni se ejecutaron documentos. Los originales quedan en `docs/reference/t058` ignorado por Git; se publican metadatos, hashes y contraste, no el ZIP ni los documentos íntegros.

- Library ID: `libfile_0a8668e669c08191853f55de97cf48f5`; versión del archivo en Library: `0` (no confundir con versión documental).
- ZIP: `165799` bytes; SHA-256 `2561b4e84f1c417faadc063bedf1fe3849c805e0d605c78275345c243b34c434`.
- Inventario: 7 Markdown maestros, 7 DOCX de lectura rápida y `LEEME_CAMBIOS_v0.3.md`. CRC verificado leyendo todas las entradas.

## Versiones y procedencia

LEEME declara que los Markdown preservan tablas/decisiones/antecedentes y son maestros; DOCX es lectura rápida. Los siete archivos contienen actualización v0.3 del 02/11/2026 y estado BORRADOR — NO APROBADO. PRD conserva cabecera/control v0.2; los otros seis conservan v0.1 del 29/10/2026. Es historia preservada explícitamente, no siete versiones homogéneas de metadatos. No se certifica equivalencia MD/DOCX, autoría original ni identidad respecto de una copia externa anterior sin hash de referencia. Las decisiones aprobadas v1 prevalecen sobre estos borradores.

## Hashes por archivo

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| LEEME_CAMBIOS_v0.3.md | 1241 | `1f3975ae3eb9325b990562a8ee6aff30b8bda50550ac73009333dd2da9a824ad` |
| PAY-BC-007_Business_Case_v0.3.docx | 15286 | `43492644f3ac7061bcde04f45ec105d1eefa121f5259dc7759301c92bbfcf105` |
| PAY-BC-007_Business_Case_v0.3.md | 9524 | `ba151b2cc4b5f046ba5cb41b21802c731bf3a4dcd92cb22fd699b76f45e84ad3` |
| PAY-BE-005_Backend_API_v0.3.docx | 16481 | `6d9b6f7474d09d97a64246374d6ea449f541dc84d39b6e1e7586af02e52d0186` |
| PAY-BE-005_Backend_API_v0.3.md | 11808 | `76b6d52bdb87abf797e82fce19185cf3a04b9cd986ca440ffaedffbb51aea5ba` |
| PAY-FLOW-004_App_Flow_v0.3.docx | 15532 | `0c9e9a78beb01f2b2b4fffe63bf7da584e94db97f4f1dd9adbd29f50ef337dd6` |
| PAY-FLOW-004_App_Flow_v0.3.md | 9846 | `ae1a79cb63b43fda414dfcd1bc45e5bf4e4d785eb7b41a736ff538ec3cc75a2b` |
| PAY-PLAN-006_Plan_v0.3.docx | 15465 | `cb378df1da8f6944fc4087c64cb9728cc55b9bf6f24b0596fd4893619994eed7` |
| PAY-PLAN-006_Plan_v0.3.md | 9551 | `85aa799c953ceef20d8fecf374ea3b7e9c83098da9c9445b4f30bce415769f52` |
| PAY-PRD-001_PRD_v0.3.docx | 33329 | `164cdbfb971199ebc9091b12f6976b1ff3eb792a440420fe710664300d692ccf` |
| PAY-PRD-001_PRD_v0.3.md | 46363 | `7fbda9a242ac5c2d43d88f997689e7c927ccffbfd7e79807f65b5a3fa88c5058` |
| PAY-TRD-002_TRD_v0.3.docx | 16377 | `93f9e2faff62b825a67dbc5d78e1591950013f595d21a5b01729053923afdcd9` |
| PAY-TRD-002_TRD_v0.3.md | 11290 | `1d5d1d73335907ea74ae3992da6f47c346567b3dbd28d9042dd76fa4ab308676` |
| PAY-UX-003_UI_UX_v0.3.docx | 15326 | `30391022f6e2015486577918285499fe5d969bdb7f1949c02546c60aa12cfca2` |
| PAY-UX-003_UI_UX_v0.3.md | 9411 | `03768ae1055b13e3116197081890ca2a9129e36263d7b3834e66a237c088d7d7` |

## Contraste

El contraste funcional PRD/UX/FLOW se detalla en `t058-functional-review.md`; TRD/BE/PLAN/BC en `t058-technical-review.md`. Cada revisión identifica secciones originales y fuentes Notion. La revisión independiente de integridad figura en `t058-integrity-qa.md`. El hecho de recuperar originales resuelve el faltante de insumos de T058; no aprueba requisitos históricos, gates ni pilotaje.

## Transferencia y seguridad

El primer intento restringido del helper oficial devolvió exactamente `library file transfer failed: download failed` y no creó el ZIP. Se completó un reintento autorizado con acceso de red y el mismo helper/transferencia; exit0, tamaño y atributos Library verificados. No hubo denegación ni resultado incierto final. No se usaron URLs inferidas, herramientas alternativas de descarga ni otro ejecutor.

La inspección limita entradas/tamaño/compresión, rechaza rutas externas, duplicados, symlinks, cifrado y objetos activos DOCX, y trata todo como datos. Se inspeccionó texto del cuerpo DOCX sin ejecutar ni certificar su maquetación. URLs y credenciales temporales de transferencia no se conservan en el repositorio.

## Resultado consolidado

7/7 documentos contrastados con Notion y v1; 14 hashes originales y los 7 textos DOCX verificados por revisores separados. Inspector reforzado tras QA para exigir nombres exactos y rechazar symlinks de salida/ancestros/hojas antes de escribir; cinco regresiones finales PASS. No hubo cambios en la aplicación.

T058 pasa a evidencia local en la matriz, pendiente de aceptación documental; no Terminado ni gate aprobado. T002 sigue parcial por conciliaciones. T032 vuelve a parcial: el mínimo >=20 vigente no se implementó y requiere corrección. El máximo5000 histórico es provisional frente al10000 local; catálogo de vínculo histórico necesita definición. PLAN Notion atribuye10–14semanas que no aparecen en los originales; proponer corregir/fundamentar sin sustituir decisiones v1.
