# 12 — Matriz de Rastreabilidade Auditada

> Converte a **semente** (`reports/REQUIREMENTS_TRACEABILITY_SEED.md`, tudo `not_audited_yet`) em status auditado contra o código. `current_code_status`: ✅ atende · ◐ parcial · ❌ ausente · 🔒 preservar (motor). `gap`: none/partial/missing. Sev: 🔴/🟠/🟡/🟢.

## Bloco A — Regras Globais (G-01..G-10)

| req_id | requisito | status | referência de código | gap | sev | PR | teste |
|---|---|---|---|---|---|---|---|
| REQ-G-01 | Densidade alta, baixo brilho | ◐ | `globals.css` (cor ok; densidade não tokenizada) | partial | 🟡 | PR-001 | visual 1080p |
| REQ-G-02 | Top-nav; sem sidebar principal | ❌ | `(dashboard)/layout.tsx`, `app-sidebar.tsx` | missing | 🔴 | PR-002 | e2e nav |
| REQ-G-03 | Botões com texto | ◐ | toolbars/nav ad-hoc | partial | 🟠 | PR-002 | checklist |
| REQ-G-04 | FloatingWorkWindow; sem drawers | ❌ | `*-detalle-sheet.tsx`×5 | missing | 🔴 | PR-004 + módulos | e2e FWW |
| REQ-G-05 | Worklists núcleo | ◐ | `ui/data-table.tsx` | partial | 🟠 | PR-003 | e2e grid |
| REQ-G-06 | Permissão FE+BE (todas dimensões) | ◐ | `auth-guard.ts` (só ADMIN/USER) | partial | 🔴 | PR-005 | permissão FE+BE |
| REQ-G-07 | Histórico antes/depois imutável | ◐ | `AuditLog` (sem motivo/origen; 3 usos) | partial | 🔴 | PR-005 | auditoria evento |
| REQ-G-08 | BI concentra análises | ✅ | `/bi`, `services/bi.ts` | none | 🟢 | PR-BI | revisão |
| REQ-G-09 | Motor rateio Comex preservado | 🔒 | `despacho-parcial.ts`, `contenedor.ts` | preserve | 🟢 | — | golden CRIT-05 |
| REQ-G-10 | Vendedor não vê custo/margem | ◐ | `venta-form.tsx` (sem gate de permissão) | partial | 🟠 | PR-005/007 | vendedor sem permissão |

## Bloco B — Fichas de página (41)

