# 05 — Matriz de Gaps por Página (41 canônicas)

> Para cada page_code: rota atual existe? status de implementação, principais itens faltantes vs baseline, permissões necessárias, auditoria, campos sensíveis, PR sugerido, risco de implementação.
> Status: ✅ existe · ◐ parcial/mal posicionada · ❌ ausente. Risco: B/M/A (baixo/médio/alto).

## Infra (3)

| code | nome | módulo | rota atual? | status | itens faltantes principais | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|---|
| DASH-01 | Dashboard | Dashboard | `/dashboard` | ◐ | densidade; não virar dashboard analítico (G-08) | por módulo visível | não | — | PR-002 | B |
| SHELL-01 | Shell/Top Nav/Abas | Infra UI | `(dashboard)/layout` | ◐ | **top-nav** (`ModuleMegaMenu`), `InternalTabs`, indicadores de aba | por módulo | leitura de página | — | PR-002 | M |
| SEARCH-01 | Busca Global | Infra UI | `ui/command` | ◐ | `GlobalSearch` cross-módulo + escopo por permissão | escopo de dados | — | resultados sensíveis | PR-002 | M |

## Comercial (5)

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| COM-01 | Worklist Documentos | `/ventas` | ◐ | worklist **unificada P/P/V**, **4 colunas congeladas** (Número/Tipo/Cliente/Status, OD-01), views, export auditado | ver comercial; export | export | margem (coluna por permissão) | PR-006 | M |
| COM-02 | Venta | `/ventas/[id]`,`/nueva` | ✅ | record pattern; **margem item+total %/valor por permissão** (CRIT-01/02); autorização margem baixa | ver custo/margem; emitir | sim (alteração valor) | **custo, margem, preço mínimo** | PR-007 | **A** |
| COM-03 | Pedido | `/ventas/pedidos` | ✅ | **16 colunas canônicas** (OD-02), stock disp./post-doc, reservas | margem por permissão | sim | custo/margem | PR-008 | M |
| COM-04 | Presupuesto | `/maestros/cotizaciones` | ◐ | realocar p/ Comercial; **7 estados** (OD-03); margem | margem por permissão | sim | custo/margem | PR-009 | M |
| COM-05 | Autorizaciones | — | ❌ | página de workflow de **aprovação de margem por faixas** (CRIT-03); histórico de autorização | aprovar (gestor/diretor/master) | sim | margem | PR-010 | **A** |

## Clientes / Maestros (3)

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| CLI-01 | Ficha Geral | `/maestros/clientes` | ◐ | normalizar como "Ficha Geral"; drill-down | ver cliente (carteira/escopo) | alteração | — | PR-clientes | B |
| CLI-02 | Ficha Financeira | — | ❌ | **saldo, limite de crédito, risco, histórico** | ver saldo/limite (Financeiro/Gestor) | leitura sensível | **saldo/limite** | PR-clientes | **A** |
| MAE-PROD-01 | Produtos | `/maestros/productos` | ✅ | record pattern; custo por permissão; import Excel/duplicidade | ver custo; editar | alteração | **custo** | PR-produto | M |

## Comex (7) — 🔴 motor intocável (G-09)

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| CX-01 | Cockpit | `/comex` | ◐ | visibilidade **por seção nomeada** (OD-08): Operação/Documentos/Custos/Créditos-Percepções/Contabilidade/Financeiro/Auditoria | por perfil×seção | leitura sensível | custo/financeiro | PR-comex | M |
| CX-02 | Worklist Processos | `/comex/embarques` | ✅ | padrão worklist + views/export | ver Comex; export | export | custo | PR-comex | M |
| CX-03 | Processo Importação | `/comex/embarques/[id]` | ✅ | record pattern; abas; timeline | ver Comex | alteração | custo | PR-comex | M |
| CX-04 | Containers/Desconsolid. | `/comex/contenedores/[id]/*` | ✅ | UI sobre fluxo já testado (flag) | ver Comex | sim | — | PR-comex | M |
| CX-05 | Despachos | `/comex/embarques/[id]/despachos` | ✅ 🔴 | UI só exibe; **não tocar motor**; matriz despacho parcial | ver Comex; contabilizar | sim | custo | PR-comex (após golden) | **A** |
| CX-06 | Costos/Rateio | `/comex/simulaciones` | ✅ 🔴 | **`MemoriaCalculoWindow`**; simulação = MESMA função (CRIT-06); separar custo/cash-out/crédito | ver custo landed | sim + leitura sensível | **custo contábil/gerencial** | PR-comex (após golden CRIT-05) | **A** |
| CX-07 | Documentos | upload divergência | ◐ | `DocumentChecklist`/versionamento | ver/baixar doc | export/visualização | docs | PR-comex | M |

## Inventário / Logística (3)

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| INV-01 | Estoque Geral | `/inventario` | ◐ | **11 colunas** (OD-04); custo por permissão | ver valor/custo | export | **custo/valor** | PR-inventario | M |
| INV-02 | Estoque por Despacho/Lote | — (serviço só) | ◐ | UI dedicada **12 colunas** (OD-05): Despacho/Container/Lote/Aging/Bloqueado/Costo | ver custo | export | **custo** | PR-inventario | M |
| LOG-01 | Entregas | `/entregas` | ✅ | worklist padrão; comprovante; timeline | ver entrega (escopo) | alteração | — | PR-inventario | B |

