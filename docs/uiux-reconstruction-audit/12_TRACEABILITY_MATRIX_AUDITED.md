# 12 — Matriz de Rastreabilidade Auditada

> Converte a **semente** (`reports/REQUIREMENTS_TRACEABILITY_SEED.md`, tudo `not_audited_yet`) em status auditado contra o código. `current_code_status`: ✅ atende · ◐ parcial · ❌ ausente · 🔒 preservar (motor). `gap`: none/partial/missing. Sev: 🔴/🟠/🟡/🟢.
>
> **Atualização 2026-06-25 (pós-Onda 0/1).** Reflete o que PR-001→PR-012 entregaram em `main` (ver [IMPLEMENTATION_TRIAGE_2026-06-25.md](IMPLEMENTATION_TRIAGE_2026-06-25.md)). A coluna `PR` foi reconciliada para a **numeração executada** (a fundação saiu pela série **NS-***; o RBAC/auditoria/aprovações são PR-006→012). **🚩 = construído porém atrás de feature-flag** (`RBAC_ENABLED`/`APPROVALS_ENABLED`, default OFF) — existe e está testado, mas ainda não "morde". A baseline/SEED do vault permanecem **congelados**.

## Bloco A — Regras Globais (G-01..G-10)

| req_id | requisito | status | referência de código | gap | sev | PR | teste |
|---|---|---|---|---|---|---|---|
| REQ-G-01 | Densidade alta, baixo brilho | ✅ | tokens + dark mode (NS-1) | none | 🟢 | PR-001 (NS-1) | visual 1080p |
| REQ-G-02 | Top-nav; sem sidebar principal | ✅ | `components/layout/app-shell.tsx` (cutover topnav) | none | 🟢 | PR-002 (NS-2) | e2e nav |
| REQ-G-03 | Botões com texto | ◐ | top-nav textual ok; toolbars de negócio variam | partial | 🟡 | PR-002 (NS-2) | checklist |
| REQ-G-04 | FloatingWorkWindow; sem drawers | ◐ | `components/record/floating-work-window.tsx` (existe); 5 `*-detalle-sheet.tsx` por migrar | partial | 🟠 | PR-004 + Onda 3 (TES/CONT) | e2e FWW |
| REQ-G-05 | Worklists núcleo | ✅ | `components/data-grid/enterprise-data-grid.tsx` | none | 🟢 | PR-003 (NS-3) | e2e grid |
| REQ-G-06 | Permissão FE+BE (todas dimensões) | ✅🚩 | `lib/permisos.ts` + `PermissionGate` (flag `RBAC_ENABLED` OFF) | none | 🟢 | PR-006/007 | permissão FE+BE |
| REQ-G-07 | Histórico antes/depois imutável | ✅ | `AuditLog` (+motivo/origen/ip) + `registrarAuditoria` | none | 🟢 | PR-008 | auditoria evento |
| REQ-G-08 | BI concentra análises | ✅ | `/bi`, `services/bi.ts` | none | 🟢 | PR-BI | revisão |
| REQ-G-09 | Motor rateio Comex preservado | 🔒 | `despacho-parcial.ts`, `contenedor.ts` | preserve | 🟢 | — | golden CRIT-05 |
| REQ-G-10 | Vendedor não vê custo/margem | ✅🚩 | `lib/permisos-masking.ts` (BE strip + FE mask, flag OFF) | none | 🟢 | PR-011 | vendedor sem permissão |

## Bloco B — Fichas de página (41)