| req_id | page_code | status | rota/referência | gap | sev | PR |
|---|---|---|---|---|---|---|
| REQ-DASH-01 | DASH-01 | ◐ | `/dashboard` | partial | 🟡 | PR-002 |
| REQ-SHELL-01 | SHELL-01 | ◐ | `(dashboard)/layout` (sidebar) | partial | 🔴 | PR-002 |
| REQ-SEARCH-01 | SEARCH-01 | ◐ | `ui/command` | partial | 🟠 | PR-002 |
| REQ-COM-01 | COM-01 | ◐ | `/ventas` | partial | 🟠 | PR-006 |
| REQ-COM-02 | COM-02 | ◐ | `/ventas/[id]` `venta-form.tsx` | partial | 🔴 | PR-007 |
| REQ-COM-03 | COM-03 | ◐ | `/ventas/pedidos` | partial | 🟠 | PR-008 |
| REQ-COM-04 | COM-04 | ◐ | `/maestros/cotizaciones` | partial | 🟠 | PR-009 |
| REQ-COM-05 | COM-05 | ❌ | — | missing | 🔴 | PR-010 |
| REQ-CLI-01 | CLI-01 | ◐ | `/maestros/clientes` | partial | 🟡 | PR-CLI |
| REQ-CLI-02 | CLI-02 | ❌ | — | missing | 🔴 | PR-CLI |
| REQ-MAE-PROD-01 | MAE-PROD-01 | ◐ | `/maestros/productos` | partial | 🟠 | PR-PROD |
| REQ-CX-01 | CX-01 | ◐ | `/comex` | partial | 🟠 | PR-COMEX |
| REQ-CX-02 | CX-02 | ◐ | `/comex/embarques` | partial | 🟠 | PR-COMEX |
| REQ-CX-03 | CX-03 | ◐ | `/comex/embarques/[id]` | partial | 🟠 | PR-COMEX |
| REQ-CX-04 | CX-04 | ◐ | `/comex/contenedores/[id]/*` | partial | 🟠 | PR-COMEX |
| REQ-CX-05 | CX-05 | ◐🔒 | `/comex/embarques/[id]/despachos` | partial | 🔴 | PR-COMEX (golden) |
| REQ-CX-06 | CX-06 | ◐🔒 | `/comex/simulaciones` | partial | 🔴 | PR-COMEX (golden) |
| REQ-CX-07 | CX-07 | ◐ | upload divergência | partial | 🟠 | PR-COMEX |
| REQ-INV-01 | INV-01 | ◐ | `/inventario` | partial | 🟠 | PR-INV |
| REQ-INV-02 | INV-02 | ◐ | serviços stock (sem UI dedicada) | partial | 🟠 | PR-INV |
| REQ-LOG-01 | LOG-01 | ◐ | `/entregas` | partial | 🟡 | PR-INV |
| REQ-FIN-01 | FIN-01 | ◐ | `/tesoreria/cuentas-a-cobrar` | partial | 🟠 | PR-FIN |
| REQ-FIN-02 | FIN-02 | ◐ | `/tesoreria/cuentas-a-pagar` | partial | 🟠 | PR-FIN |
| REQ-FIN-03 | FIN-03 | ❌ | — | missing | 🔴 | PR-FIN |
| REQ-FIN-04 | FIN-04 | ❌ | — | missing | 🔴 | PR-FIN |
| REQ-FIN-05 | FIN-05 | ◐ | `/reportes/flujo-caja` | partial | 🟠 | PR-FIN |
| REQ-TES-01 | TES-01 | ◐ | `/tesoreria/cuentas` (drawer) | partial | 🟠 | PR-TES |
| REQ-TES-02 | TES-02 | ◐ | `/tesoreria/movimientos` | partial | 🟠 | PR-TES |
| REQ-TES-03 | TES-03 | ◐ | `/tesoreria/movimientos` (COBRO) | partial | 🟠 | PR-TES (Q&A B1 pendente) |
| REQ-TES-04 | TES-04 | ◐ | `/tesoreria/extractos` | partial | 🟠 | PR-TES |
| REQ-CONT-01 | CONT-01 | ◐ | `/contabilidad/asientos` (drawer) | partial | 🟠 | PR-CONT |
| REQ-CONT-02 | CONT-02 | ◐ | `/contabilidad/cuentas` | partial | 🟡 | PR-CONT |
| REQ-CONT-03 | CONT-03 | ◐ | `/reportes/estado-resultados` | partial | 🟠 | PR-CONT |
| REQ-CONT-04 | CONT-04 | ◐ | `/reportes/balance-general` | partial | 🟠 | PR-CONT |
| REQ-COMP-01 | COMP-01 | ◐ | `/compras` | partial | 🟠 | PR-COMP |
| REQ-COMP-02 | COMP-02 | ◐ | aba da OC (OD-11) | partial | 🟡 | PR-COMP |
| REQ-CRM-01 | CRM-01 | ✅ | `/crm/*` | none | 🟢 | PR-CRM |
| REQ-BI-01 | BI-01 | ◐ | `/bi` | partial | 🟡 | PR-BI |
| REQ-PERM-01 | PERM-01 | ❌ | `/admin` (parcial) | missing | 🔴 | PR-PERM |
| REQ-AUD-01 | AUD-01 | ❌ | `AuditLog` (sem UI) | missing | 🔴 | PR-AUD |
| REQ-AUTO-01 | AUTO-01 | ❌ | cron (sem UI) | missing | 🔴 | PR-AUTO |

## Bloco C — Regras críticas (CRIT-01..14)