## Finanças / Tesouraria (9)

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| FIN-01 | Cuentas a Cobrar | `/tesoreria/cuentas-a-cobrar` | ◐ | **11 colunas + Próxima acción** (OD-06); separar Finanças×Tesouraria | ver financeiro | export/leitura | **saldo** | PR-finanzas | M |
| FIN-02 | Cuentas a Pagar | `/tesoreria/cuentas-a-pagar` | ◐ | worklist padrão; relocar p/ Finanças | ver CxP | export | saldo | PR-finanzas | M |
| FIN-03 | Crédito y Cobranza | — | ❌ | funil, promessas, liberação, histórico | gestor/financeiro | sim | limite/saldo | PR-finanzas | **A** |
| FIN-04 | Programación Financiera | — | ❌ | calendário + tabela; **Finanças programa** (C.4 #7) | financeiro | sim | valores | PR-finanzas | **A** |
| FIN-05 | Flujo de Caja | `/reportes/flujo-caja` | ◐ | página dedicada (não só relatório); USD ao TC fechamento (OD-13) | financeiro | leitura sensível | valores | PR-finanzas | M |
| TES-01 | Bancos y Cajas | `/tesoreria/cuentas` | ✅ | **migrar drawer→FloatingWorkWindow** | tesouraria | sim | saldo banco | PR-tesoreria | M |
| TES-02 | Pagos | `/tesoreria/movimientos` | ◐ | worklist Pagos, lotes, retenções, comprovantes; **drawer→FWW** | tesouraria; aprovar | sim | valores | PR-tesoreria | M |
| TES-03 | Cobranzas | `/tesoreria/movimientos` (COBRO) | ◐ | worklist dedicada; **Q&A detalhado pendente (B1)** → não fechar Q&A até fonte | tesouraria | sim | valores | PR-tesoreria (Q&A bloqueado) | M |
| TES-04 | Conciliación Bancaria | `/tesoreria/extractos` | ◐ | `ConciliacionBancariaPage`; diferença cambial | tesouraria | sim | saldo | PR-tesoreria | M |

## Contabilidade (4)

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| CONT-01 | Asientos | `/contabilidad/asientos` | ✅ | **Período (mês/ano)** na worklist (OD-07); **drawer→FWW**; grade densa | contabilidade | sim | — | PR-contabilidad | M |
| CONT-02 | Plan de Cuentas | `/contabilidad/cuentas` | ✅ | `PlanCuentasTreeView` plano **ULTRA** (OD-14); drill-down Libro Mayor | contabilidade | alteração | — | PR-contabilidad | M |
| CONT-03 | DRE | `/reportes/estado-resultados` | ◐ | **página própria** (OD-12); drill-down; USD | contábil/BI | leitura sensível | valores | PR-contabilidad | M |
| CONT-04 | Balance Patrimonial | `/reportes/balance-general` | ◐ | **página separada do DRE** (OD-12); custo gerencial valora estoque (CRIT-09) | contábil/BI | leitura sensível | valores | PR-contabilidad | M |

## Compras / CRM / BI (4)

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| COMP-01 | Órdenes de Compra | `/compras` | ✅ | aba `Recepciones` (OD-11); worklist padrão; gerar processo Comex | compras; aprovar | sim | custo | PR-compras | M |
| COMP-02 | Recepción | (aba da OC) | ◐ | **não criar rota própria** (OD-11); ponteiro/aba | compras | sim | — | PR-compras | B |
| CRM-01 | Leads/Oportunidades | `/crm/*` | ✅ | já robusto (Kanban); alinhar ao record pattern | comercial (próprios/todos) | alteração | — | PR-crm | B |
| BI-01 | Central de Relatórios | `/bi` | ✅ | export Excel/PDF auditado; favoritos; **sem margem p/ vendedor** | por área; export | export/leitura | margem/custo | PR-bi | M |

## Sistema (3) — 🔴 máxima, todas ausentes

| code | nome | rota atual? | status | itens faltantes | permissões | auditoria? | campos sensíveis | PR | risco |
|---|---|---|---|---|---|---|---|---|---|
| PERM-01 | Usuários/Permissões | `/admin` (parcial) | ❌ | **10 dimensões + 12 perfis**; override individual; herança; "simular como"; temporárias; matriz exportável | master | sim (histórico permanente) | toda permissão | PR-005 + PR-perm | **A** |
| AUD-01 | Auditoria | — | ❌ | UI `AuditTimeline`; 9 campos obrigatórios; eventos; **imutável** | master/diretor (ver) | é a própria auditoria | tudo | PR-005 + PR-aud | **A** |
| AUTO-01 | Automações/Aprovações | cron (sem UI) | ❌ | matriz de aprovações + SLA + escalonamento | master | sim | — | PR-auto | **A** |

## Síntese
- **Ausentes (7):** COM-05, CLI-02, FIN-03, FIN-04, PERM-01, AUD-01, AUTO-01 — 6 delas de **risco alto** (margem/financeiro/segurança).
- **Parciais (≈14):** SHELL-01, SEARCH-01, COM-01/04, CX-01/07, INV-01/02, FIN-01/02/05, TES-02/03/04, CONT-03/04, COMP-02.
- **Existentes a re-padronizar (≈20):** todas precisam de worklist/record pattern + permissão + auditoria mesmo quando "existem".
