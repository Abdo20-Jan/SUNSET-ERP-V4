# 02 — Inventário de Rotas/Páginas Atuais × Canônico

> Mapeamento das ~94 rotas atuais sob `(dashboard)` contra os 41 page_codes canônicos. `match_confidence`: **alta** (mesma intenção/escopo), **média** (existe mas escopo/local divergem), **baixa** (proxy parcial). `current_status`: ✅ existe · ◐ parcial · ❌ ausente.

## Infra / Shell

| current_route | page/componente | módulo provável | canônico | conf. | status | notas |
|---|---|---|---|---|---|---|
| `(dashboard)/layout.tsx` | AppSidebar+AppHeader | Shell | **SHELL-01** | média | ◐ | Sidebar lateral (viola G-02; precisa top-nav `ModuleMegaMenu` + `InternalTabs`). |
| (header search?) | `ui/command` (cmdk) | Busca | **SEARCH-01** | baixa | ◐ | Existe `command`, mas sem `GlobalSearch` cross-módulo canônico. |
| `/dashboard` | dashboard/page | Dashboard | **DASH-01** | alta | ✅ | Revisar densidade/"não virar dashboard analítico" (G-08). |

## Comercial

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/ventas` | Comercial | **COM-01** (Worklist Documentos) | média | ◐ | Hoje só lista Ventas; COM-01 é worklist unificada P/P/V (Pedido/Presupuesto/Venta) com 4 colunas congeladas. |
| `/ventas/nueva`, `/ventas/[id]` | Comercial | **COM-02** (Venta) | alta | ✅ | `venta-form.tsx` calcula margem/custo — auditar permissão (CRIT-01/02). |
| `/ventas/pedidos`, `/ventas/pedidos/[id]`, `/pedidos/nuevo` | Comercial | **COM-03** (Pedido) | alta | ✅ | Validar 16 colunas canônicas (OD-02) e estados. |
| `/maestros/cotizaciones` | Comercial | **COM-04** (Presupuesto) | média | ◐ | "Cotizaciones" sob Maestros ≈ Presupuesto; validar 7 estados (OD-03) e realocação. |
| — | Comercial | **COM-05** (Autorizaciones) | — | ❌ | Sem página de workflow de autorização comercial (margem baixa). |

## Clientes

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/maestros/clientes` | Maestros/Comercial | **CLI-01** (Ficha Geral) | média | ◐ | Existe ficha de cliente; validar como "Ficha Geral" (OD-15). |
| — | Finanzas | **CLI-02** (Ficha Financeira) | — | ❌ | Sem ficha financeira separada (saldo/limite/risco). |

## Maestros / Produto

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/maestros/productos` | Maestros | **MAE-PROD-01** | alta | ✅ | Não renomear (OD-10/OD-15). |
| `/maestros/proveedores`, `/[id]` | Maestros | (Maestro Proveedor) | — | ✅ | Sem page_code próprio na baseline (maestro fornecedor). |
| `/maestros/depositos` | Maestros | (Maestro Depósito) | — | ✅ | Suporte a INV-01/02. |
| `/maestros/jurisdicciones-iibb` | Maestros/Fiscal | (Maestro Fiscal) | — | ✅ | Maestro fiscal IIBB. |

## Comex

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/comex` | Comex | **CX-01** (Cockpit) | média | ◐ | Landing; cockpit precisa visibilidade por **seção nomeada** (OD-08). |
| `/comex/embarques` | Comex | **CX-02** (Worklist Processos) | alta | ✅ | Worklist de embarques. |
| `/comex/embarques/[id]`, `/nuevo` | Comex | **CX-03** (Processo Importação) | alta | ✅ | Ficha do processo. |
| `/comex/contenedores/[id]/desconsolidacion`, `/investigacion` | Comex | **CX-04** (Containers/Desconsolidação) | alta | ✅ | Atrás de flag `CONTENEDOR_DESCONSOLIDACION_ENABLED`. |
| `/comex/embarques/[id]/despachos` | Comex | **CX-05** (Despachos) | alta | ✅ | 🔴 máxima — motor intocável (G-09). |
| `/comex/simulaciones`, `/[id]`, `/nueva` | Comex | **CX-06** (Costos/Rateio) | alta | ✅ | 🔴 máxima — simulação = MESMA função real (CRIT-06). UI só exibe. |
| — | Comex | **CX-07** (Documentos) | baixa | ◐ | Upload de divergência existe; sem checklist/versionamento documental canônico. |
| `/comex/proveedores` | Comex | (Maestro Proveedor Comex) | — | ✅ | Fornecedores Comex. |