| req_id | page_code | status | rota/referência | gap | sev | PR |
|---|---|---|---|---|---|---|
| REQ-DASH-01 | DASH-01 | ✅ | `/dashboard` (overview + faja KPIs) | none | 🟢 | PR-002 (NS-2) |
| REQ-SHELL-01 | SHELL-01 | ✅ | `app-shell.tsx` (top-nav) | none | 🟢 | PR-002 (NS-2) |
| REQ-SEARCH-01 | SEARCH-01 | ✅ | `⌘K` command palette | none | 🟢 | PR-002 (NS-1/2) |
| REQ-COM-01 | COM-01 | ◐ | `/ventas` | partial | 🟠 | Onda 3 (Comercial) |
| REQ-COM-02 | COM-02 | ◐ | `/ventas/[id]` `venta-form.tsx` (margem por permissão ✅; record pattern parcial) | partial | 🟠 | PR-007/011 + Onda 3 |
| REQ-COM-03 | COM-03 | ◐ | `/ventas/pedidos` | partial | 🟠 | Onda 3 (Comercial) |
| REQ-COM-04 | COM-04 | ◐ | `/maestros/cotizaciones` | partial | 🟠 | Onda 3 (Comercial) |
| REQ-COM-05 | COM-05 | ◐ | motor de aprovação PR-012 (inerte); falta UI+cabeamento | partial | 🔴 | PR-012 + PR-013/014 |
| REQ-CLI-01 | CLI-01 | ◐ | `/maestros/clientes` (piloto record #331) | partial | 🟡 | PR-005 + Onda 3 |
| REQ-CLI-02 | CLI-02 | ❌ | — | missing | 🔴 | Onda 3 (CLI) |
| REQ-MAE-PROD-01 | MAE-PROD-01 | ◐ | `/maestros/productos` | partial | 🟠 | Onda 3 (PROD) |
| REQ-CX-01 | CX-01 | ◐ | `/comex` | partial | 🟠 | Onda 3 (COMEX) |
| REQ-CX-02 | CX-02 | ◐ | `/comex/embarques` | partial | 🟠 | Onda 3 (COMEX) |
| REQ-CX-03 | CX-03 | ◐ | `/comex/embarques/[id]` | partial | 🟠 | Onda 3 (COMEX) |
| REQ-CX-04 | CX-04 | ◐ | `/comex/contenedores/[id]/*` | partial | 🟠 | Onda 3 (COMEX) |
| REQ-CX-05 | CX-05 | ◐🔒 | `/comex/embarques/[id]/despachos` | partial | 🔴 | Onda 3 (COMEX · golden) |
| REQ-CX-06 | CX-06 | ◐🔒 | `/comex/simulaciones` | partial | 🔴 | Onda 3 (COMEX · golden) |
| REQ-CX-07 | CX-07 | ◐ | upload divergência | partial | 🟠 | Onda 3 (COMEX) |
| REQ-INV-01 | INV-01 | ◐ | `/inventario` | partial | 🟠 | Onda 3 (INV) |
| REQ-INV-02 | INV-02 | ◐ | serviços stock (sem UI dedicada) | partial | 🟠 | Onda 3 (INV) |
| REQ-LOG-01 | LOG-01 | ◐ | `/entregas` | partial | 🟡 | Onda 3 (INV) |
| REQ-FIN-01 | FIN-01 | ◐ | `/tesoreria/cuentas-a-cobrar` | partial | 🟠 | Onda 3 (FIN) |
| REQ-FIN-02 | FIN-02 | ◐ | `/tesoreria/cuentas-a-pagar` | partial | 🟠 | Onda 3 (FIN) |
| REQ-FIN-03 | FIN-03 | ❌ | — | missing | 🔴 | Onda 3 (FIN) |
| REQ-FIN-04 | FIN-04 | ❌ | — | missing | 🔴 | Onda 3 (FIN) |
| REQ-FIN-05 | FIN-05 | ◐ | `/reportes/flujo-caja` | partial | 🟠 | Onda 3 (FIN) |
| REQ-TES-01 | TES-01 | ◐ | `/tesoreria/cuentas` (drawer) | partial | 🟠 | Onda 3 (TES) |
| REQ-TES-02 | TES-02 | ◐ | `/tesoreria/movimientos` | partial | 🟠 | Onda 3 (TES) |
| REQ-TES-03 | TES-03 | ◐ | `/tesoreria/movimientos` (COBRO) | partial | 🟠 | Onda 3 (TES · Q&A B1 pendente) |
| REQ-TES-04 | TES-04 | ◐ | `/tesoreria/extractos` | partial | 🟠 | Onda 3 (TES) |
| REQ-CONT-01 | CONT-01 | ◐ | `/contabilidad/asientos` (record-shell NS-4 #308; drawer parcial) | partial | 🟠 | Onda 3 (CONT) |
| REQ-CONT-02 | CONT-02 | ◐ | `/contabilidad/cuentas` | partial | 🟡 | Onda 3 (CONT) |
| REQ-CONT-03 | CONT-03 | ◐ | `/reportes/estado-resultados` | partial | 🟠 | Onda 3 (CONT) |
| REQ-CONT-04 | CONT-04 | ◐ | `/reportes/balance-general` | partial | 🟠 | Onda 3 (CONT) |
| REQ-COMP-01 | COMP-01 | ◐ | `/compras` | partial | 🟠 | Onda 3 (COMP) |
| REQ-COMP-02 | COMP-02 | ◐ | aba da OC (OD-11) | partial | 🟡 | Onda 3 (COMP) |
| REQ-CRM-01 | CRM-01 | ✅ | `/crm/*` | none | 🟢 | PR-CRM |
| REQ-BI-01 | BI-01 | ◐ | `/bi` | partial | 🟡 | Onda 3 (BI) |
| REQ-PERM-01 | PERM-01 | ✅ | `/sistema/usuarios` + matriz + perfis canônicos | none | 🟢 | PR-009 |
| REQ-AUD-01 | AUD-01 | ✅ | `/sistema/auditoria` (worklist read-only + export auditada) | none | 🟢 | PR-010 |
| REQ-AUTO-01 | AUTO-01 | ◐ | motor `services/aprobaciones*` (INERTE); falta UI (PR-013) + cabeamento (PR-014) | partial | 🔴 | PR-012 + PR-013/014 |

## Bloco C — Regras críticas (CRIT-01..14)

| req_id | requisito | status | referência | gap | sev | PR |
|---|---|---|---|---|---|---|
| REQ-CRIT-01 | Margem por linha+total %/valor | ◐ | `venta-form.tsx`, `stock.ts` (cálculo ok; record pattern parcial) | partial | 🟠 | PR-007/011 + Onda 3 |
| REQ-CRIT-02 | Renderização condicional (ocultar coluna) | ✅🚩 | `permisos-masking.ts` + `PermissionGate` (flag OFF) | none | 🟢 | PR-011 |
| REQ-CRIT-03 | Aprovação margem baixa por faixas | ◐ | `MATRIZ_APROBACION` (faixas −5/−10/−15 no motor PR-012, inerte); falta cabeamento | partial | 🔴 | PR-012 + PR-014 |
| REQ-CRIT-04 | Não reimplementar rateio Comex | 🔒 | `despacho-parcial.ts`, `comex.ts` | preserve | 🟢 | — |
| REQ-CRIT-05 | Golden files antes de UI de custo | ❌ | testes existem mas sem golden "pré-UI" | missing | 🔴 | antes Onda 3 (COMEX) |
| REQ-CRIT-06 | Simulação = mesma função real | 🔒✅ | `simulacion-importacion.ts` | preserve | 🟢 | — |
| REQ-CRIT-07 | Δ>USD0,01 bloqueia fechamento | 🔒✅ | `cerrar-costos-contenedor` (teste) | preserve | 🟢 | — |
| REQ-CRIT-08 | Reabertura custo: dupla aprovação + versão | ◐ | parcial nos serviços; dupla aprovação no motor PR-012 (`REAPERTURA_COSTO_COMEX`, inerte) | partial | 🟠 | Onda 3 (COMEX) + PR-014 |
| REQ-CRIT-09 | Custo contábil (sem IVA) vs gerencial | 🔒✅ | `capitaliza-vs-gasto` (teste) | preserve | 🟢 | — |
| REQ-CRIT-10 | Permissão em todas dimensões FE+BE | ✅🚩 | `lib/permisos.ts` + `requirePermission` (flag OFF) | none | 🟢 | PR-006/007 |
| REQ-CRIT-11 | Auditoria imutável antes/depois+motivo+origem | ✅ | `AuditLog` (+motivo/origen/ip) + `registrarAuditoria` | none | 🟢 | PR-008 |
| REQ-CRIT-12 | BI concentra; operacional não vira dashboard | ✅ | `/bi` | none | 🟢 | PR-BI |
| REQ-CRIT-13 | Política USD ao TC fechamento; 11TC legado | 🔒✅ | `revaluacion.ts`, `*usd*` testes | preserve | 🟢 | — |
| REQ-CRIT-14 | Plano ULTRA prevalece; v4.1 legado | 🔒✅ | `cuenta-registry.ts`, `plan-de-cuentas.ts`, `guard-registry-plan` | preserve | 🟢 | — |

## Bloco D — Decisões do dono (OD-01..OD-15)

| req_id | OD | decisão | status no código | gap | PR |
|---|---|---|---|---|---|
| REQ-COM-01 | OD-01 | 4 colunas congeladas (Número/Tipo/Cliente/Status) | ◐ worklist parcial | partial | Onda 3 (Comercial) |
| REQ-COM-03 | OD-02 | 16 colunas do Pedido | ◐ | partial | Onda 3 (Comercial) |
| REQ-COM-04 | OD-03 | 7 estados | ◐ | partial | Onda 3 (Comercial) |
| REQ-INV-01 | OD-04 | 11 colunas | ◐ | partial | Onda 3 (INV) |
| REQ-INV-02 | OD-05 | 12 colunas (Aging+Bloqueado) | ◐ | partial | Onda 3 (INV) |
| REQ-FIN-01 | OD-06 | 11 colunas + Próxima acción | ◐ | partial | Onda 3 (FIN) |
| REQ-CONT-01 | OD-07 | Período (mês/ano) na worklist | ❌ (verificar) | missing | Onda 3 (CONT) |
| REQ-CX-01 | OD-08 | visibilidade por seção nomeada | ❌ | missing | Onda 3 (COMEX) |
| REQ-TES-01..04 | OD-09 | TES-01 Bancos / TES-02 Pagos / TES-03 Cobranzas / TES-04 Conciliación | ◐ | partial | Onda 3 (TES) |
| REQ-MAE-PROD-01 | OD-10/15 | page_code MAE-PROD-01 | ✅ rota `/maestros/productos` | none | Onda 3 (PROD) |
| REQ-COMP-01/02 | OD-11 | Recepción = aba da OC | ◐ | partial | Onda 3 (COMP) |
| REQ-CONT-03/04 | OD-12 | DRE e Balance separados | ◐ (como relatórios) | partial | Onda 3 (CONT) |
| REQ-G-CURRENCY | OD-13 | USD ao TC fechamento prevalece | 🔒✅ | preserve | — |
| REQ-G-ACCOUNTPLAN | OD-14 | plano ULTRA prevalece | 🔒✅ | preserve | — |
| REQ-G-PAGECODES | OD-15 | page_codes do PDF v6 | ✅ (convenção desta auditoria) | none | — |

## Notas
- **🚩 flag-gated** = construído + testado, mas o enforcement depende de `RBAC_ENABLED`/`APPROVALS_ENABLED` (default OFF). Com a flag OFF o comportamento é idêntico ao legado (zero regressão); ligar é decisão operacional + PR-014.
- **🔒 preserve** = backend já atende e **não deve ser tocado** (UI só consome). Os CRIT-04/06/07/09/13/14 estão verdes pela suíte de testes.
- A **coluna PR** foi reconciliada com a execução real: a fundação (G-01..05, SHELL/SEARCH/DASH) saiu pela série **NS-*** (não pelos `pr-001..005` de review, não-mergeados); RBAC/auditoria/aprovações = **PR-006→012**; as fichas de módulo restantes vão para a **Onda 3** (ver [10_PR_ROADMAP.md](10_PR_ROADMAP.md)).
- Itens "verificar" (ex. OD-07 Período na worklist) confirmam-se na 1ª tarefa do PR correspondente.
- Esta matriz reflete o **gap pós-Onda 0/1**, não conclusão de implementação das fichas de módulo.
