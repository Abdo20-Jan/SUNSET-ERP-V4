# PR-022a — CX-01 · Comex · Cockpit Operacional (núcleo)

> **Escopo entregue:** PR-022**a** = banda de alertas + 4 indicadores USD + 6 blocos de pendências +
> gating de valores financeiros + drill-down. PR-022**b** (diferido): calendário semanal + barra de
> filtros + saved views + vista [Cancelados].
> **Branch:** `pr-022-comex-cockpit` (limpa de `origin/main` @ `731c4ce1`). **Não-stack.**

## O que mudou

`/comex` deixou de ser um overview leve (4 KpiCards + 3 link-cards + recentes) e passou a ser um
**cockpit operacional read-only**: banda de alertas críticos (oculta quando vazia) → 4 indicadores USD
(hover ARS) → 6 blocos compactos de pendências (2×3) com contador + [Ver todos] + drill-down à ficha.

### Arquivos novos
- `src/lib/services/comex-cockpit-derivaciones.ts` — helpers PUROS (unit-tested): `clasificarSeveridad`,
  `diasSinActualizacion`, `bandDiasSinActualizacion` (amber>5d/red>10d), `proximaAccionPorEstado`.
- `src/lib/services/comex-cockpit.ts` — `getCockpitData({ now, verCosto })` read-only, batched.
- `src/app/(dashboard)/comex/_components/`: `cockpit.tsx`, `cockpit-indicadores.tsx`,
  `cockpit-alertas-band.tsx`, `cockpit-bloque.tsx` (+ `ToneChip`).
- `test/comex-cockpit-derivaciones.test.ts` — 13 testes.

### Arquivos modificados
- `src/app/(dashboard)/comex/page.tsx` — reconstruída no cockpit. Mantém `force-dynamic`, default USD +
  `MonedaToggle`, Suspense (skeleton). Os 3 link-cards viraram uma nav secundária compacta
  ("Más acciones": Embarques · Proveedores exterior · Simulaciones).

## Motor intocado / nada recomputado (CRIT-04..09 / G-09)

- `comex-cockpit.ts` **não importa** `services/comex.ts` (rateio/CIF/tributos) — verificável pelos imports.
- Nenhum valor é recalculado: tudo deriva de campos ARMAZENADOS + helpers PUROS reusados verbatim de
  `comex-worklist-derivaciones.ts` (`deriveEtaTono/deriveStatusPago/deriveBloqueo/deriveStatusCosto/fobEnUsd/resolverVistaFiltro`).
- Serviço read-only: nenhuma action de negócio, nenhuma transação, nenhum write.
- `getResumenComex` e `comex-worklist-derivaciones` mantêm contrato (não editados).

## Mapa OD-08 (seção nomeada → bloco) e o que foi gateado

| Seção OD-08 | Blocos/indicadores | Gating real aplicado |
|---|---|---|
| Operação | Procesos críticos · Próximos arribos · Sin actualización | nenhum gate (visível a quem acessa `/comex`) |
| Documentos | Documentos pendientes (proxy) | nenhum gate |
| Custos | Costos pendientes | nenhum gate (apenas status, sem valor) |
| Financeiro | Pagos exteriores + indicadores FOB/CFR · Cash-out · FOB en tránsito | **`VER_COSTO_LANDED`** (server-side) |
| Auditoría | [Cancelados] | **diferido p/ PR-022b** (`AUDITORIA_VER`) |

**Decisão (com o dono):** gating por **valor financeiro** via `VER_COSTO_LANDED` (existente, mesmo gate do
PR-020). **Zero mudança no catálogo de permissões.**

⚠️ **Limitação honesta de OD-08:** `ver_valores_financieros`/`ver_costo_comex` **não existem** no catálogo;
**não há chave por-seção**, o nav comex não tem `permission` e os perfis canônicos (Comex/Financeiro/
Diretor/Consulta) são *shells* vazios. Logo o gating por seção nomeada **NÃO é exequível hoje** além de
`VER_COSTO_LANDED`. As seções Operação/Documentos/Custos ficam visíveis a qualquer usuário com acesso a
`/comex` — isto **NÃO é uma barreira de servidor real**. Reforço futuro (fora deste PR, exigiria editar o
catálogo): chaves `comex.cockpit.{operacao,custos,documentos}` + gate em `getCockpitData`. **Não foi
inventada nenhuma chave.**

## Prova de máscara server-side (CRIT-10)

- A page resolve `verCosto = await hasPermission(PERMISOS.VER_COSTO_LANDED)` no server component
  (`CockpitSection`) e o passa a `getCockpitData`.
- Quando `!verCosto`: `indicadores.{contenedoresTransitoFobUsd,fobCfrAbiertoUsd,cashOut30dUsd}` viram
  `null`; `proximosArribos[].fobUsd` é mascarado via `maskField`; a seção `financeiro` (pagos exteriores)
  é **omitida do payload** (`null`) — nenhum valor monetário é serializado ao cliente.