## Inventário / Logística

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/inventario` | Inventário | **INV-01** (Estoque Geral) | alta | ◐ | Validar 11 colunas (OD-04). |
| `/inventario/transferencias`, `/nueva` | Inventário | (TransferenciaFlow) | — | ✅ | Suporta INV-01. |
| — | Inventário | **INV-02** (Estoque por Despacho/Lote) | baixa | ◐ | Lógica existe em serviços (stock por despacho); UI dedicada com 12 colunas (OD-05) não confirmada. |
| `/entregas` | Logística | **LOG-01** (Entregas) | alta | ✅ | EntregaWorklist. |
| `/ventas/[id]/entregas`, `/nueva` | Logística | **LOG-01** (fluxo) | alta | ✅ | Geração de entrega a partir da venta. |

## Finanças / Tesouraria

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/tesoreria/cuentas-a-cobrar` | Finanzas | **FIN-01** (Cuentas a Cobrar) | média | ◐ | Sob Tesouraria; FIN-01 exige 11 colunas + **Próxima acción** (OD-06). Separar Finanças×Tesouraria (ANEXO C.4 #7). |
| `/tesoreria/cuentas-a-pagar`, `/saldos-proveedores` | Finanzas | **FIN-02** (Cuentas a Pagar) | média | ◐ | Idem; relocar para módulo Finanças. |
| — | Finanzas | **FIN-03** (Crédito y Cobranza) | — | ❌ | Sem funil de cobrança/promessas/liberação. |
| — | Finanzas | **FIN-04** (Programación Financiera) | — | ❌ | Sem calendário+tabela de programação. |
| `/reportes/flujo-caja` | Finanzas | **FIN-05** (Flujo de Caja) | média | ◐ | Hoje é relatório; FIN-05 é página de fluxo. |
| `/tesoreria/cuentas` | Tesouraria | **TES-01** (Bancos y Cajas) | alta | ✅ | Usa drawer `nueva-cuenta-sheet` (viola G-04). |
| `/tesoreria/movimientos`, `/[id]`, `/nuevo`, `/pagos-historial` | Tesouraria | **TES-02** (Pagos) | média | ◐ | Movimientos cobre pagos; `movimiento-detalle-sheet` (viola G-04). |
| `/tesoreria/movimientos` (COBRO) | Tesouraria | **TES-03** (Cobranzas) | baixa | ◐ | Cobros via movimientos; sem worklist dedicada de Cobranzas. **Q&A detalhado pendente (B1, OD-09).** |
| `/tesoreria/extracto`, `/extractos`, `/[id]`, `/nuevo` | Tesouraria | **TES-04** (Conciliación Bancaria) | média | ◐ | Conciliação via extractos; validar `ConciliacionBancariaPage`. |
| `/tesoreria/anticipos`, `/nuevo` | Tesouraria | (Anticipos — suporte FIN-02/TES-02) | — | ✅ | `anticipo-detalle-sheet` (viola G-04). |
| `/tesoreria/prestamos`, `/nuevo` | Tesouraria | (Préstamos) | — | ✅ | `prestamo-detalle-sheet` (viola G-04). |
| `/tesoreria/transferencias/nuevo` | Tesouraria | (Transferência) | — | ✅ | — |

## Contabilidade

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/contabilidad/asientos`, `/[id]`, `/nuevo`, `/mover-periodo` | Contabilidade | **CONT-01** (Asientos) | alta | ✅ | Incluir **Período (mês/ano)** na worklist (OD-07); `asiento-detalle-sheet` (viola G-04). |
| `/contabilidad/cuentas` | Contabilidade | **CONT-02** (Plan de Cuentas) | alta | ✅ | TreeView do plano ULTRA (OD-14). |
| `/reportes/estado-resultados` | Contabilidade/BI | **CONT-03** (DRE) | alta | ◐ | Existe como relatório; CONT-03 = página própria (OD-12). |
| `/reportes/balance-general`, `/contabilidad/reportes/balance` | Contabilidade/BI | **CONT-04** (Balance Patrimonial) | alta | ◐ | Página separada do DRE (OD-12, não mesclar). |
| `/contabilidad/periodos` | Contabilidade | (Períodos — suporte CONT-01) | — | ✅ | Gestão de período (admin-only). |
| `/reportes/libro-diario`, `/libro-mayor` | Contabilidade | (Livros — suporte CONT) | — | ✅ | `MovimientosCuentaPanel` (Libro Mayor). |

## Compras / CRM / BI / Sistema

| current_route | módulo | canônico | conf. | status | notas |
|---|---|---|---|---|---|
| `/compras`, `/[id]`, `/nueva` | Compras | **COMP-01** (Órdenes de Compra) | alta | ✅ | Recepción = aba da OC (OD-11). |
| `/compras/pedidos`, `/[id]`, `/nuevo` | Compras | (Pedidos de Compra — suporte COMP-01) | — | ✅ | — |
| (aba dentro de Compras) | Compras | **COMP-02** (Recepción) | média | ◐ | Não é página autônoma (OD-11): aba `Recepciones`. |
| `/crm`, `/leads*`, `/oportunidades*`, `/contactos`, `/actividades`, `/pipeline` | CRM | **CRM-01** (Leads/Oportunidades) | alta | ✅ | Mais completo que a ficha canônica; Kanban presente. |
| `/bi` | BI | **BI-01** (Central de Relatórios) | alta | ✅ | Concentra KPIs (G-08). |
| `/admin/recalcular-percepcion-iibb` | Sistema | (admin tools) | — | ✅ | Ferramenta admin pontual. |
| — | Sistema | **PERM-01** (Usuários/Permissões) | baixa | ❌ | 🔴 máxima — só Role ADMIN/USER; sem PERM-01 (12 perfis, 10 dimensões). |
| — | Sistema | **AUD-01** (Auditoria) | baixa | ❌ | 🔴 máxima — `AuditLog` existe, **sem UI** nem campos motivo/origem. |
| — | Sistema | **AUTO-01** (Automações/Aprovações) | baixa | ❌ | 🔴 máxima — há cron, mas sem UI de automações/aprovações. |
| `/perfil` | Sistema | (perfil do usuário) | — | ✅ | — |

## Resumo de cobertura (41 canônicas)

- ✅ **Existe (alta/média):** ~24 — DASH-01, COM-01..03, CLI-01, MAE-PROD-01, CX-01..06, INV-01, LOG-01, FIN-01/02/05, TES-01/02/04, CONT-01..04, COMP-01, CRM-01, BI-01.
- ◐ **Parcial / mal posicionada:** SHELL-01, SEARCH-01, COM-04, INV-02, TES-03, CX-07, COMP-02.
- ❌ **Ausente:** **COM-05, CLI-02, FIN-03, FIN-04, PERM-01, AUD-01, AUTO-01** (7).

> Mesmo onde a rota "existe", o **padrão de UI** (worklist/record) e as regras (colunas congeladas, FloatingWorkWindow, permissão de campo, auditoria) divergem da baseline — ver [05_PAGE_GAP_MATRIX.md](05_PAGE_GAP_MATRIX.md).