| req_id | requisito | status | referência | gap | sev | PR |
|---|---|---|---|---|---|---|
| REQ-CRIT-01 | Margem por linha+total %/valor | ◐ | `venta-form.tsx`, `stock.ts` | partial | 🔴 | PR-007 |
| REQ-CRIT-02 | Renderização condicional (ocultar coluna) | ❌ | sem `PermissionGate` | missing | 🔴 | PR-005/007 |
| REQ-CRIT-03 | Aprovação margem baixa por faixas | ❌ | — | missing | 🔴 | PR-010 |
| REQ-CRIT-04 | Não reimplementar rateio Comex | 🔒 | `despacho-parcial.ts`, `comex.ts` | preserve | 🟢 | — |
| REQ-CRIT-05 | Golden files antes de UI de custo | ❌ | testes existem mas sem golden "pré-UI" | missing | 🔴 | antes PR-COMEX |
| REQ-CRIT-06 | Simulação = mesma função real | 🔒✅ | `simulacion-importacion.ts` | preserve | 🟢 | — |
| REQ-CRIT-07 | Δ>USD0,01 bloqueia fechamento | 🔒✅ | `cerrar-costos-contenedor` (teste) | preserve | 🟢 | — |
| REQ-CRIT-08 | Reabertura custo: dupla aprovação + versão | ◐ | parcial nos serviços | partial | 🟠 | PR-COMEX |
| REQ-CRIT-09 | Custo contábil (sem IVA) vs gerencial | 🔒✅ | `capitaliza-vs-gasto` (teste) | preserve | 🟢 | — |
| REQ-CRIT-10 | Permissão em todas dimensões FE+BE | ◐ | `auth-guard.ts` | partial | 🔴 | PR-005 |
| REQ-CRIT-11 | Auditoria imutável antes/depois+motivo+origem | ◐ | `AuditLog` (sem motivo/origen) | partial | 🔴 | PR-005 |
| REQ-CRIT-12 | BI concentra; operacional não vira dashboard | ✅ | `/bi` | none | 🟢 | PR-BI |
| REQ-CRIT-13 | Política USD ao TC fechamento; 11TC legado | 🔒✅ | `revaluacion.ts`, `*usd*` testes | preserve | 🟢 | — |
| REQ-CRIT-14 | Plano ULTRA prevalece; v4.1 legado | 🔒✅ | `cuenta-registry.ts`, `plan-de-cuentas.ts`, `guard-registry-plan` | preserve | 🟢 | — |

## Bloco D — Decisões do dono (OD-01..OD-15)

| req_id | OD | decisão | status no código | gap | PR |
|---|---|---|---|---|---|
| REQ-COM-01 | OD-01 | 4 colunas congeladas (Número/Tipo/Cliente/Status) | ◐ worklist parcial | partial | PR-006 |
| REQ-COM-03 | OD-02 | 16 colunas do Pedido | ◐ | partial | PR-008 |
| REQ-COM-04 | OD-03 | 7 estados | ◐ | partial | PR-009 |
| REQ-INV-01 | OD-04 | 11 colunas | ◐ | partial | PR-INV |
| REQ-INV-02 | OD-05 | 12 colunas (Aging+Bloqueado) | ◐ | partial | PR-INV |
| REQ-FIN-01 | OD-06 | 11 colunas + Próxima acción | ◐ | partial | PR-FIN |
| REQ-CONT-01 | OD-07 | Período (mês/ano) na worklist | ❌ (verificar) | missing | PR-CONT |
| REQ-CX-01 | OD-08 | visibilidade por seção nomeada | ❌ | missing | PR-COMEX |
| REQ-TES-01..04 | OD-09 | TES-01 Bancos / TES-02 Pagos / TES-03 Cobranzas / TES-04 Conciliación | ◐ | partial | PR-TES |
| REQ-MAE-PROD-01 | OD-10/15 | page_code MAE-PROD-01 | ✅ rota `/maestros/productos` | none | PR-PROD |
| REQ-COMP-01/02 | OD-11 | Recepción = aba da OC | ◐ | partial | PR-COMP |
| REQ-CONT-03/04 | OD-12 | DRE e Balance separados | ◐ (como relatórios) | partial | PR-CONT |
| REQ-G-CURRENCY | OD-13 | USD ao TC fechamento prevalece | 🔒✅ | preserve | — |
| REQ-G-ACCOUNTPLAN | OD-14 | plano ULTRA prevalece | 🔒✅ | preserve | — |
| REQ-G-PAGECODES | OD-15 | page_codes do PDF v6 | ✅ (convenção desta auditoria) | none | — |

## Notas
- **🔒 preserve** = backend já atende e **não deve ser tocado** (UI só consome). Os CRIT-04/06/07/09/13/14 estão verdes pela suíte de testes.
- Itens marcados "verificar" (ex. OD-07 Período na worklist) devem ser confirmados na primeira tarefa do PR correspondente.
- Nenhuma linha foi promovida a ✅ "implementado" para regras de UI sem o respectivo PR — esta matriz reflete o **gap atual**, não conclusão de implementação.