- O `select` da query de embarque é estreito: nunca traz colunas monetárias de `EmbarqueCosto`
  (iva/iibb/otros) nem `costoTotal` (anti-leak, igual ao mapper do PR-020).
- O FE só recebe `null`/`—`; `SeccionSinPermiso` exibe um placeholder honesto quando Financeiro foi omitido.

## Blocos/indicadores: entregues vs. omitidos (nunca falseados)

| Item | Status | Observação |
|---|---|---|
| Contenedores en tránsito | ✅ count + FOB en tránsito (USD, gated) | valor = **FOB**, nunca CIF/landed (CRIT-04) |
| FOB/CFR abierto | ✅ (USD, gated) | Σ FOB de embarques não-CERRADO; frete CFR só informativo |
| Cash-out proyectado 30d | ◐ exterior USD ≤30d | gastos locais ARS **omitidos** (mistura de moeda); liquidez bancária **omitida** (sem modelo) |
| Alertas críticos | ✅ contagem | é count, **sem valor monetário/hover ARS** (desvio anotado vs. spec) |
| Procesos críticos | ◐ bloqueo/ETA vencida | demurrage/free-time **omitidos** (sem campos no `Contenedor`); `responsable` **omitido** (sem campo) |
| Próximos arribos ≤15d | ✅ | [Ver todos] → `?vista=proximos` (real) |
| Sin actualización ≥5d | ✅ via `updatedAt` | "por usuário" **omitido** (sem event-log/audit-author) |
| Pagos exteriores ≤30d | ◐ vencimiento real | `embarqueFob` sem venc. → lane "sin fecha" (count); venc. **não** sintetizado de `fechaLlegada+dias` |
| Costos pendientes | ◐ status Estimado/Provisionado | **gap %/costo final esperado OMITIDO** (exigiria rateio — CRIT-04) |
| Documentos pendientes | proxy | "contenedores sin BL" (rotulado); **sem** checklist real de documentos (sem modelo) |

## Drill-down / [Ver todos]

- Linha pendente → `/comex/embarques/[id]` (ficha do processo; fallback honesto até CX-03/PR-021 mergear
  com deep-link por `?tab=`).
- [Ver todos]: Próximos arribos → `?vista=proximos`; Pagos exteriores → `/comex/proveedores`; demais
  degradam para `/comex/embarques` (não há vista "criticos"/"costos"/"documentos" no schema de vistas).

## Validação executada

| Comando | Resultado |
|---|---|
| `pnpm prisma generate` | OK |
| `pnpm typecheck` | OK |
| `pnpm build` | OK — `/comex` = `ƒ` (dynamic) |
| `pnpm biome:ci` | OK (exit 0; só warnings pré-existentes) |
| `pnpm test` | **152 arquivos / 1119 testes verdes** (inclui `comex-overview`, `golden-rateio-embarque`, `golden-costo-landed-despacho`, `stock-recalc-replay`, `validar-invariantes-comex`, novo `comex-cockpit-derivaciones`) |

**`db:validar-stock` / `db:validar-asientos`: NÃO executados.** `.env`/`.env.local` apontam para
`shinkansen.proxy.rlwy.net` (Railway = **PRODUÇÃO**); rodá-los acionaria a STOP condition "Production DB
would be needed". Substituídos com segurança por: (a) o PR não toca em nenhum código de motor/escrita/
schema → invariantes de dados armazenados são comprovadamente inalteráveis; (b) `validar-invariantes-comex`
+ golden tests + stock-recalc-replay rodaram **verdes** em DBs efêmeros (Testcontainers) na suíte acima.
Posso rodá-los contra um Postgres descartável local se desejado.

## Complexidade (Codacy ≤8)

`getCockpitData` delega a 1 mapper por bloco/indicador (`mapProximosArribos`, `mapSinActualizacion`,
`mapCostosPendientes`, `mapDocumentosProxy`, `mapPagosExteriores`, `mapIndicadores`, `filtrarCriticos`),
e helpers puros pequenos — branching por função baixo.

## QA manual sugerido (env local seguro — NUNCA prod; admin/admin123)
- `/comex` mostra o cockpit; banda só quando há alertas; 4 indicadores USD com hover ARS; 6 blocos com
  contadores + [Ver todos].
- Linha → abre `/comex/embarques/[id]`; [Ver todos] de arribos → worklist `?vista=proximos`.
- Usuário **sem** `VER_COSTO_LANDED`: indicadores financeiros "—", arribos sem FOB, bloco Financeiro
  substituído pelo placeholder (server omite o valor, não só o FE).

## Rollback
Restaurar a `comex/page.tsx` anterior (overview) e remover os arquivos novos
(`comex-cockpit*.ts`, `_components/cockpit*.tsx`, test). Nenhuma migração/seed/dado a reverter.
