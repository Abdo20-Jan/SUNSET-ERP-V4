# Auditoria Completa — Sunset ERP v4

**Data:** 2026-06-10 · **Método:** 49 agentes (12 auditores paralelos + 33 verificações adversariais + proposta de redesign + crítica de completude) · **Fontes:** código completo do repo + vault Obsidian
**Volume:** ~245 achados, 32 confirmados adversarialmente (1 refutado), 5 críticos

---

## 1. Resumo executivo

O sistema é sólido na intenção (partida doble bem defendida nos generators, transações na maioria dos fluxos, infra de testes no comex, loading states exemplares), mas a auditoria encontrou **um problema estrutural dominante e nove famílias de falhas recorrentes**:

### O problema nº 1: o ledger mistura moedas

Asientos de COBRO/PAGO/TRANSFERENCIA em USD (fora da Fase 2) gravam `debe/haber` **em dólares crus**, enquanto Fase 2, compras, préstamos, transferências e pago exterior gravam **ARS na mesma cuenta**. Todos os agregadores (balance, libro mayor/diario, sumas y saldos, flujo de caja, extracto, saldo de cuenta bancaria, CxC/CxP) somam `debe/haber` sem converter nem filtrar — **somando pesos com dólares**. Derivados diretos:

- `extractos.ts:137` — TC hardcoded `"1"` para extrato USD (`moneda === ARS ? "1" : "1"` — placeholder em produção) → diferencia cambiaria espúria gigante.
- `pago-exterior.ts:277` — linha DEBE em ARS sem `monedaOrigen` dentro de asiento marcado USD → a view de saldos exterior lê pesos como dólares (pagar USD 1.000 a TC 1.000 zera USD 1.000.000 de dívida).
- Fase 2 não dispara em pagos multi-contrapartida nem via intermediario; préstamo USD fica impagável (validação compara TC do dia vs TC histórico).
- A variável `usdOrigen` que resolveria parte disso **existe e nunca é usada** (`asiento-automatico.ts:770`).

**Decisão recomendada:** convencionar livro-razão 100 % ARS (`debe/haber` sempre em pesos; USD vive em `monedaOrigen/montoOrigen/tipoCambioOrigen`), migrar os asientos USD existentes e adicionar um validador de invariante (nenhuma línea com moneda ≠ ARS).

### As nove famílias recorrentes

| # | Família | Exemplos confirmados |
|---|---------|----------------------|
| 2 | **Granularidade de arredondamento** (a lição do 1ct repetida em ~7 lugares) | custo unitário round2×cantidad sem true-up (1.1.5.02/04/05 nunca zeram); VEP montoTotal vs asiento; desconsolidación vs nacionalização (resíduo permanente em 1.1.5.05); dupla perda de precisão no cerrarCostos; lista vs detalhe de simulaciones; split Ley 25413 em float |
| 3 | **Replay ≠ caminho vivo no stock** | `recalcularSPDPorProducto` ignora custo de TRANSFERENCIA → **CMV zerado/corrompido** após qualquer anulação (crítico); anular despacho não recalcula `Producto.stockActual/costoPromedio`; entrega nunca decrementa `stockActual` |
| 4 | **CMV em duas bases** | venta usa `Producto.costoPromedio` global; entrega baixa por SPD do depósito → 1.1.5.03 acumula resíduo permanente; emissão com costo 0 omite CMV silenciosamente |
| 5 | **Máquinas de estado sem guard** | entrega de venta CANCELADA confirmável; anulação genérica de asiento corrompe venta/entrega; compra CANCELADA emitível; pedidos transicionam livremente e faturam N vezes; transferência manual ZPA→NACIONAL nacionaliza sem despacho/tributos; desconsolidar/nacionalizar sem arribo confirmado; revertir ZP com contenedor já desconsolidado |
| 6 | **Fluxo de divergência D9 incompleto** (crítico) | concluir/arquivar investigação nunca popula counters/stock/asiento → mercadoria presa para sempre em 1.1.5.04; ajuste lançado na subcuenta errada (1.1.5.05); FALTA e SOBRA neteadas entre SKUs |
| 7 | **Autorização inexistente** | `Role` só é checado em 1 ponto (CRM); qualquer USER anula todas as vendas, reabre períodos, move asientos; `/admin` sem guard; ~10 actions mutadoras sem `auth()`; sem `middleware.ts` |
| 8 | **Concorrência check-then-act** | reserva/egreso de stock sem lock (stock negativo); pagamento duplo de VEP; dupla emissão de venta/compra; cerrarPeriodo com janela de corrida |
| 9 | **Performance que degrada com o histórico** | `LineaAsiento` sem índice em `asientoId` (a maior tabela); CxP carrega o ledger inteiro por load; replay completo de MovimientoStock por produto em cada transação; 89/91 páginas force-dynamic sem cache; BI agrega em JS o que o Postgres faria com GROUP BY |
| 10 | **Risco operacional estrutural** | sem `prisma/migrations` (schema via db push; `db:push:force` = `--force-reset` contra prod a um comando de distância); parser de extracto LLM sem reconciliação aritmética (alucinação entra no ledger); testes ~100 % comex (zero em ventas/CxC/reportes); zero observabilidade; invariantes contábeis não monitoradas (o validador diário só cobre stock) |

### Escrita (UI + vault)

- **UI (37 achados):** telas inteiras com português vazado (“venda(s)” no painel admin e em jurisdicciones, “Cadastro”, “frete”, “Lacre”, “Beneficiário/intermediário”, “Reverte”); inglês residual (Owner/Stage/Score no CRM, “Default (NACIONAL)” em ventas, “Close”/“Toggle Sidebar” nos componentes base); voseo × usted misturados na mesma tela; **convenção Débito/Crédito invertida entre duas telas irmãs de extracto**; módulo contabilidad renderiza montos crus en-US (`412345.67`) enquanto o resto usa es-AR (`412.345,67`); datas formatadas no fuso do browser em client components → **dia anterior para usuário argentino + hydration mismatch**.
- **Vault (23 achados):** documentos de referência pararam em abril/maio — `plan-de-cuentas.md` ignora as 5 analíticas 1.1.5.x renomeadas; `reglas-asientos.md` documenta 5 de ~20 geradores (e contradiz a capitalização de tributos do Modelo Y); `importacion.md` não conhece contenedores/Modelo Y; PRD descreve o sistema **v2 em Python/Flask**; STATE.md congelado em 2026-05-20; contradição não marcada entre ADRs de diferencia cambiaria (2026-05-23 vs 2026-05-26); CLAUDE.md do vault afirma que “não há suite de testes” (falso desde a Onda 2).

### UI/UX

A base visual é boa (shadcn bem aplicado, 47 loading.tsx, sticky action bars), mas faltam os mecanismos que definem um ERP de classe NetSuite: **sem busca global** (cmdk instalado e ocioso), tabelas **render-only** (zero ordenação/filtros salvos/colunas/export/seleção em massa), **nenhum export CSV/Excel** nem nos reportes contábeis, sem dirty guard no form de 2.215 linhas, dark mode morto (next-themes sem ThemeProvider), KPIs não clicáveis, record pages sem subtabs nem audit trail (o model `AuditLog` existe e nunca é exibido), rota de entregas órfã, botão “Hoy” seleciona amanhã após as 21h (UTC), e inputs monetários que exigem formato en-US numa UI es-AR. A proposta completa de redesign estilo NetSuite está na seção 9, com roadmap de 5 fases mapeado a arquivos reais.

---

## 2. Top críticos confirmados (corrigir primeiro)

| # | Achado | Arquivo | Impacto |
|---|--------|---------|---------|
| 1 | Ledger mistura USD e ARS em todos os relatórios | `asiento-automatico.ts:924` + agregadores | Balance/mayor/flujo/extracto/saldos errados sempre que há movimento USD fora da Fase 2 |
| 2 | TC hardcoded `"1"` na aprovação de extrato USD | `extractos.ts:137` | Diferencia cambiaria espúria contabilizada na hora |
| 3 | Replay de SPD perde custo das transferências | `stock.ts:913` | costoPromedio=0 no NACIONAL após qualquer anulação → CMV zerado, entregas bloqueadas |
| 4 | Investigação D9 nunca libera counters/stock/asiento | `divergencia-investigacion.ts:367` | Mercadoria contábil e fisicamente presa; ajuste na subcuenta errada |
| 5 | Saldos exterior leem ARS como USD (pago parcial zera dívida) | `cuentas-a-pagar.ts:1677` + `pago-exterior.ts:277` | Dívida USD real desaparece da view |
| 6 | Role nunca enforced + `/admin` aberto | `admin-percepcion-iibb.ts:79`, `page.tsx:9` | Qualquer USER anula todas as vendas EMITIDAS e reabre períodos |
| 7 | Entrega de venta CANCELADA confirmável / anulação genérica de asiento | `entregas.ts:269`, `asientos.ts:110` | Stock egresado sem venta; entregas irrecuperáveis |
| 8 | Despacho legacy credita 1.1.5.02 com custos nunca capitalizados | `asiento-automatico.ts:2342` | Conta negativa + custo duplicado (gasto 5.x **e** estoque/CMV) |
| 9 | Transferência manual ZPA→NACIONAL sem despacho | `transferencias.ts:136` | Bypass aduaneiro: stock vendível sem tributos nem asiento |
| 10 | Compra de mercadería emitida não movimenta stock | `asiento-automatico.ts:3310` | Inventário físico diverge do contábil; CMV defasado |




---

## 3. Falhas de lógica — Contabilidad

## Resumo
Auditoria da lógica contábil do Sunset ERP v4 (motor de asientos, FIFO cambiario, relatórios e períodos). A invariante de partida doble está bem defendida nos generators (componentes arredondados a 2dp antes de somar), mas há uma falha estrutural crítica: asientos com moneda=USD gravam linhas em dólares crus e todos os relatórios (balance, libro mayor/diario, sumas y saldos, flujo) somam debe/haber como se fossem ARS, misturando denominações na mesma conta. No fluxo legacy de importação, o despacho transfere de 1.1.5.02 custos de facturas de zona primária que nunca foram capitalizados lá (foram a gasto 5.x), deixando a conta negativa e duplicando custo em estoque/CMV. Reaparece o padrão conhecido de granularidade de arredondamento (custo unitário 2dp × cantidad sem true-up, split Ley 25413 em float) e a validação de balance opera em granularidade diferente da persistência. Nos relatórios, o Balance General com fechaDesde acusa "No cuadra" falsamente por ignorar resultados acumulados anteriores, e o flujo de caja por moeda omite pagos USD da Fase 2. Anulação não gera contra-asiento (exclui por estado), o que é consistente nos relatórios, mas quebra o FIFO de diferencia cambiaria quando se anula factura USD já paga.

## Achados

### [CRITICA] ✅ CONFIRMADO Asientos em USD gravam linhas em dólares e todos os relatórios somam como ARS
- **Arquivo**: src/lib/services/asiento-automatico.ts:924
- **Evidência**: `const valor = money(mov.monto).toString(); ... moneda: esFase2 ? Moneda.ARS : mov.moneda, tipoCambio: esFase2 ? 1 : mov.tipoCambio.toString()`
- **Descrição**: COBRO/PAGO/TRANSFERENCIA USD fora da Fase 2 (e asientos manuais com moneda=USD) gravam debe/haber no valor USD cru. Todos os relatórios (balance-sumas-saldos.ts:88-114, reportes/shared.ts:235-241, libro-mayor, libro-diario) somam lineaAsiento.debe/haber sem converter por tipoCambio. Um pago de USD 100 entra como 100 no razão ao lado de linhas ARS (Fase 2 grava ARS na MESMA conta), corrompendo saldos de bancos USD, gastos e CxP em todos os relatórios.
- **Recomendação**: Convencionar livro-razão 100% em ARS: gravar linhas em ARS (monto×tipoCambio) com monedaOrigen/montoOrigen USD como metadata, como já faz a Fase 2; migrar asientos USD existentes ou converter por tipoCambio nos agregados.
- **Veredito**: Confirmado: asiento-automatico.ts:763/893-925 grava debe/haber=mov.monto (USD cru) fora da Fase 2; crearAsientoEnTx não converte; balance-sumas-saldos e buildCuentaTree (shared.ts:235-241) somam cru; convertirMoneda sem callers; extractos.ts:137 força TC="1" em conta USD; Fase 2 grava ARS na mesma conta.

### [ALTA] ✅ CONFIRMADO Despacho legacy credita 1.1.5.02 com custos de facturas ZP que nunca entraram na conta
- **Arquivo**: src/lib/services/asiento-automatico.ts:2342
- **Evidência**: `zpFacturasArs = zpFacturasArs.plus(subtot).plus(otros); const costoEnTransitoTotalArs = fobArs.plus(fleteOrigenArs).plus(seguroOrigenArs).plus(zpFacturasArs);`
- **Descrição**: crearAsientoZonaPrimaria debita em 1.1.5.02 apenas FOB+flete+seguro (linha 1564); os subtotais das facturas ZP vão a gasto 5.x (linha 1605, pushDebe(linea.cuentaContableGastoId)). Mas crearAsientoDespacho inclui essas facturas (até as EMITIDA, filtro estado !== ANULADA na linha 2326) no costo transferido 1.1.5.02→1.1.5.01. Após despachar tudo, 1.1.5.02 fica negativo pela soma das facturas ZP e o custo é duplicado: gasto 5.x + estoque/CMV.
- **Recomendação**: Alinhar os dois lados: ou capitalizar as facturas ZP em 1.1.5.02 no asiento de ZP (com reclassificação das EMITIDA, como faz crearAsientoArriboComex), ou excluí-las do costoEnTransitoTotalArs do despacho legacy.
- **Veredito**: Confirmado: ZP legacy debita 1.1.5.02 só com FOB+flete+seguro (l.1564); subtotais ZP vão a gasto 5.x (l.1605). crearAsientoDespacho inclui ZP (até EMITIDA) no custo 02→01 (l.2326-2345) sem reclassificar o gasto: 1.1.5.02 fica negativo e custo duplica. Modelo Y reclassifica (l.1711); legacy não.

### [MEDIA] Custo unitário arredondado a 2dp antes de multiplicar por cantidad deixa resíduo permanente em 1.1.5.02/1.1.5.05
- **Arquivo**: src/lib/services/asiento-automatico.ts:2360
- **Evidência**: `const costoUnit = costoItemArs.dividedBy(ie.cantidad).toDecimalPlaces(2); ... const valor = costoUnit.times(id.cantidad).toDecimalPlaces(2);`
- **Descrição**: Padrão da lição conhecida do projeto: o débito original em 1.1.5.02 é o total exato, mas cada despacho credita round2(costo/cant)×cant. Com pneus (centenas de unidades/item) o erro chega a 0,005×cantidad ARS por item, sem true-up no último despacho — a conta nunca zera. O mesmo ocorre no cruzado: despacho-parcial.ts:862-863 faz fcUnitArs=round2(costoFC×tcEmb) e fcTotalArs=round2(fcUnitArs×cant), divergindo do débito do arribo em 1.1.5.04/05.
- **Recomendação**: Calcular o valor transferido como round2(costoItemTotal×cantDespachada/cantTotal) ou dar true-up no último despacho de cada item, espelhando o resíduo-ao-último-item já usado em calcularCostoLandedDespacho.

### [MEDIA] Metadata USD (usdOrigen) construída mas nunca aplicada nos movimentos USD fora da Fase 2
- **Arquivo**: src/lib/services/asiento-automatico.ts:770
- **Evidência**: `const usdOrigen = mov.moneda === Moneda.USD ? { monedaOrigen: Moneda.USD, montoOrigen: money(mov.monto).toString(), ... } : {}; // nunca usado nas lineas do switch (893-914)`
- **Descrição**: A variável usdOrigen é declarada e jamais espalhada nas linhas dos casos COBRO/PAGO/TRANSFERENCIA. Anticipos USD (PAGO sem saldo FIFO pendente) e COBROS USD criam linhas sem monedaOrigen/montoOrigen: o saldo USD invariante a TC (libro-mayor.ts:153-158) não os computa e calcularDiferenciaCambiariaPago (filtra monedaOrigen=USD) ignora esses débitos, distorcendo o FIFO e a diferença cambiaria de pagos futuros.
- **Recomendação**: Espalhar ...usdOrigen na linha contrapartida (e no banco USD) dos três casos do switch, ou remover a variável e bloquear movimentos USD fora da Fase 2 até definir o tratamento.

### [MEDIA] Validação de partida doble no agregado bruto vs persistência arredondada por linha
- **Arquivo**: src/lib/services/asiento-automatico.ts:346
- **Evidência**: `const totalDebeDec = sumMoney(lineas.map((l) => l.debe ?? 0)); ... if (!eqMoney(totalDebeDec, totalHaberDec)) throw ... // persiste: debe: money(l.debe ?? 0)`
- **Descrição**: validarLineasYBalance soma valores brutos e arredonda 1x (sumMoney), mas crearAsientoEnTx persiste money() por linha (round half-up 2dp cada). Com entradas >2dp (lineaSchema aceita string/number livre; actions/asientos.ts:28 usa z.string() sem regex), ex. debe [0.004, 0.004] vs haber [0.008]: validação passa (0.01==0.01) e grava linhas 0.00+0.00 vs 0.01 — razão desbalanceado e header divergente das linhas. Só a UI limita a 2dp.
- **Recomendação**: Normalizar cada linha com money() ANTES de validar e somar as linhas já arredondadas; ou rejeitar entradas com mais de 2 casas no zod do servidor (regex em lineaSchema).

### [MEDIA] Balance General com fechaDesde não cuadra: resultado acumulado pré-desde fica fora do patrimônio
- **Arquivo**: src/lib/services/reportes/balance-general.ts:139
- **Evidência**: `const totalPatrimonioAjustado = cuentaResultadoYaMovida ? totalPatrimonio : totalPatrimonio.plus(resultadoEjercicio); // resultadoEjercicio = getEstadoResultadosByFecha(filter) só do range`
- **Descrição**: Com fechaDesde definido, Ativo/Pasivo/PN incluem saldoInicial acumulado (shared.ts:243-254), mas o resultadoEjercicio somado ao PN é apenas o do range desde→hasta. Sem asientos de cierre transferindo resultados a 3.2.1.02, todo resultado anterior a fechaDesde some da equação e o relatório exibe badge "No cuadra" com diferencia igual ao resultado acumulado anterior — falso alarme que mascara desbalanceios reais.
- **Recomendação**: Para o balanço, calcular resultadoEjercicio sempre de origem→fechaHasta (ignorar fechaDesde na chamada a getEstadoResultadosByFecha), mantendo desde só para exibir movimentos do período.

### [MEDIA] Flujo de caja particiona por asiento.moneda — fluxo USD omite pagos Fase 2 e transferências
- **Arquivo**: src/lib/services/reportes/flujo-caja.ts:118
- **Evidência**: `where: { estado: AsientoEstado.CONTABILIZADO, fecha: { gte: desde, lte: hasta }, moneda, lineas: { some: { cuenta: ... } } }`
- **Descrição**: O filtro usa asiento.moneda, mas pagos USD Fase 2 e crearAsientoTransferencia são forçados a moneda=ARS (asiento-automatico.ts:924, 1082). Resultado: o flujo USD não mostra os pagos a proveedores USD nem transferências entre bancos USD (subreporta saídas), enquanto o flujo ARS inclui linhas de bancos USD valoradas em ARS. O saldoInicial (linhas 96-108) sofre da mesma partição, quebrando o invariante Σ contrapartidas = Δ bancos por moeda.
- **Recomendação**: Particionar pela moeda da CONTA bancária (CuentaBancaria.moneda) ou pela denominação da linha (monedaOrigen), não pela moneda do asiento; ou consolidar o relatório em ARS único.

### [MEDIA] Anulação de factura USD paga deixa FIFO de diferencia cambiaria inconsistente
- **Arquivo**: src/lib/services/asiento-automatico.ts:663
- **Evidência**: `where: { cuentaId: cuentaProveedorId, monedaOrigen: Moneda.USD, asiento: { estado: AsientoEstado.CONTABILIZADO } }`
- **Descrição**: anularEnTx não gera contra-asiento, só marca ANULADO (excluído dos relatórios). Se uma factura USD já consumida parcialmente por pagos for anulada, sua linha HABER USD sai do universo CONTABILIZADO mas os DEBEs USD dos pagos permanecem; totalDebeUsd (linha 697) passa a consumir outras facturas mais antigas, mudando o TC ponderado e gerando diferencia cambiaria errada nos próximos pagos. Não há guard impedindo anular factura com pagos vinculados.
- **Recomendação**: Bloquear anulação de asientos cuja línea USD já foi consumida por pagos (ou exigir anular os pagos primeiro); alternativamente parear pagos↔facturas explicitamente (PagoAplicacion) em vez de FIFO global por conta.

### [MEDIA] Mover asiento de período não altera fecha — relatórios vivos ignoram o período
- **Arquivo**: src/lib/services/asiento-automatico.ts:173
- **Evidência**: `await tx.asiento.update({ where: { id: asientoId }, data: { periodoId: periodoDestinoId, numero: numeroNuevo } });`
- **Descrição**: moverAsientoDePeriodoEnTx troca periodoId e renumera, mas mantém a fecha original, que fica fora do range do novo período. Como todos os relatórios em uso (balance, libro diario/mayor, sumas y saldos, flujo) filtram por asiento.fecha — não por periodoId — mover um asiento de período não muda nenhum relatório; só os caminhos por periodoId (getBalanceGeneral/getEstadoResultados, hoje sem callers) enxergariam o asiento no mês novo. Estado fecha×período inconsistente no banco.
- **Recomendação**: Ao mover, exigir também nova fecha dentro do período destino (reusar cambiarFechaAsientoEnTx) ou validar fecha ∈ [fechaInicio, fechaFin] do destino e avisar que relatórios são por fecha.

### [BAIXA] Split Ley 25413 calculado com float JS em vez de Decimal
- **Arquivo**: src/lib/services/asiento-automatico.ts:876
- **Evidência**: `const montoAbs = toDecimal(mov.monto).toNumber(); const creditoMonto = Math.round(montoAbs * PORCENTAJE_LEY_25413_COMPUTABLE * 100) / 100;`
- **Descrição**: Único ponto do motor que sai de decimal.js para float binário. O asiento fecha balanceado (gasto = round(montoAbs - credito)), mas o split 33/67 pode divergir 1 centavo do que o mesmo cálculo daria em Decimal half-up (casos x.xx5, ex. 1.005*100=100.4999→100). Granularidade mista é exatamente o padrão que já causou o bug de 1ct documentado no projeto.
- **Recomendação**: Usar Decimal: toDecimal(mov.monto).times(PORCENTAJE_LEY_25413_COMPUTABLE).toDecimalPlaces(2) e gasto = monto.minus(credito).

### [BAIXA] FIFO de diferencia cambiaria sem desempate de ordenação no mesmo dia
- **Arquivo**: src/lib/services/asiento-automatico.ts:673
- **Evidência**: `orderBy: { asiento: { fecha: "asc" } },`
- **Descrição**: calcularDiferenciaCambiariaPago ordena as linhas USD apenas por fecha. Duas facturas USD na mesma data (TCs diferentes) têm ordem não-determinística (depende do plano do Postgres), então o TC ponderado e o spread de ganancia/pérdida podem variar entre execuções para o mesmo estado de dados. Demais relatórios usam fecha+numero+id como critério.
- **Recomendação**: Acrescentar desempate estável: orderBy [{asiento:{fecha:asc}},{asiento:{numero:asc}},{id:asc}], consistente com os relatórios.

### [BAIXA] Asientos de venta, compra e entrega gravados com origen MANUAL
- **Arquivo**: src/lib/services/asiento-automatico.ts:3161
- **Evidência**: `origen: AsientoOrigen.MANUAL, // crearAsientoVenta; idem compra (3392) e entrega (3248)`
- **Descrição**: Asientos gerados automaticamente por venta/compra/entrega usam AsientoOrigen.MANUAL, enquanto tesorería usa TESORERIA, comex usa COMEX e gasto usa GASTO. O libro diario expõe a coluna origen e os filtros de /contabilidad/asientos quebram a trilha: não dá para distinguir lançamentos manuais reais dos automáticos de venta/compra, prejudicando auditoria e qualquer relatório futuro por origem.
- **Recomendação**: Adicionar valores VENTA/COMPRA ao enum AsientoOrigen (ou reutilizar um genérico AUTOMATICO) e corrigir os três generators; migrar dados via script usando os FKs venta/compra/entregaVenta.

### [BAIXA] Balance General por periodoId mostra só deltas do mês (sem saldo inicial) — caminho morto e enganoso
- **Arquivo**: src/lib/services/reportes/shared.ts:219
- **Evidência**: `const calcularInicial = !("periodoId" in filter) && Boolean(filter.fechaDesde);`
- **Descrição**: No branch periodoId de buildCuentaTree nunca se calcula saldo inicial, então getBalanceGeneral(periodoId) retornaria um "balanço patrimonial" contendo apenas os movimentos do mês (caja acumulada de meses anteriores = 0). Hoje nenhuma página chama as variantes por periodoId (só *ByFecha), mas a API exportada em reportes.ts convida a uso incorreto futuro.
- **Recomendação**: Remover as variantes por periodoId ou fazê-las delegar para *ByFecha com fechaHasta = fechaFin do período (fim do dia), que produz o acumulado correto.

### [BAIXA] cerrarPeriodo sem transação: janela de corrida entre checagem de borradores e fechamento
- **Arquivo**: src/lib/actions/periodos.ts:33
- **Evidência**: `const borradores = await db.asiento.count({ where: { periodoId, estado: AsientoEstado.BORRADOR } }); ... await db.periodoContable.update({ ... estado: PeriodoEstado.CERRADO });`
- **Descrição**: A contagem de BORRADOR e o update do período são queries separadas, fora de transação. Um asiento criado/contabilizado concorrentemente entre as duas operações fica preso em período CERRADO: não pode ser contabilizado (contabilizarEnTx exige período ABIERTO) nem movido (PERIODO_ORIGEN_CERRADO), exigindo reabrir o período manualmente. Cenário raro mas plausível com geradores automáticos rodando.
- **Recomendação**: Envolver count+update em db.$transaction com isolation serializable, ou re-verificar borradores==0 dentro da transação após o update (updateMany condicional).

### [BAIXA] Conta 2.1.3.02 IIBB POR PAGAR compartilhada entre percepção de importação e IIBB de ventas
- **Arquivo**: src/lib/services/cuenta-registry.ts:251
- **Evidência**: `IIBB_POR_PAGAR: { codigo: "2.1.3.02", nombre: "IIBB POR PAGAR", ... } // em EMBARQUE_CODIGOS e VENTA_CODIGOS (linha 31)`
- **Descrição**: O HABER da percepção IIBB aduaneira (paga à ARCA via VEP no despacho) e o HABER do IIBB próprio sobre ventas (depositado à jurisdição) caem na mesma analítica 2.1.3.02. O saldo da conta mistura duas obrigações com credores e vencimentos distintos, dificultando conciliar a posição fiscal mensal e podendo mascarar saldo devedor de um dos tributos com o credor do outro.
- **Recomendação**: Separar em analíticas distintas (ex. 2.1.5.20 IIBB importación por pagar — já citada no docstring de crearAsientoDespacho — vs 2.1.3.02 IIBB ventas) e migrar saldos por origem dos asientos.

### [BAIXA] flujo-caja-config morto e com ownership errado: anticipos de clientes mapeados como empréstimos
- **Arquivo**: src/lib/services/reportes/flujo-caja-config.ts:231
- **Evidência**: `{ label: "Empréstimos Bancários CP", cuentaCodigos: ["2.1.7.01", "2.1.7.02"] },`
- **Descrição**: FLUJO_CAJA_ESTRUCTURA e assertOwnershipUnico não têm nenhum caller (grep sem resultados fora do próprio arquivo). Além de morto, o mapeamento está desatualizado: 2.1.7.01 é ANTICIPOS DE CLIENTES (cuenta-registry.ts:117) — apareceria como "Empréstimos Bancários CP" — e as contas de préstamo auto-criadas (range 2.1.7.10-99 em cuenta-auto.ts:230) ficam fora da estrutura. Se alguém ativar a matriz do template, o fluxo da diretoria sai classificado errado.
- **Recomendação**: Remover o arquivo ou atualizá-lo antes de qualquer uso: excluir 2.1.7.01 dos empréstimos e cobrir os ranges dinâmicos 2.1.7.10+/2.2.1.10+ por prefixo em vez de códigos fixos.


---

## 4. Falhas de lógica — Comex (ZPA / Modelo Y / despachos / VEP)

## Resumo
Auditoria da lógica COMEX (ZPA/Modelo Y, desconsolidación, despacho cruzado, VEP, pago exterior). Dos 6 problemas conhecidos do piloto: (a) edição destrutiva foi corrigida para ItemEmbarque mas sobraram 2 variantes destrutivas (produto removido orfana packing list; deleteMany de facturas BORRADOR quebra link com despacho); (b) dupla contagem cerrarCostos×arribo foi corrigida (arribo agora reclassifica EMITIDA), porém o cruzado NÃO reclassifica facturas DESPACHO emitidas; (c) tributos/VEP do cruzado foram implementados; (d) mitigado via listarVepDespachosPendientes e 3 paths de saldo, mas restam filtros de estado que bloqueiam pagamento; (e) revertirEstadoContenedor existe, mas faltam guards de ordem entre embarque e contenedor. Os achados mais graves são o fluxo de divergência D9, que conclui a investigação sem nunca popular counters/stock/asiento de traslado (mercadoria fica contábil e fisicamente presa) e ajusta a subcuenta errada (1.1.5.05 em vez de 1.1.5.04), e a anulação de despacho que não recalcula stockActual/costoPromedio do produto. A invariante de reconciliação do Modelo Y (débito 1.1.5.04 == Σ FC×cant×TC) não é estrutural: arredondamento em granularidades diferentes, dupla perda de precisão no FC e ausência de chamadas a validarInvariantePackingList deixam resíduos permanentes nas subcuentas 1.1.5.04/05.

## Achados

### [CRITICA] ✅ CONFIRMADO Concluir/arquivar investigação D9 nunca popula counters, stock nem asiento de traslado
- **Arquivo**: src/lib/services/divergencia-investigacion.ts:367
- **Evidência**: `await t.contenedor.update({ where: { id: contenedor.id }, data: { estado: ContenedorEstado.DESCONSOLIDADO } });`
- **Descrição**: No gate D9, desconsolidar() bloqueia counters/MovimientoStock/asiento (desconsolidacion.ts:211-221). concluirInvestigacion/arquivarInvestigacion apenas mudam o contenedor para DESCONSOLIDADO. desconsolidar() não pode rodar de novo (YA_DESCONSOLIDADO, desconsolidacion.ts:132). Resultado: cantidadDisponible=0 para sempre, sem stock no DF, sem traslado 04→05; a matriz de despacho fica vazia e a mercadoria fica presa em 1.1.5.04.
- **Recomendação**: Ao concluir/arquivar, executar o passo 8 de desconsolidar() (counters=fisica, MovimientoStock INGRESO, asiento TRASLADO_DEPOSITO_FISCAL com as quantidades físicas) na mesma transação, antes de marcar DESCONSOLIDADO.
- **Veredito**: Confirmado: concluir/arquivar (divergencia-investigacion.ts:367-370/403-406) só setam DESCONSOLIDADO; gate D9 (desconsolidacion.ts:211-221) pulou counters/aplicarIngresoSPD/asiento e desconsolidar relança YA_DESCONSOLIDADO (:132). Agravante: ajuste credita 1.1.5.05 nunca debitada. Sem caminho compensatório.

### [ALTA] ✅ CONFIRMADO Asiento de divergência D9 ajusta 1.1.5.05 (DF) que nunca recebeu o traslado
- **Arquivo**: src/lib/services/divergencia-investigacion.ts:328
- **Evidência**: `const ubicacion = (inv.desconsolidacion.depositoFiscalId ?? contenedor.depositoFiscalId) != null ? "DEPOSITO_FISCAL" : "ZONA_PRIMARIA";`
- **Descrição**: desconsolidacion.depositoFiscalId é sempre setado (desconsolidar exige DF), então ubicacion é sempre DEPOSITO_FISCAL. Mas no momento da divergência o asiento de traslado 04→05 foi bloqueado pelo gate D9 — o valor segue em 1.1.5.04. crearAsientoDivergencia (asiento-automatico.ts:2080-2084) credita/debita 1.1.5.05, que fica com saldo negativo (FALTA) ou positivo órfão (SOBRA), enquanto 1.1.5.04 fica superavaliada para sempre.
- **Recomendação**: Enquanto o traslado estiver bloqueado, usar ubicacion ZONA_PRIMARIA (1.1.5.04); ou gerar o traslado pendente antes do ajuste e aí sim ajustar 1.1.5.05.
- **Veredito**: Confirmado: desconsolidacion.ts:150/202 garante depositoFiscalId≠null → ubicacion sempre DEPOSITO_FISCAL; gate D9 (l.211-221) bloqueia traslado 04→05; concluirInvestigacion não o recria; asiento lança em 1.1.5.05 (asiento-automatico.ts:2080-84) → 05 negativa, 04 superavaliada. Flag off mitiga.

### [ALTA] ✅ CONFIRMADO Anular despacho (ZPA legacy e cruzado) não recalcula Producto.stockActual/costoPromedio
- **Arquivo**: src/lib/services/stock.ts:850
- **Evidência**: `for (const productoId of productoIds) {
    await recalcularSPDPorProducto(tx, productoId);
    const depositos = afectados.get(productoId);`
- **Descrição**: aplicarTransferenciaDespacho/aplicarNacionalizacionDF chamam recalcularStockYCostoPromedio ao aplicar (stock.ts:713-715, 789-792), mas revertirTransferenciaDespacho só chama recalcularSPDPorProducto. anularDespachoAction (despachos.ts:773, 793) usa essa reversão: após anular um despacho CONTABILIZADO, Producto.stockActual e costoPromedio continuam contando a quantidade nacionalizada que voltou ao DF/ZPA — agregado vendable inflado até o próximo recalc incidental.
- **Recomendação**: Em revertirTransferenciaDespacho, após deletar movimentos, chamar recalcularStockYCostoPromedio(tx, productoId) para cada produto afetado (mesmo padrão de revertirIngresoDespacho).
- **Veredito**: Confirmado: revertirTransferenciaDespacho (stock.ts:851) só chama recalcularSPDPorProducto, que upserta StockPorDeposito e nunca toca Producto. Os apply (stock.ts:713-715, 789-792) e os reverts irmãos (316-317, 350-351) chamam recalcularStockYCostoPromedio. anularDespachoAction (despachos.ts:773/793) não compensa; costoPromedio stale alimenta CMV (asiento-automatico.ts:2989).

### [ALTA] ✅ CONFIRMADO Sem guard de ordem: desconsolidar e nacionalizar cruzado funcionam sem o arribo do embarque
- **Arquivo**: src/lib/services/asiento-automatico.ts:2644
- **Evidência**: `if (embarque.asientoId) {
  throw new AsientoError("ESTADO_INVALIDO", `Embarque ${embarque.codigo}: ya tiene cierre monolítico — no admite despachos parciales.`);
}`
- **Descrição**: crearAsientoDespachoCruzado só valida asientoId; o legacy exige asientoZonaPrimariaId (linha 2268). desconsolidacion.ts não referencia asientoZonaPrimariaId, e avanzarEstadoContenedor avança independente do embarque. Operador pode levar o contenedor a EN_DEPOSITO_FISCAL, desconsolidar e nacionalizar ANTES de confirmar o arribo (que debita 1.1.5.04): o traslado credita 1.1.5.04 sem débito prévio → subcuentas 04/05 negativas. Variante do gap (e) do piloto.
- **Recomendação**: Em desconsolidar() e crearAsientoDespachoCruzado, exigir embarque.asientoZonaPrimariaId != null (arribo Modelo Y confirmado) antes de gerar traslado/nacionalização.
- **Veredito**: Confirmado: asiento-automatico.ts:2644 só checa embarque.asientoId (legacy exige asientoZonaPrimariaId na 2268); desconsolidar() (desconsolidacion.ts:131-170, asiento HABER 1.1.5.04 na 263) e avanzarEstadoContenedor (contenedor.ts:380-410) não validam arribo; UI também sem gating.

### [ALTA] ✅ CONFIRMADO Revertir zona primaria em embarque Modelo Y não verifica contenedores desconsolidados
- **Arquivo**: src/lib/actions/embarques.ts:970
- **Evidência**: `// 1) Revertir el ingreso de stock en ZPA (deleta MovimientoStock
//    ligados a ItemEmbarque + recalcula stockActual y SPD).
await revertirIngresoEmbarque(tx, embarqueId);

// 2) Anular el asiento ZP
await anularAsiento(embarque.asientoZonaPrimariaId, tx);`
- **Descrição**: Guards: só asientoId e despachos ativos (linhas 951-968). Num embarque Modelo Y com contenedor já DESCONSOLIDADO (sem despacho), revertir anula o asiento de arribo (débito 1.1.5.04) mas o asiento de traslado 04→05 e o stock do DF (MovimientoStock ligado a itemContenedorId, não a ItemEmbarque) permanecem → 1.1.5.04 fica negativa e o DF guarda stock órfão de um embarque "revertido".
- **Recomendação**: Bloquear revertirZonaPrimariaAction se houver Desconsolidacion (ou MovimientoStock com contenedorId) ligada ao embarque: exigir anular desconsolidações primeiro.
- **Veredito**: Confirmado: guards (embarques.ts:945-968) só checam asientoId e despachos; desconsolidación cria MovimientoStock por itemContenedorId (desconsolidacion.ts:239-251) e asiento 05←04, sem Despacho. revertirIngresoEmbarque (stock.ts:340) só deleta por itemEmbarqueId; UI exibe o botão nesse estado.

### [ALTA] ✅ CONFIRMADO Granularidade de arredondamento divergente entre desconsolidación e nacionalização → resíduo permanente em 1.1.5.05
- **Arquivo**: src/lib/services/desconsolidacion.ts:236
- **Evidência**: `const arsUnitario = grupo.fcPromedio.times(tipoCambio);
montoTotalARS = montoTotalARS.plus(arsUnitario.times(grupo.cantidad));
...
costoUnitario: money(arsUnitario),`
- **Descrição**: O débito de 1.1.5.05 no traslado usa Σ(fcPromedio×TC×qty) sem arredondar por unidade (toFixed(2) só no total); o crédito na nacionalização usa nacionalizadoArs = Σ round2(round2(FC×TC)×qty) (despacho-parcial.ts:862-866). Ex.: FC 10.1234 × TC 1399.5 × 2000 un → 28.335.396,60 debitado vs 28.335.400,00 creditado: 1.1.5.05 fica negativa em ARS 3,40 após despachar tudo. Mesma classe do bug de 1ct já documentado (helper agregado vs asiento granular).
- **Recomendação**: Alinhar granularidade: na desconsolidación, arredondar arsUnitario a 2dp antes de multiplicar por cantidad (igual ao round2 por unidade do landed), em asiento, MovimientoStock e SPD.
- **Veredito**: Confirmado: desconsolidacion.ts:236-237/266 debita 1.1.5.05 com Σ(fcPromedio×TC×qty) arredondado 1x no total (toFixed(2)); o crédito usa nacionalizadoArs = Σ round2(round2(FC×TC)×qty) (despacho-parcial.ts:862-866, asiento-automatico.ts:2745-2749). FC é Decimal(18,4), TC (18,6) → >2dp é comum; sem ajuste residual em lugar nenhum. Resíduo permanente em 1.1.5.05.

### [ALTA] ✅ CONFIRMADO Invariante débito 1.1.5.04 == Σ FC×cant×TC quebra por dupla perda de precisão no cerrarCostos
- **Arquivo**: src/lib/services/contenedor.ts:622
- **Evidência**: `fcPorProducto.set(r.productoId, precioUnitario(toDecimal(r.costoUnitario).dividedBy(tc)));`
- **Descrição**: r.costoUnitario já é round2(costoTotal/cantidad) (comex.ts:184-185), perdendo o resíduo que o last-item-absorbs reconciliou; depois divide por TC e corta a 4dp. Reconvertendo FC×TC×cant, o erro chega a ~0,07 ARS/unidade (TC 1400) — dezenas/centenas de ARS por SKU vs o débito 1.1.5.04 do arribo (calculado direto de FOB+facturas). O resíduo nunca sai de 1.1.5.04. Além disso, o embarque segue editável após cerrarCostos (guard só em asientoZonaPrimariaId, embarques.ts:512), deixando FC stale.
- **Recomendação**: Derivar FC de costoTotal/cantidad sem o round2 intermediário (4-6dp) e ratear o resíduo; invalidar/recalcular costoFCUnitario quando o embarque for editado após cerrarCostos.
- **Veredito**: Confirmado: contenedor.ts:622 divide costoUnitario (já round2, comex.ts:185) por TC e corta a 4dp (decimal.ts:36). Arribo debita 1.1.5.04 por totais; desconsolidação credita Σ fc×TC×cant (desconsolidacion.ts:236) sem sweep do resíduo. Guard só em asientoZonaPrimariaId (embarques.ts:512).

### [ALTA] ✅ CONFIRMADO Facturas DESPACHO auto-emitidas (EMITIDA) não capitalizam no despacho cruzado nem são reclassificadas
- **Arquivo**: src/lib/services/asiento-automatico.ts:2687
- **Evidência**: `const facturasDespacho = embarque.costos.filter(
  (f) => f.despachoId === despacho.id && f.momento !== "ZONA_PRIMARIA" && (f.estado === "BORRADOR" || f.estado === "LEGACY_BUNDLED"),
);`
- **Descrição**: O arribo trata facturas ZP EMITIDA reclassificando gasto 5.x → 1.1.5.04 (asiento-automatico.ts:1844-1851). O cruzado apenas EXCLUI as EMITIDA: o subtotal fica em gasto 5.x e não entra no costo landed (stock/1.1.5.01 subavaliados). Cenário comum: guardarEmbarqueAction auto-emite costos com fechaFactura (embarques.ts:627-637), e actualizarTributosDespachoCruzadoAction permite linkar EMITIDA sem aviso (despachos.ts:1162-1173 só valida momento). Contraria a decisão A (custos de nacionalização capitalizam).
- **Recomendação**: No cruzado, reclassificar facturas DESPACHO EMITIDA (HABER cuenta 5.x da emissão, somando o subtotal ao landed), espelhando o arribo; ou bloquear o link de EMITIDA com mensagem clara.
- **Veredito**: Confirmado: filtro em asiento-automatico.ts:2687 exclui EMITIDA sem reclassificar (arribo ZP reclassifica em 1844-1851). embarques.ts:627 auto-emite DESPACHO com fechaFactura; UI (despachos/page.tsx:53-58) e action (despachos.ts:1162) permitem linkar EMITIDA sem checar estado. Custo fica em 5.x; stock (despachos.ts:532-535) e 1.1.5.01 subavaliados.

### [ALTA] Edição de embarque deleta facturas BORRADOR já linkadas a despacho (variante do gap a)
- **Arquivo**: src/lib/actions/embarques.ts:574
- **Evidência**: `await tx.embarqueCosto.deleteMany({
  where: { embarqueId, estado: "BORRADOR" },
});`
- **Descrição**: O reconcile da edição apaga TODOS os EmbarqueCosto BORRADOR do embarque e os recria do payload — inclusive facturas momento=DESPACHO criadas por crearCostoDespachoCruzadoAction com despachoId setado. As recriadas nascem sem despachoId: o despacho BORRADOR perde silenciosamente suas facturas e a contabilização capitaliza menos custo (subtotal some do landed e do HABER proveedor).
- **Recomendação**: Excluir do deleteMany as facturas com despachoId != null (ou reconciliar por id preservando o vínculo), e avisar na UI quando houver facturas linkadas a despachos em edição.

### [MEDIA] Remover produto na edição do embarque orfana o packing list (SetNull) e quebra a matriz
- **Arquivo**: src/lib/actions/embarques.ts:562
- **Evidência**: `const idsABorrar = itemsActuales
  .filter((i) => !productosInput.has(i.productoId))
  .map((i) => i.id);
if (idsABorrar.length > 0) {
  await tx.itemEmbarque.deleteMany({ where: { id: { in: idsABorrar } } });
}`
- **Descrição**: Resíduo do gap (a): a reconciliação por productoId preserva ids, mas remover um produto deleta o ItemEmbarque e ItemContenedor.itemEmbarqueId vira NULL (schema.prisma:925, onDelete: SetNull). A linha some da matriz (filtro itemEmbarqueId not null, despacho-parcial.ts:651) e materializar falha com ITEM_SIN_ITEM_EMBARQUE. Não há guard que bloqueie remover produto quando existe packing list referenciando-o.
- **Recomendação**: Antes do deleteMany, verificar se algum ItemContenedor referencia os ItemEmbarque a borrar e bloquear a edição com mensagem (remover primeiro a linha do packing list).

### [MEDIA] Edição recomputa costoTotal/cifTotal só com facturas do payload (BORRADOR), ignorando EMITIDA
- **Arquivo**: src/lib/actions/embarques.ts:424
- **Evidência**: `const costosSubtotalArs = input.costos.reduce((acc, factura) => {
  const tc = toDecimal(factura.tipoCambio);
  const subtotalFactura = factura.lineas.reduce((a, l) => a.plus(toDecimal(l.subtotal)), toDecimal(0));
  return acc.plus(subtotalFactura.times(tc));
}, toDecimal(0));`
- **Descrição**: O form de edição filtra facturas EMITIDA/LEGACY/ANULADA do payload (comentário em embarques.ts:569-573), mas costoTotal e cifTotal do header são recalculados apenas de input.costos. Qualquer salvamento de um embarque com facturas EMITIDA subavalia cifTotal/costoTotal persistidos — e o CIF alimenta calcularTributosSugeridos (base DIE/Tasa/IVA), induzindo tributos sugeridos menores.
- **Recomendação**: Na edição, somar também os subtotais das facturas existentes não-ANULADA que não vêm no payload (consulta às persistidas) antes de gravar cifTotal/costoTotal.

### [MEDIA] Código de despacho gerado por count: eliminar um BORRADOR causa colisão de código único
- **Arquivo**: src/lib/actions/despachos.ts:239
- **Evidência**: `const existentes = await tx.despacho.count({
  where: { codigo: { startsWith: `${embarqueCodigo}-D` } },
});
return `${embarqueCodigo}-D${existentes + 1}`;`
- **Descrição**: Despacho.codigo é @unique (schema.prisma:777). Com D1 e D2 criados, eliminar D1 (eliminarDespachoAction) faz o count cair para 1 → próximo código "D2" colide com o existente → P2002 → "Error inesperado al crear despacho", bloqueando novos despachos do embarque até intervenção manual. Mesmo padrão duplicado em despacho-parcial.ts:571-576 e em siguienteNumeroTransferenciaDespacho (stock.ts:795-806).
- **Recomendação**: Derivar o sufixo do maior código existente (max + 1, parseando o N de -DN) em vez de count, ou usar sequence/retry em P2002.

### [MEDIA] concluirInvestigacion neteia FALTA e SOBRA entre SKUs distintos
- **Arquivo**: src/lib/services/divergencia-investigacion.ts:318
- **Evidência**: `const netoUSD = inv.items.reduce(
  (acc, it) => acc.plus(it.valorImpactadoUSD),
  new Prisma.Decimal(0),
);
...
const tipo = netoUSD.isNegative() ? "FALTA" : "SOBRA";`
- **Descrição**: Um contenedor com falta de 10 pneus caros e sobra de 10 baratos gera um único asiento pelo neto: a sobra compensa a falta, reduzindo o valor a cobrar do responsável (cuentaPorCobrar) e omitindo o ingreso por diferencia. Se os valores se anulam, não sai asiento nenhum, apesar de haver falta real com responsável identificado. Mistura tratamentos contábeis que a própria decisão D9 quis separar por causa-raíz.
- **Recomendação**: Gerar linhas separadas por direção (Σ faltas → crédito subcuenta + débito perda/a cobrar; Σ sobras → débito subcuenta + haber ingreso), sem compensar entre SKUs.

### [MEDIA] Factura virtual FOB do pago exterior exclui flete/seguro origen creditados ao proveedor
- **Arquivo**: src/lib/actions/pago-exterior.ts:590
- **Evidência**: `const totalUsd = embarque.items.reduce(
  (acc, i) => acc.plus(new Decimal(i.precioUnitarioFob.toString()).times(i.cantidad)),
  new Decimal(0),
);`
- **Descrição**: O arribo credita o proveedor exterior por FOB + valorFleteOrigen + valorSeguroOrigen (asiento-automatico.ts:1766-1816). A "factura virtual" embarqueFob só soma FOB: em embarques CIF/CFR o saldo USD pagável fica subestimado e o guard "excede el saldo pendiente" (linha 248-253) impede cancelar a dívida completa por esse path, deixando resíduo permanente na cuenta do proveedor.
- **Recomendação**: Incluir valorFleteOrigen e valorSeguroOrigen no totalUsd da factura virtual embarqueFob, espelhando totalProveedorExteriorArs do arribo.

### [MEDIA] Match por tokens contamina saldos entre facturas do mesmo proveedor/embarque
- **Arquivo**: src/lib/actions/pago-exterior.ts:652
- **Evidência**: `const matchEmb = factura.embarqueCodigo !== null && tokens.has(factura.embarqueCodigo);
if ((matchNumero || matchEmb) && l.asiento.movimiento) {
  pagado = pagado.plus(new Decimal(l.asiento.movimiento.monto.toString()));`
- **Descrição**: pagadoUsdDeFactura soma qualquer pagamento cuja descrição contenha o código do embarque na cuenta do proveedor. Pagar a factura FOB virtual (descrição inclui o código) faz o mesmo pagamento contar também contra um EmbarqueCosto USD do mesmo proveedor/embarque (e vice-versa): saldos subestimados e pagamentos legítimos rejeitados com "no tiene saldo USD pendiente". embarqueFob nem tem tabela de aplicação (linha 365-367), só o match.
- **Recomendação**: Usar as tabelas AplicacionPago* como fonte primária (criar uma para embarqueFob) e deixar o match de tokens só como fallback para asientos antigos.

### [MEDIA] pagarVepDespachoAction sem guard condicional de estado — corrida permite pagamento duplo
- **Arquivo**: src/lib/actions/vep-despacho.ts:151
- **Evidência**: `if (vep.estado === "PAGADO") {
  throw new AsientoError("ESTADO_INVALIDO", "El VEP ya está pagado.");
}
...
await tx.vepDespacho.update({ where: { id: vep.id }, data: { estado: "PAGADO", ... } });`
- **Descrição**: O check de estado é um findUnique seguido de update incondicional. Em read-committed, duas requisições simultâneas leem GENERADO, ambas passam o guard e ambas criam asiento + MovimientoTesoreria debitando os mesmos pasivos 2.1.5.x duas vezes. O código tem o padrão correto em outros pontos (updateMany condicional com count, ex. asiento-automatico.ts:1919-1928), mas não aqui nem em pagarVepEmbarqueAction.
- **Recomendação**: Trocar por updateMany({ where: { id, estado: { in: ["GENERADO","VENCIDO"] } }, data: { estado: "PAGADO" } }) e abortar se count !== 1, antes de criar o asiento.

### [MEDIA] VEP montoTotal arredonda a soma 1 vez; asiento e pagamento arredondam por tributo
- **Arquivo**: src/lib/actions/despachos.ts:938
- **Evidência**: `const montoTotal = toDecimal(d.die).plus(toDecimal(d.tasaEstadistica)).plus(toDecimal(d.arancelSim)).plus(toDecimal(d.iva)).plus(toDecimal(d.ivaAdicional)).plus(toDecimal(d.iibb)).plus(toDecimal(d.ganancias)).times(tc).toDecimalPlaces(2);`
- **Descrição**: crearOActualizarVepDespacho soma os 7 tributos em moeda e converte/arredonda uma única vez; o asiento do despacho (asiento-automatico.ts:2756-2762) e pagarVepDespachoAction (vep-despacho.ts:157-169) convertem e arredondam CADA tributo a 2dp antes de somar. Com TC decimal (ex. 1399,5) os half-cents divergem: o VEP exibido difere por centavos dos pasivos contabilizados, deixando resíduos em 2.1.5.x após o pagamento. Mesma lição do bug do 1ct no D4.
- **Recomendação**: Alinhar granularidade: em crearOActualizarVepDespacho, converter e arredondar cada tributo a 2dp individualmente antes de somar (igual ao asiento e ao pagamento).

### [MEDIA] Nacionalização cruzada exige/usa depósito destino do EMBARQUE para todas as linhas
- **Arquivo**: src/lib/actions/despachos.ts:485
- **Evidência**: `if (!embarque?.depositoDestinoId) {
  throw new AsientoError("DOMINIO_INVALIDO", `Embarque ${embarque?.codigo}: definí depósito destino antes de contabilizar.`);
}`
- **Descrição**: Resíduo legado já mapeado: o destino é conceito por despacho/contenedor (Contenedor.depositoDestinoId existe no schema), mas contabilizarDespachoAction exige embarque.depositoDestinoId e o aplica a todas as linhas de aplicarNacionalizacionDF (linha 604). Um embarque cujos contenedores nacionalizam para depósitos NACIONAL distintos não é suportado, e o zod do form /nuevo segue exigindo o destino nacional (embarque-form.tsx:155).
- **Recomendação**: Aceitar depósito destino por despacho (input na contabilização ou Contenedor.depositoDestinoId) com fallback no do embarque; relaxar a exigência no form.

### [MEDIA] avanzarEstadoContenedor permite pular etapas do ciclo físico-aduaneiro
- **Arquivo**: src/lib/services/contenedor.ts:380
- **Evidência**: `if (ESTADO_RANK[input.targetEstado] <= ESTADO_RANK[contenedor.estado]) {
  throw new ContenedorError("ESTADO_TRANSICION_INVALIDA", `No se puede pasar de ${contenedor.estado} a ${input.targetEstado} (sólo se avanza en el ciclo).`);
}`
- **Descrição**: O guard só impede retroceder; qualquer salto para frente é aceito (BORRADOR → EN_DEPOSITO_FISCAL direto), deixando fechas de fase nulas (fechaIngresoZpa etc.) e sem depositoZonaPrimariaId (só o DF é obrigatório). A doc descreve transições sequenciais; a mensagem da UI até diz "no se puede ... saltar etapas" (contenedores.ts:121), mas o service não valida adjacência.
- **Recomendação**: Validar transição adjacente (target == próximo estado no ciclo) ou exigir explicitamente as fechas/depósitos das fases puladas; alinhar mensagem da action ao comportamento real.

### [MEDIA] validarInvariantePackingList não tem nenhum caller no fluxo — invariante de consolidação nunca é imposta
- **Arquivo**: src/lib/services/contenedor.ts:669
- **Evidência**: `export async function validarInvariantePackingList(
  embarqueId: string,
  tx?: TxClient,
): Promise<PackingListValidacion> {`
- **Descrição**: grep no src não encontra callers fora da definição. A invariante Σ ItemContenedor.cantidadDeclarada == ItemEmbarque.cantidad não é checada em guardarEmbarque (edição de cantidades), avanzarEstado, cerrarCostos, arribo nem desconsolidar. Packing list sub/sobre-declarado passa silencioso: o arribo debita 1.1.5.04 pelos totais do embarque e a desconsolidación credita pelas quantidades do packing list → resíduo (ou crédito a maior) permanente em 1.1.5.04.
- **Recomendação**: Chamar validarInvariantePackingList como gate no avanzar a EN_DEPOSITO_FISCAL (ou no arribo Modelo Y) e como warning na edição do embarque quando há contenedores.

### [BAIXA] anularDespachoAction deleta o VepDespacho, contrariando comentário e documentação (trail)
- **Arquivo**: src/lib/actions/despachos.ts:815
- **Evidência**: `// Marcar VepDespacho como ANULADO (no eliminarlo — preserva trail).
...
await tx.vepDespacho.delete({ where: { id: vep.id } });`
- **Descrição**: O comentário e docs/fluxo-zona-primaria.md:237 ("VepDespacho marcado ANULADO (não eliminado — preserva trail)") prometem soft-delete, mas o código deleta o registro. Perde-se o rastro do VEP gerado (montos, datas) ao anular um despacho; auditoria do piloto não consegue reconstituir o histórico.
- **Recomendação**: Marcar estado ANULADO em vez de delete (o upsert de crearOActualizarVepDespacho precisa então tratar re-contabilização sobre VEP anulado), ou corrigir comentário/doc se delete for a decisão.

### [BAIXA] EmbarqueCosto USD emitida não é pagável enquanto o embarque está antes de EN_ZONA_PRIMARIA
- **Arquivo**: src/lib/actions/pago-exterior.ts:31
- **Evidência**: `const ESTADOS_EMBARQUE_CON_SALDO: EmbarqueEstado[] = [
  EmbarqueEstado.EN_ZONA_PRIMARIA,
  EmbarqueEstado.EN_ADUANA,
  EmbarqueEstado.DESPACHADO,
  EmbarqueEstado.EN_DEPOSITO,
  EmbarqueEstado.CERRADO,
];`
- **Descrição**: Resquício do gap (d) do piloto: uma factura EmbarqueCosto USD EMITIDA standalone (asiento próprio, CxP real, ex. flete internacional pago antes do arribo) é bloqueada por cargarFactura (linha 503-508) se o embarque ainda está EN_PUERTO/EN_TRANSITO. A dívida contábil existe mas o pagamento pelo fluxo exterior é rejeitado até avançar o estado do embarque. O mesmo filtro existe em getSaldosExteriorPorProveedor (cuentas-a-pagar.ts:1731-1735).
- **Recomendação**: Para EmbarqueCosto EMITIDA (asientoId != null), aceitar o pagamento independente do estado do embarque — o fato gerador é a emissão da factura, não o arribo.

### [BAIXA] expirarBorradorAction sem checagem de ownership do borrador
- **Arquivo**: src/lib/actions/despachos.ts:1239
- **Evidência**: `const parsed = expirarBorradorSchema.safeParse(input);
if (!parsed.success) return { ok: false, error: "Datos inválidos." };
try {
  await expirarBorrador(parsed.data.borradorId);`
- **Descrição**: gateBorrador só valida flag + sessão; expirarBorrador (despacho-parcial.ts:166-199) não compara userId. Qualquer usuário autenticado que conheça/adivinhe o id pode expirar o borrador de outro operador, liberando a trava de counters que ele tinha reservado (a reserva some no meio da operação). contabilizarBorradorAction tem o mesmo padrão (sem ownership), permitindo contabilizar borrador alheio.
- **Recomendação**: Nas actions de borrador, validar borrador.userId === session.user.id (ou exigir permissão explícita) antes de expirar/contabilizar.


---

## 5. Falhas de lógica — Ventas / Stock / CMV

## Resumo
Auditoria de vendas/entregas/stock/CMV encontrou 1 falha crítica e 8 altas. O ponto mais grave é a divergência entre o caminho vivo e o replay do custo: recalcularSPDPorProducto ignora o costoUnitario das patas TRANSFERENCIA, zerando/corrompendo o costoPromedio de depósitos abastecidos pelo fluxo padrão ZPA/DF→NACIONAL após qualquer anulação. Há descasamento sistemático de CMV (venta usa Producto.costoPromedio; entrega usa SPD.costoPromedio, deixando resíduo em 1.1.5.03), buracos de estado (entrega de venta cancelada confirmável; anulación direta de asiento de venta/entrega sem reverter stock/reservas) e um bypass aduaneiro via transferência manual ZPA→NACIONAL. Vendas criadas a partir de pedido omitem percepción IIBB e fixam IVA 21%. Concorrência em reserva/egreso é read-then-write sem lock, permitindo stock negativo. O bug histórico de CMV=0 do despacho cruzado está mitigado no caminho incremental, mas ressurge via replay e via emissão silenciosa sem linhas de CMV quando costoPromedio=0.

## Achados

### [CRITICA] ✅ CONFIRMADO Replay de SPD perde custo das transferências (CMV zerado/corrompido)
- **Arquivo**: src/lib/services/stock-recalc.ts (lógica em src/lib/services/stock.ts):913
- **Evidência**: `} else if (m.tipo === MovimientoStockTipo.AJUSTE || m.tipo === MovimientoStockTipo.TRANSFERENCIA) { // AJUSTE: cantidad signed; TRANSFERENCIA: -X origen / +X destino. cur.stock += m.cantidad; }`
- **Descrição**: recalcularSPDPorProducto (stock.ts:885-943) não promedia o costoUnitario da pata destino de TRANSFERENCIA, enquanto o caminho vivo (aplicarTransferenciaSPD→aplicarIngresoSPD) promedia. Depósito NACIONAL abastecido só por transferências (fluxo padrão ZPA/DF→NACIONAL) fica com costoPromedio=0 após qualquer replay (anular despacho/embarque dispara revertir*→recalcularSPDPorProducto), corrompendo o custo do stock remanescente de OUTROS despachos. Entregas passam a usar custo 0 (CMV errado) ou são bloqueadas (totalCosto=0 lança erro).
- **Recomendação**: Em recalcularSPDPorProducto, tratar TRANSFERENCIA com cantidad>0 como ingreso (calcularNuevoPromedio com m.costoUnitario), espelhando recalcularStockYCostoPromedio (stock.ts:408-417).
- **Veredito**: Confirmado: stock.ts:915-921 soma TRANSFERENCIA sem promediar (costoUnitario ignorado), mas o caminho vivo aplicarTransferenciaSPD promedia via aplicarIngresoSPD (l.607). Upsert l.928 grava costoPromedio=0 no NACIONAL (só TRANSFERENCIA no Modelo Y); entregas.ts:245 lê 0 e o asiento lança erro.

### [ALTA] ✅ CONFIRMADO CMV da venta usa Producto.costoPromedio mas entrega baixa por SPD.costoPromedio
- **Arquivo**: src/lib/services/asiento-automatico.ts:2987
- **Evidência**: `const totalCosto = venta.items.reduce((acc, it) => acc.plus(toDecimal(it.producto.costoPromedio).times(it.cantidad)), ...)  // vs entregas.ts:245: const costoUnit = stock.costoPromedio;`
- **Descrição**: crearAsientoVenta credita 1.1.5.03 MERCADERIAS_A_ENTREGAR pelo costoPromedio GLOBAL do produto; crearAsientoEntrega debita a mesma conta pelo costoPromedio do DEPÓSITO (snapshot em ItemEntrega.costoUnitario). Com múltiplos depósitos NACIONAL de custos distintos (nacionalizações em TCs diferentes), a provisória 1.1.5.03 nunca fecha — acumula resíduo permanente e o CMV no resultado diverge do valor de baixa física de mercaderías.
- **Recomendação**: Usar a mesma base nas duas pontas: calcular CMV da emissão pelo SPD do depósito reservado (it.depositoId ?? default), ou cancelar 1.1.5.03 na entrega pelo mesmo valor creditado na emissão (rateado por quantidade).
- **Veredito**: Confirmado: venta usa producto.costoPromedio global (asiento-automatico.ts:2989) creditando 1.1.5.03; entrega debita por SPD.costoPromedio do depósito (entregas.ts:245→ItemEntrega.costoUnitario, asiento:3219). Médias mantidas separadas (stock.ts:378 global vs :444 por depósito); nenhuma reconciliação fecha o resíduo; STOCK_DUAL_ENABLED=true no .env.

### [ALTA] ✅ CONFIRMADO Entrega BORRADOR de venta CANCELADA pode ser confirmada
- **Arquivo**: src/lib/actions/entregas.ts:269
- **Evidência**: `const entrega = await loadEntregaForConfirm(tx, entregaId); ... ensureEntregaConfirmable(entrega); for (const it of entrega.items) { await aplicarEgresoFisicoItem(tx, entrega, it); }`
- **Descrição**: confirmarEntregaAction só valida estado/asiento da ENTREGA; ensureVentaEmitida roda apenas em crearEntregaAction. Fluxo: venta EMITIDA → entrega BORRADOR criada → anularVentaAction (libera reservas, anula asiento, CANCELADA — só bloqueia entregas CONFIRMADAS) → confirmar a entrega ainda funciona: egresa stock físico, decrementa cantidadReservada já liberada (fica negativa) e cria asiento que debita 1.1.5.03 cujo crédito foi revertido.
- **Recomendação**: Revalidar a venta no confirm: carregar venta.estado em loadEntregaForConfirm e lançar erro se != EMITIDA. Opcionalmente anular/deletar entregas BORRADOR ao anular a venta.
- **Veredito**: Confirmado: anularVentaAction filtra entregas where estado:"CONFIRMADA" (ventas.ts:870), BORRADOR sobrevive; confirmarEntregaAction só checa entrega via ensureEntregaConfirmable (entregas.ts:209-219), sem checar venta. aplicarEgresoSPD decrementa reserva já liberada (negativa, sem constraint) e asiento debita 1.1.5.03 revertido.

### [ALTA] ✅ CONFIRMADO anularAsientoAction anula asiento de venta/entrega sem reverter stock/reservas
- **Arquivo**: src/lib/actions/asientos.ts:110
- **Evidência**: `// bloqueia só ZP e despacho: const embarqueZP = ...; const despachoLinkado = ...; try { const asiento = await anularAsiento(asientoId); — e anularEnTx: await tx.venta.updateMany({ where: { asientoId }, data: { asientoId: null, estado: "CANCELADA" } });`
- **Descrição**: A anulação genérica via /contabilidad/asientos só bloqueia asientos de ZP e despacho. Para asiento de VENTA: marca CANCELADA mas não libera reservas SPD, não checa entregas confirmadas nem anula cheques/flete (tudo que anularVentaAction faz). Para asiento de ENTREGA: anularEnTx (asiento-automatico.ts:497-536) nem detacha entregaVenta — fica CONFIRMADA apontando para asiento ANULADO, stock não restaurado, e anularEntregaAction depois falha (asiento já não está CONTABILIZADO): entrega travada para sempre.
- **Recomendação**: Bloquear em anularAsientoAction asientos vinculados a Venta/EntregaVenta (como já se faz com ZP/despacho), direcionando para anularVentaAction/anularEntregaAction.
- **Veredito**: Confirmado: asientos.ts:121-140 só bloqueia ZP/despacho. anularEnTx (asiento-automatico.ts:519-522) cancela venta sem liberarReservasAnulacion/cheques/flete (ventas.ts:892-923) e não detacha entregaVenta; entregas.ts:350-352 então lança ESTADO_INVALIDO — entrega CONFIRMADA fica irrecuperável pela UI.

### [ALTA] ✅ CONFIRMADO Item sem depositoId: reserva no default mas entrega sai de qualquer depósito
- **Arquivo**: src/lib/actions/entregas.ts:231
- **Evidência**: `const itemDepId = it.itemVenta.depositoId; if (itemDepId && itemDepId !== entrega.depositoId) { throw ... } // ventas.ts:782: const depId = it.depositoId ?? defaultDepId; await aplicarReservaSPD(tx, ..., depId, ...)`
- **Descrição**: Na emissão, itens com depositoId null reservam no depósito default (getDepositoPorDefecto). Na confirmação da entrega, o guard de mismatch só roda quando itemDepId está setado — com null, o egreso sai do depósito escolhido no form (qualquer NACIONAL): aplicarEgresoSPD decrementa cantidadFisica E cantidadReservada nesse depósito, deixando reservada negativa lá e reserva fantasma no default. Ventas criadas de pedido sempre têm depositoId null, então é cenário comum.
- **Recomendação**: Quando itemDepId for null, resolver getDepositoPorDefecto na confirmação e exigir entrega.depositoId igual (ou migrar a reserva); persistir o depósito resolvido no ItemVenta na emissão.
- **Veredito**: Confirmado: ventas de pedido criam ItemVenta sem depositoId (pedidos-venta.ts:302); reserva vai ao default (ventas.ts:782); guard de entregas.ts:232 só roda com itemDepId setado; aplicarEgresoSPD (stock.ts:501-502) decrementa reservada no depósito do form sem piso. Sem reconciliação em runtime.

### [ALTA] ✅ CONFIRMADO Transferência manual ZPA→NACIONAL nacionaliza mercadoria sem despacho nem asiento
- **Arquivo**: src/lib/actions/transferencias.ts:136
- **Evidência**: `await ensureDepositoActivoConId(tx, input.depositoOrigenId, "origen"); await ensureDepositoActivoConId(tx, input.depositoDestinoId, "destino"); await validarDisponible(...); // nenhum check de Deposito.tipo`
- **Descrição**: crearTransferenciaAction valida apenas que os depósitos estão ativos — não restringe tipo. Uma transferência ZPA→NACIONAL move stock sob custódia aduaneira para depósito vendível (SPD NACIONAL alimenta disponible das ventas) sem despacho, sem tributos e sem o asiento 1.1.5.04→1.1.5.01: stock físico vendível diverge da contabilidade (saldo segue em mercadería en ZPA). Também não recalcula Producto.stockActual, mesmo a transferência cruzando a fronteira NACIONAL.
- **Recomendação**: Bloquear (ou exigir fluxo de despacho para) transferências com origem/destino ZONA_PRIMARIA; após transferência envolvendo depósito NACIONAL, chamar recalcularStockYCostoPromedio.
- **Veredito**: Confirmado: transferencias.ts:135-138 não checa Deposito.tipo; nueva/page.tsx:29 lista todos depósitos ativos (inclui ZPA); ventas.ts:155/178 vendem só de NACIONAL. Vias legítimas (stock.ts:662/742) recalculam Producto e têm asiento; a manual não — diverge stock×contabilidade.

### [ALTA] ✅ CONFIRMADO Anular despacho ZPA/cruzado não recalcula agregado do Producto
- **Arquivo**: src/lib/services/stock.ts:850
- **Evidência**: `for (const productoId of productoIds) { await recalcularSPDPorProducto(tx, productoId); ... } // revertirTransferenciaDespacho não chama recalcularStockYCostoPromedio (compare revertirIngresoDespacho:315-318 que chama ambas)`
- **Descrição**: revertirTransferenciaDespacho (usado por anularDespachoAction nos fluxos ZPA e cruzado — despachos.ts:773/793) deleta movimentos e recalcula apenas SPD. Producto.stockActual/costoPromedio continuam incluindo a quantidade nacionalizada recém-revertida. Como crearAsientoVenta calcula o CMV pelo Producto.costoPromedio, a próxima emissão de venta usa custo/stock stale até algum outro evento disparar replay.
- **Recomendação**: Em revertirTransferenciaDespacho, chamar recalcularStockYCostoPromedio para cada productoId afetado, igual a revertirIngresoDespacho/revertirIngresoEmbarque.
- **Veredito**: Confirmado: stock.ts:851 só chama recalcularSPDPorProducto; revertirIngresoDespacho (316-317) chama ambas. Forward paths (714/791) recalculam Producto pois aplicarTransferenciaSPD não toca Producto. despachos.ts:773/793 não compensa. CMV usa producto.costoPromedio (asiento-automatico.ts ~2985).

### [ALTA] ✅ CONFIRMADO Reserva/egreso de stock sem lock: corrida permite stock negativo
- **Arquivo**: src/lib/actions/ventas.ts:786
- **Evidência**: `await validarDisponible(tx, it.productoId, depId, it.cantidad); await aplicarReservaSPD(tx, it.productoId, depId, it.cantidad); // aplicarReservaSPD: cantidadReservada: { increment: cantidad } — sem condição`
- **Descrição**: validarDisponible lê SPD e aplicarReservaSPD incrementa sem condição nem SELECT FOR UPDATE; transações Prisma rodam em READ COMMITTED por default. Duas emissões simultâneas do mesmo produto/depósito leem o mesmo disponible e ambas reservam → reservada > física. Mesmo padrão em confirmarEntregaAction (check de cantidadFisica em entregas.ts:239 + decrement cego em aplicarEgresoSPD) e validarTopeItemVenta — schema não tem CHECK, então valores negativos persistem.
- **Recomendação**: Usar update condicional (updateMany com where cantidadFisica/reservada suficiente e checar count) ou SELECT ... FOR UPDATE / isolationLevel Serializable nos fluxos de reserva, egreso e tope de entrega.
- **Veredito**: Confirmado: ventas.ts:786-787 faz check-then-act; aplicarReservaSPD (stock.ts:524) incrementa sem condição e doc diz "NO valida disponibilidad". Sem isolationLevel/FOR UPDATE nesse path (só desconsolidacion.ts:110 tem lock), sem CHECK no schema (linha 1550). Mesmo padrão em entregas.ts:239/261.

### [ALTA] Venta criada de pedido omite percepción IIBB e fixa IVA 21%
- **Arquivo**: src/lib/actions/pedidos-venta.ts:259
- **Evidência**: `const ivaCalc = toDecimal(subtotalCalc).times(0.21).toDecimalPlaces(2); ... iibb: money("0"), // sem percepcionIIBB/percepcionIIBBAlicuota/jurisdiccion no tx.venta.create`
- **Descrição**: crearVentaDesdePedidoAction cria a Venta sem calcular calcularPercepcionIIBB — percepcionIIBB fica no default 0 e crearAsientoVenta não lança DEBE 5.5.02 / HABER 2.1.3.05. Se o operador emite direto (sem reabrir e salvar pelo form, que recalcula), a percepção de cliente CABA é silenciosamente omitida (pasivo fiscal subavaliado). Além disso IVA é hardcoded 21% para todos os itens, ignorando alíquotas diferenciadas.
- **Recomendação**: Reutilizar em crearVentaDesdePedidoAction o mesmo cálculo de guardarVentaAction (lookup clienteFiscal + calcularPercepcionIIBB) e parametrizar a alíquota de IVA por item.

### [MEDIA] crearAsientoVenta soma cheques sem filtrar estado ANULADO
- **Arquivo**: src/lib/services/asiento-automatico.ts:2955
- **Evidência**: `chequesRecibidos: { select: { importe: true } }, ... const totalCheques = venta.chequesRecibidos.reduce((acc, c) => acc.plus(toDecimal(c.importe)), toDecimal(0))`
- **Descrição**: anularVentaAction marca cheques como ANULADO mas mantém o vínculo ventaId (ventas.ts:910-913). Como anularAsiento deixa a venta re-emitível (asientoId null), uma re-emissão sem reeditar o form (que recriaria os cheques) soma os cheques ANULADOS no DEBE 1.1.4.20 VALORES A COBRAR, registrando cobro por valores que não existem mais em carteira.
- **Recomendação**: Filtrar chequesRecibidos por estado != ANULADO no select de crearAsientoVenta (e idealmente desvincular ventaId ao anular).

### [MEDIA] Emissão com costoPromedio=0 omite CMV silenciosamente
- **Arquivo**: src/lib/services/asiento-automatico.ts:3099
- **Evidência**: `if (totalCosto.gt(0)) { ... DEBE CMV / HABER MERCADERIAS_A_ENTREGAR ... } // nenhum warning/bloqueio quando totalCosto == 0`
- **Descrição**: Se Producto.costoPromedio=0 (dados legados do bug do despacho cruzado, produto sem replay, ou flag stock-dual desligada sem validação de stock), a venta emite sem nenhuma linha de CMV — resultado bruto superavaliado sem aviso. Se a entrega depois tem SPD.costoPromedio>0, debita 1.1.5.03 que nunca foi creditado; se também for 0, crearAsientoEntrega lança erro e a entrega fica bloqueada.
- **Recomendação**: Bloquear (ou exigir confirmação explícita) a emissão de venta com item de costoPromedio=0 e stock>0; logar/alertar a omissão de CMV.

### [MEDIA] Producto.stockActual nunca decrementa em entregas
- **Arquivo**: src/lib/actions/entregas.ts:261
- **Evidência**: `await aplicarEgresoSPD(tx, productoId, entrega.depositoId, it.cantidad); // só SPD; nenhum update de Producto.stockActual/costoPromedio nem recalc`
- **Descrição**: A confirmação de entrega cria MovimientoStock EGRESO e baixa o SPD, mas Producto.stockActual só é mantido incrementalmente nos ingressos (aplicarIngresoProducto) e corrigido em replays de reversão. Entre uma entrega e o próximo replay, o agregado fica superavaliado — afeta listarProductosConStock (seletor de transferências, inventario.ts:63) e a tela de maestros, induzindo decisões sobre stock que já saiu.
- **Recomendação**: Decrementar Producto.stockActual no egreso quando o depósito for NACIONAL (espelho de aplicarIngresoProducto), ou derivar stockActual de SUM(SPD NACIONAL) nas leituras.

### [MEDIA] Mesmo pedido pode ser faturado várias vezes
- **Arquivo**: src/lib/actions/pedidos-venta.ts:249
- **Evidência**: `if (pedido.estado === PedidoEstado.CANCELADO || pedido.estado === PedidoEstado.COMPLETADO) { return { ok: false, ... } } // estado do pedido nunca é atualizado após criar a venta`
- **Descrição**: crearVentaDesdePedidoAction só bloqueia CANCELADO/COMPLETADO e não transiciona o pedido após criar a venta, nem verifica se já existe Venta com pedidoVentaId apontando para ele. Dois cliques (ou dois usuários) geram ventas duplicadas do mesmo pedido, cada uma emitível com reserva de stock e asiento próprios.
- **Recomendação**: Na transação, checar venta existente com pedidoVentaId=pedido.id (ou constraint unique) e/ou transicionar o pedido para COMPLETADO ao faturar.

### [MEDIA] Transição de estado de pedido sem validação de máquina de estados
- **Arquivo**: src/lib/actions/pedidos-venta.ts:217
- **Evidência**: `export async function transicionarPedidoVentaAction(id: number, nuevoEstado: PedidoEstado) { ... await db.pedidoVenta.update({ where: { id }, data: { estado: nuevoEstado } });`
- **Descrição**: Qualquer transição é aceita sem guard: COMPLETADO→BORRADOR, CANCELADO→CONFIRMADO etc. Um pedido já faturado pode voltar a BORRADOR e ser refaturado (combina com o achado de faturamento múltiplo), e pedidos cancelados podem ser revividos sem trilha.
- **Recomendação**: Validar transições permitidas (mapa estado_atual→estados_válidos) dentro de uma transação que leia o estado atual antes do update.

### [MEDIA] crearEntregaAction não valida que os itens pertencem à venta informada
- **Arquivo**: src/lib/actions/entregas.ts:142
- **Evidência**: `for (const it of input.items) { await validarTopeItemVenta(tx, it.itemVentaId, it.cantidad); } // validarTopeItemVenta busca itemVenta por id sem comparar itemVenta.ventaId com input.ventaId`
- **Descrição**: O payload aceita qualquer itemVentaId existente: uma entrega pode ser criada vinculada à venta A com itens da venta B. O tope é validado contra a venta B, mas o egreso/asiento sai associado à venta A — corrompe saldoPendientePorItemVenta e o rastreio de entregas das duas ventas. Explorável por chamada direta da server action (a UI normal não gera isso).
- **Recomendação**: Em validarTopeItemVenta (ou no create), selecionar itemVenta.ventaId e lançar erro se diferente do input.ventaId.

### [MEDIA] Anular transferência não desfaz média ponderada do destino
- **Arquivo**: src/lib/actions/transferencias.ts:199
- **Evidência**: `await moverCantidadFisica(tx, t.productoId, t.depositoOrigenId, t.depositoDestinoId, t.cantidad); // só move quantidades; costoPromedio do destino (já promediado no create via aplicarIngresoSPD) não é recalculado`
- **Descrição**: Na criação, o destino promedia o custo da transferência (aplicarIngresoSPD). Na anulação, moverCantidadFisica apenas devolve quantidades — o costoPromedio do destino permanece contaminado pela mistura, e o do origem recebe de volta a quantidade pelo promedio atual (não o custo com que saiu). Não há recalc de SPD nem de Producto. Entregas posteriores do destino usam esse custo distorcido no CMV.
- **Recomendação**: Após reverter, chamar recalcularSPDPorProducto (com o fix do achado crítico de TRANSFERENCIA) e recalcularStockYCostoPromedio para o produto.

### [MEDIA] Depósito default resolvido em momentos diferentes pode liberar reserva no lugar errado
- **Arquivo**: src/lib/actions/ventas.ts:796
- **Evidência**: `const defaultDepId = await getDepositoPorDefecto(tx); for (const it of items) { const depId = it.depositoId ?? defaultDepId; await liberarReservaSPD(tx, it.productoId, depId, it.cantidad); }`
- **Descrição**: Itens com depositoId null reservam no default da EMISSÃO, mas liberarReservasAnulacion resolve o default no momento da ANULAÇÃO. getDepositoPorDefecto pega o primeiro NACIONAL ativo em ordem alfabética — se um depósito novo foi criado/renomeado/desativado no intervalo, a liberação decrementa cantidadReservada de outro SPD (fica negativa) e a reserva original vira fantasma permanente.
- **Recomendação**: Persistir o depósito resolvido no ItemVenta na emissão (preencher depositoId quando null) e liberar sempre pelo valor persistido.

### [MEDIA] recalcularReservasPorProducto ignora ItemVenta.depositoId e tem default divergente
- **Arquivo**: src/lib/services/stock-recalc.ts:51
- **Evidência**: `const defaultDepId = await getDepositoPorDefectoTx(tx); ... pendientesPorDep.set(defaultDepId, (pendientesPorDep.get(defaultDepId) ?? 0) + pendiente); // e fallback: const primero = await tx.deposito.findFirst({ where: { activo: true } ...`
- **Descrição**: O recálculo de reservas agrupa TODO pendente no depósito default, ignorando ItemVenta.depositoId (S3.1 já entregue — o próprio comentário do arquivo admite a pendência). Pior: getDepositoPorDefectoTx busca por nome "NACIONAL" e cai para QUALQUER depósito ativo (pode ser ZONA_PRIMARIA), divergindo de stock-helpers.getDepositoPorDefecto (que filtra tipo). Rodar o validador/fixer move reservas para depósito errado.
- **Recomendação**: Usar it.depositoId ?? default por item e alinhar getDepositoPorDefectoTx ao critério tipo=NACIONAL de stock-helpers (compartilhar a função).

### [BAIXA] Origem de transferências de despacho decrementada sem validar disponível
- **Arquivo**: src/lib/services/stock.ts:592
- **Evidência**: `await tx.stockPorDeposito.update({ where: { productoId_depositoId: { ... depositoId: params.depositoOrigenId } }, data: { cantidadFisica: { decrement: params.cantidad }, ... } });`
- **Descrição**: aplicarTransferenciaSPD só exige que o row de origem exista — não valida cantidadFisica suficiente. Nos fluxos automáticos (aplicarTransferenciaDespacho/aplicarNacionalizacionDF) a guarda real são os counters de ItemContenedor; se eles divergirem do SPD (ex.: ajuste manual, replay com bug), o ZPA/DF fica com física negativa silenciosamente.
- **Recomendação**: Adicionar validarDisponible (ou check de cantidadFisica >= cantidad) na origem dentro de aplicarTransferenciaSPD, com erro DOMINIO_INVALIDO.

### [BAIXA] Numeração V-AAAA-NNNN quebra a partir de 10000 (ordenação lexicográfica)
- **Arquivo**: src/lib/actions/ventas.ts:310
- **Evidência**: `const ultimo = await db.venta.findFirst({ where: { numero: { startsWith: prefix } }, orderBy: { numero: "desc" }, ... }); ... return `${prefix}${String(next).padStart(4, "0")}`;`
- **Descrição**: orderBy por string: depois de existir V-2026-10000, "V-2026-9999" continua sendo o maior lexicográfico → next sempre 10000 → P2002 em toda criação com número automático. Mesmo padrão em generarNumeroEntrega (R-), generarNumeroTransferencia (T-), generarNumeroGastoEnTx (G-) e pedidos (OV-).
- **Recomendação**: Padronizar largura maior (padStart 6) ou extrair o máximo numérico via raw query/parse de todos os sufixos, ou usar sequence do banco.

### [BAIXA] Cliente sem provincia/jurisdicción zera percepción IIBB silenciosamente
- **Arquivo**: src/lib/services/percepcion-iibb.ts:49
- **Evidência**: `const jurisdiccion = cliente.provincia?.jurisdiccionIIBB; if (!jurisdiccion?.esAgentePercepcion) return CERO;`
- **Descrição**: Cliente de CABA com cadastro incompleto (provincia null ou provincia sem jurisdiccionIIBB vinculada) gera percepción 0 sem nenhum aviso no form de venta — a obrigação de agente de percepção é omitida e só seria detectada em fiscalização/conciliação. É design documentado, mas não há sinalização ao operador.
- **Recomendação**: Exibir warning no form quando cliente não tem provincia (e validar provincia obrigatória para clientes não-exentos), ou logar ventas emitidas com percepción 0 por cadastro incompleto.

### [BAIXA] getCotizacionParaFecha sem cotização anterior usa TC futuro
- **Arquivo**: src/lib/services/cotizacion.ts:50
- **Evidência**: `const fallback = await db.cotizacion.findFirst({ orderBy: { fecha: "asc" } }); // se não há cotización <= fecha, devolve a mais ANTIGA, que é necessariamente POSTERIOR à fecha pedida`
- **Descrição**: Quando não existe cotização anterior ou igual à data pedida, o fallback devolve a cotização mais antiga do banco — que por construção é de data futura à consultada. Valuações/relatórios de datas anteriores ao primeiro registro usam um TC de outra época sem indicação, distorcendo saldos USD convertidos.
- **Recomendação**: Retornar null (ou marcar o resultado como aproximado) quando não houver cotização <= fecha, deixando o caller decidir; documentar o comportamento nos consumidores.

### [BAIXA] eliminarProductoAction não checa todas as referências antes do hard delete
- **Arquivo**: src/lib/actions/productos.ts:244
- **Evidência**: `const [embarqueCount, compraCount, ventaCount, stockCount] = await Promise.all([db.itemEmbarque.count..., db.itemCompra.count..., db.itemVenta.count..., db.movimientoStock.count...]);`
- **Descrição**: O soft-delete só é acionado se houver referência em itemEmbarque/itemCompra/itemVenta/movimientoStock. Produto referenciado apenas em itemPedidoVenta, itemContenedor, itemPedidoCompra, transferencia ou stockPorDeposito (row criado por ensureStockPorDeposito sem movimento) cai no hard delete e falha com P2003 não tratado → "Error inesperado al eliminar el producto" sem explicação.
- **Recomendação**: Incluir as demais tabelas na checagem (ou capturar P2003 e converter em soft-delete/mensagem clara).

### [BAIXA] Guard de entregas confirmadas vira no-op com flag stock-dual desligada
- **Arquivo**: src/lib/actions/ventas.ts:848
- **Evidência**: `function ensureSinEntregasConfirmadas(entregas: readonly { numero: string }[]): void { if (entregas.length === 0 || !isStockDualEnabled()) return; ...`
- **Descrição**: Se STOCK_DUAL_ENABLED for desativada depois de existirem entregas confirmadas, anularVentaAction passa direto: o asiento da venta é revertido mas o stock egresado e o asiento da entrega ficam órfãos (entrega CONFIRMADA de venta CANCELADA). A flag protege fluxos novos, mas dados criados sob a flag continuam existindo quando ela desliga.
- **Recomendação**: Basear o guard na existência de dados (entregas.length > 0) e não na flag — a flag deve gatear criação de entregas, não a proteção de consistência.


---

## 6. Falhas de lógica — Tesorería / CxC / CxP / Extractos

## Resumo
Auditoria de tesorería/CxC/CxP/extractos/préstamos em 13 arquivos. O problema estrutural mais grave é a convenção inconsistente de unidades no ledger: movimientos USD simples gravam debe/haber em USD (asiento moneda=USD) enquanto transferências, Fase 2, compras, préstamos e pago-exterior gravam ARS — e todos os agregadores de saldo (cuenta bancária, extracto, CxC, CxP, préstamos) somam debe/haber sem filtrar moneda, misturando moedas na mesma cuenta. Em cima disso, o pago exterior grava ARS em asiento marcado USD, fazendo getSaldosExteriorPorProveedor ler pesos como dólares (pagamento parcial zera o saldo USD), e os pagos Fase 2 (asiento forçado a ARS) somem da mesma view. Há ainda TC hardcoded em 1 na aprovação de extratos USD, FIFO Layer 4 que ignora pagadoFk (divergente entre as duas cópias do algoritmo), validação prometida e ausente de appliedTo.montoArs, e match de pagos por subset de tokens que duplica créditos entre facturas. Nos extratos não há detecção de duplicidade contra movimentos já lançados manualmente, e nos préstamos USD a validação de saldo compara TCs incompatíveis, bloqueando quitações legítimas.

## Achados

### [CRITICA] ✅ CONFIRMADO Asientos USD de tesorería gravam debe/haber em USD enquanto o resto do ledger é ARS — saldos misturam moedas
- **Arquivo**: src/lib/services/asiento-automatico.ts:924
- **Evidência**: `const valor = money(mov.monto).toString(); ... lineas = [{ cuentaId: contrapartidaId, debe: valor, haber: 0 }, { cuentaId: bancoCuentaId, debe: 0, haber: valor }]; ... moneda: esFase2 ? Moneda.ARS : mov.moneda`
- **Descrição**: COBRO/PAGO USD não-Fase2 grava linhas com o valor em USD cru (mov.monto) em asiento moneda=USD. Já transferências (origenArs=monto×tc), Fase 2, compras e préstamos gravam ARS na MESMA cuenta. calcularSaldoCuentaBancaria, getExtractoBancario, CxC/CxP e balance somam debe/haber sem filtrar moneda — uma cuenta bancária USD que recebe um COBRO USD (unidades USD) e uma transferência (unidades ARS) exibe saldo somando USD+ARS.
- **Recomendação**: Padronizar: gravar sempre ARS (monto×tc) em debe/haber com monedaOrigen/montoOrigen=USD na metadata, ou filtrar/converter por asiento.moneda em todos os agregadores de saldo (cuenta-bancaria.ts, extracto-bancario.ts, CxC/CxP).
- **Veredito**: Confirmado: linha 763 valor=money(mov.monto) (USD cru) vai a debe/haber (893-914) com moneda=mov.moneda (924), enquanto pago-exterior.ts:280 grava montoArs e transferência origenArs (1033) na mesma cuenta; calcularSaldoCuentaBancaria/balance somam sem converter; usdOrigen (770) nunca é usado.

### [CRITICA] ✅ CONFIRMADO Aprovação de linha de extrato USD usa tipoCambio hardcoded "1"
- **Arquivo**: src/lib/actions/extractos.ts:137
- **Evidência**: `const moneda = linea.importacion.cuentaBancaria.moneda;
const tipoCambio = moneda === Moneda.ARS ? "1" : "1";`
- **Descrição**: O ternário retorna "1" nos dois ramos — claramente um placeholder. Aprovar linha de extrato de cuenta USD cria MovimientoTesoreria e asiento USD com TC=1. Se a contrapartida é proveedor USD-nato, a Fase 2 dispara com arsPago = usd×1, gerando ganancia/pérdida cambiaria espúria gigantesca contabilizada no ledger; senão, o asiento USD fica com TC errado para qualquer conversão posterior.
- **Recomendação**: Exigir TC do dia para extratos USD (input do usuário ou cotización) e rejeitar aprovação sem TC válido; corrigir o ternário.
- **Veredito**: Confirmado: extractos.ts:137 tem `moneda === Moneda.ARS ? "1" : "1"` (ambos ramos "1"). Sem guard: extractos-import.ts:103/127 aceita USD e a página lista todas as cuentas. TC=1 flui para asiento-automatico.ts:765/819 — Fase 2 gera dif. cambiaria espúria (spread=arsFactura−usd×1) contabilizada na hora; demais casos gravam asiento USD com TC=1, contra a convenção de movimientos-tesoreria.ts:237 (TC>0 real p/ USD).

### [ALTA] ✅ CONFIRMADO getSaldosExteriorPorProveedor lê debe em ARS como se fosse USD para pagos do pagarFacturaExteriorAction
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:1677
- **Evidência**: `const neto = debe.minus(haber); ... arr.push({ neto, tokens: tokenizar(l.descripcion) }); // pago-exterior.ts:280 grava debe: montoArs.toFixed(2) em asiento moneda=USD`
- **Descrição**: pagarFacturaExteriorAction cria asiento moneda=USD com a linha DEBE do proveedor em ARS (montoArs = usd×TC). O filtro de lineasPago (asiento.moneda=USD + movimiento USD) inclui essas linhas e soma o debe ARS como pagadoUsd — superestimado ~TC vezes. Um pagamento parcial de USD 1.000 a TC 1.000 zera USD 1.000.000 de saldo: a factura some da view de saldos exterior com dívida real pendente. O validador pagadoUsdDeFactura usa movimiento.monto (correto) — view e validador divergem.
- **Recomendação**: Em lineasPago usar movimiento.monto (como pagadoUsdDeFactura) ou montoOrigen da linha, nunca debe/haber cru; adicionar teste com pagamento parcial via pago-exterior.
- **Veredito**: Confirmado: cuentas-a-pagar.ts:1677 soma debe-haber (ARS, cf. schema.prisma:446 "debe/haber...valuación en ARS") como pagadoUsd; pago-exterior.ts:280 grava debe=montoArs em asiento moneda=USD que casa o filtro 1650-1657. Sem conversão por TC. Validador (linha 654) usa movimiento.monto USD — view diverge e oculta facturas com saldo real.

### [ALTA] ❌ REFUTADO Pagos USD Fase 2 ficam invisíveis no saldo USD exterior (asiento forçado a ARS)
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:1652
- **Evidência**: `asiento: { estado: ..., moneda: Moneda.USD, movimiento: { tipo: PAGO, moneda: Moneda.USD } } // Fase 2: crearAsientoMovimientoTesoreria força moneda: esFase2 ? Moneda.ARS : mov.moneda`
- **Descrição**: A Fase 2 (diferencia cambiaria automática) força o asiento a moneda=ARS. O filtro de pagos USD em getSaldosExteriorPorProveedor exige asiento.moneda=USD, então pagos USD que dispararam Fase 2 (proveedor com Compra USD emitida, caso comum) não contam como pagadoUsd — o saldo USD do proveedor exterior não diminui após o pagamento.
- **Recomendação**: Filtrar por movimiento.tipo=PAGO + movimiento.moneda=USD apenas (sem exigir asiento.moneda=USD) e somar montoOrigen das linhas DEBE com monedaOrigen=USD.
- **Veredito**: Evidência confere (cuentas-a-pagar.ts:1652; asiento-automatico.ts:924), mas o pago exterior real usa pagarFacturaExteriorAction (pago-exterior.ts:317): crearAsientoManual moneda=USD, Fase 2 não dispara. No path genérico a línea PAGO não tem descripcion/tokens — já era invisível sem Fase 2.

### [ALTA] ✅ CONFIRMADO Fase 2 / diferencia cambiaria NÃO dispara em pago USD multi-contrapartida nem no pago via intermediario
- **Arquivo**: src/lib/actions/movimientos-tesoreria.ts:409
- **Evidência**: `for (const l of lineas) { asientoLineas.push({ cuentaId: l.cuentaContableId, debe: l.monto, haber: 0, ... }) } ... crearAsientoManual({ ..., moneda, tipoCambio, lineas: asientoLineas })`
- **Descrição**: Com 2+ contrapartidas (ou em pagarConIntermediarioAction), o asiento é manual: linhas com montos crus, sem calcularDiferenciaCambiariaPago, sem linhas 4.3.1.01/5.8.2.01 e sem monedaOrigen/montoOrigen. Um pago USD a proveedor USD-nato por esses fluxos não reconhece diferencia cambiaria e quebra o invariante de saldo USD (a linha DEBE não carrega USD), deixando resíduo ARS na cuenta do proveedor.
- **Recomendação**: Reusar calcularDiferenciaCambiariaPago por línea DEBE quando moneda=USD nos fluxos multi-contrapartida e intermediario, e sempre gravar monedaOrigen=USD/montoOrigen nas linhas de pasivo.
- **Veredito**: Confirmado: movimientos-tesoreria.ts:409-433 e 671-718 usam crearAsientoManual sem monedaOrigen/montoOrigen nem calcularDiferenciaCambiariaPago; Fase 2 só roda se lineas.length===1 (l.380). Saldo USD lê monedaOrigen=USD (cuentas-a-pagar.ts:114, libro-mayor.ts:153). UI pago-por-factura multi USD atinge o gap.

### [ALTA] ✅ CONFIRMADO Linha DEBE do pago exterior sem monedaOrigen=USD — saldo USD-nato e FIFO Fase 2 ignoram esses pagos
- **Arquivo**: src/lib/actions/pago-exterior.ts:277
- **Evidência**: `{ cuentaId: factura.cuentaProveedorId, debe: montoArs.toFixed(2), haber: 0, descripcion: `Cancelación ${refFactura}` } // sem monedaOrigen/montoOrigen`
- **Descrição**: O DEBE do proveedor não carrega monedaOrigen=USD/montoOrigen. Consequências: (1) saldoUsd de getCuentasAPagar (que neteia montoOrigen DEBE vs HABER) não diminui após o pago — dívida USD superestimada; (2) calcularDiferenciaCambiariaPago só subtrai DEBEs USD-natos, então um pago Fase 2 posterior consome parcelas HABER já quitadas via pago-exterior, calculando diferencia cambiaria e permitindo pagar de novo o que já foi pago.
- **Recomendação**: Gravar monedaOrigen=Moneda.USD, montoOrigen=montoUsd e tipoCambioOrigen=tcAplicado na linha DEBE do proveedor em pagarFacturaExteriorAction.
- **Veredito**: Confirmado: pago-exterior.ts:277-283 cria DEBE sem monedaOrigen; crearAsientoEnTx (asiento-automatico.ts:401) não propaga moneda do header. HABER de compra USD é USD-nato (3380-3386), saldoUsd (cuentas-a-pagar.ts:163) e FIFO Fase 2 (659-697) ignoram o pago.

### [ALTA] ✅ CONFIRMADO Validação de saldo de préstamo USD compara ARS a TC do dia contra saldo contábil a TC histórico
- **Arquivo**: src/lib/actions/movimientos-tesoreria.ts:344
- **Evidência**: `const intentoArs = new Decimal(linea.monto).times(new Decimal(tipoCambio))...;
const saldoCheck = await validarSaldoSuficientePrestamo(linea.cuentaContableId, intentoArs);`
- **Descrição**: Para préstamo USD, o saldo contábil ARS foi reconhecido ao TC da originação; o intento usa o TC do dia. Com desvalorização do ARS (cenário padrão), pagar o principal USD integral gera intentoArs > saldoActual e o pagamento é SEMPRE rejeitado ('excede el saldo pendiente'), mesmo sendo exatamente o saldo USD devido. A Fase 2 debitaria arsFactura (TC histórico), que é o valor que deveria ser validado.
- **Recomendação**: Para cuentas com linhas monedaOrigen=USD, validar em USD (montoOrigen pendente vs monto USD do pago) ou validar contra fifo.arsFactura de calcularDiferenciaCambiariaPago, não monto×TC do dia.
- **Veredito**: Confirmado: movimientos-tesoreria.ts:344 calcula intentoArs=monto×tipoCambio (TC dia) e valida contra calcularSaldoPrestamo (haber−debe ARS a TC histórico, prestamo.ts:59; originação USD em asiento-automatico.ts:577). Fase 2 debitaria arsFactura a TC histórico (linha 824), então o reject é falso positivo.

### [MEDIA] ✅ CONFIRMADO Layer 4 FIFO não subtrai pagadoFk no pendiente — pago sem ID alocado a factura já paga via Layer 0
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:818
- **Evidência**: `const pendienteFactura = f.totalArs.minus(f.pagadoNumero).minus(f.pagadoEmbarque); // cópia em getCuentasAPagarPorEmbarque:1258 inclui .minus(f.pagadoFk)`
- **Descrição**: Em getSaldosPorProveedorConAging, o FIFO de pagos sem identificador trata uma factura 100% paga via AplicacionPago* como pendente (pendienteFactura ignora pagadoFk) e consome nela o pago não atribuído; a factura realmente quitada pelo pago genérico continua listada como pendente. A cópia do mesmo algoritmo em getCuentasAPagarPorEmbarque subtrai pagadoFk — divergência entre as duas views. Alimenta o seletor 'Aplicar a facturas pendientes' (getFacturasPendientesPorCuenta), induzindo aplicação errada.
- **Recomendação**: Adicionar .minus(f.pagadoFk) no cálculo de pendienteFactura do Layer 4 (linha 818), igual à versão de getCuentasAPagarPorEmbarque.
- **Veredito**: Confirmado: linha 818 omite .minus(f.pagadoFk) enquanto a cópia em 1258-1261 o inclui (comentário 1251-52 prova a intenção). Porém Layer 3 (862-873) + guard saldoContable<=0 (836) neutralizam o caso de ledger limpo; só observável com deuda fantasma (comentado em 796-800). Severidade media.

### [MEDIA] Validação prometida de appliedTo.montoArs == monto não existe — Layer 0 aceita montos arbitrários
- **Arquivo**: src/lib/actions/movimientos-tesoreria.ts:174
- **Evidência**: `// El total de montoArs debe coincidir con `monto` (validado en superRefine).
appliedTo: z.array(aplicarPagoSchema).optional(),`
- **Descrição**: O comentário afirma que a soma de appliedTo[].montoArs é validada contra linea.monto no superRefine, mas o superRefine (linhas 208-244) só valida montos>0 e TC. O mesmo vale no pagoIntermediarioSchema. Um caller pode gravar AplicacionPago* com montoArs maior que o DEBE real; como Layer 0 é 'fonte de verdade' do CxP, facturas apareceriam pagas sem pago. Para movimentos USD não há regra definida se montoArs = monto×TC.
- **Recomendação**: Implementar no superRefine: Σ appliedTo.montoArs == monto (ARS) ou == monto×tipoCambio (USD), com tolerância de centavo; rejeitar caso contrário.

### [MEDIA] Match por subset de tokens credita o pago inteiro a cada factura mencionada (pagos multi-factura)
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:514
- **Evidência**: `const todosPresentes = numeroTokens.every((t) => l.tokens.has(t));
if (todosPresentes) pagado = pagado.plus(l.debe);`
- **Descrição**: Um pago com descrição 'Pago FC 001 FC 002' tem o neto INTEIRO somado em pagadoNumero de ambas as facturas (tokens de cada numero ⊆ tokens da linha). Com pago parcial, ambas aparecem quitadas e a soma atribuída excede o pago real, zerando o resto do FIFO Layer 4. Em CxC (cuentas-a-cobrar.ts:269) o efeito é pior: não há Layer 3 de reconciliação por factura, então buckets vencido/próximo ficam errados.
- **Recomendação**: Ratear o neto do asiento entre as facturas matched (proporcional ou FIFO) em vez de somar o total em cada uma; ou limitar pagado por factura ao seu totalArs antes de computar a soma atribuída.

### [MEDIA] CxC: FIFO duplica cobros quando dois clientes compartilham a mesma cuentaContable
- **Arquivo**: src/lib/services/cuentas-a-cobrar.ts:350
- **Evidência**: `const totalCobrosCuenta = cobrosTotalesPorCuenta.get(cuentaId) ?? toDecimal(0);
const sumaImputadaNumero = lista.reduce((acc, v) => acc.plus(v.cobradoNumero), toDecimal(0));
let resto = totalCobrosCuenta.minus(sumaImputadaNumero);`
- **Descrição**: O loop itera por cliente, mas resto é calculado com o total de cobros da CUENTA menos só as imputações do próprio cliente. Se clientes A e B apontam para a mesma cuentaContable (FK sem unicidade), o mesmo resto é aplicado integralmente às ventas de A e depois às de B — cobros contados em dobro e pendientes subestimados nos dois.
- **Recomendação**: Agrupar ventas por cuentaContableId (não por clienteId) antes do FIFO, ou impor unicidade de Cliente.cuentaContableId.

### [MEDIA] CxC aging oculta clientes sem cuentaContable própria mesmo com ventas pendentes
- **Arquivo**: src/lib/services/cuentas-a-cobrar.ts:402
- **Evidência**: `if (saldoContable.lte(UMBRAL_RESIDUAL)) continue; // saldoContable = c.cuentaContableId ? ... : toDecimal(0)`
- **Descrição**: Cliente sem cuentaContableId (ventas no fallback 1.1.3.01) tem saldoContable=0 e é filtrado do aging, mesmo com ventas EMITIDAS sem cobro — a dívida só aparece agregada na cuenta 1.1.3.01 de getCuentasACobrar, sem detalhamento nem aging. Cobros desses clientes também nunca são imputados (montoCobradoVenta retorna 0 com cuentaId null).
- **Recomendação**: Para clientes sem cuenta própria, calcular pendiente via ventas−cobros do fallback (filtrando por tokens do cliente) ou ao menos listá-los com flag 'sin cuenta' em vez de ocultá-los.

### [MEDIA] Layer 2 (cobertura ≥98%) zera grupo inteiro — até 2% de dívida real some da lista de facturas
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:781
- **Evidência**: `if (cobertura < COBERTURA_MINIMA) continue;
for (const f of grupo) { f.pagadoEmbarque = f.totalArs.minus(f.pagadoNumero); }`
- **Descrição**: Quando o pago por código de embarque cobre ≥98% do grupo, TODAS as facturas são zeradas. O resíduo de até 2% (em embarques grandes, milhões de ARS) permanece em saldoTotal/saldoContable mas nenhuma factura é listada como pendente — o Layer 3 só reconcilia quando pendientes > saldoContable, nunca o inverso. O usuário perde a referência de QUAL factura tem o resíduo a liquidar.
- **Recomendação**: Em vez de zerar, distribuir o pagoExtra via FIFO dentro do grupo deixando o resíduo na factura mais nova; ou listar uma pseudo-factura 'residuo embarque X' quando saldoContable > Σ pendientes.

### [MEDIA] Amortizações de préstamo identificadas por mov.cuentaContableId e somadas pelo mov.monto integral
- **Arquivo**: src/lib/services/prestamo.ts:38
- **Evidência**: `return { tipo: MovimientoTesoreriaTipo.PAGO, cuentaContableId, asiento: { estado: CONTABILIZADO } } ... _sum: { monto: true }`
- **Descrição**: Um pago multi-contrapartida (ex.: principal do préstamo + intereses 5.8.2.02 em um movimento) registra mov.cuentaContableId = primeira línea. Se o préstamo é a 1ª línea, resumirAmortizaciones/listarAmortizacionesPrestamo somam o monto TOTAL (principal+juros) como amortização; se não é a 1ª, a amortização fica invisível e anularPrestamoAction (contarAmortizaciones=0) permite anular o asiento de origem deixando DEBEs órfãos na cuenta.
- **Recomendação**: Derivar amortizações das lineaAsiento DEBE na cuenta do préstamo (não do MovimientoTesoreria.monto/cuentaContableId), como já faz calcularSaldoPrestamo.

### [MEDIA] getVepEmbarques: detecção de 'pagado' compara createdAt com fecha e exige código na descripcion do asiento
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:1437
- **Evidência**: `asiento: { estado: CONTABILIZADO, createdAt: { gt: e.asiento.fecha }, descripcion: { contains: e.codigo } }`
- **Descrição**: Mistura campos: createdAt (timestamp físico) do asiento de pago vs fecha (data contábil) do asiento do embarque. Pagos retro-datados ou importados com createdAt anterior à fecha do embarque nunca marcam pagado; asientos de pago cuja descripcion não contém o código exato (descrição manual, código só na línea) também não. O VEP aparece eternamente como não pago, induzindo pagamento duplicado.
- **Recomendação**: Comparar fecha contábil vs fecha (não createdAt) e buscar o código também nas descripciones das lineas DEBE; preferir DEBEs líquidos por cuenta em vez de heurística por descrição.

### [MEDIA] Período da importação de extrato = max(fecha) das linhas — extrato cruzando o mês bloqueia o mês seguinte
- **Arquivo**: src/lib/actions/extractos-import.ts:79
- **Evidência**: `const fechas = lineas.map((l) => new Date(`${l.fecha}T12:00:00Z`));
const last = fechas.reduce((a, b) => (a > b ? a : b));`
- **Descrição**: O período (year, month) vem da fecha mais recente parseada. Um extrato de maio com uma línea liquidada em 1º de junho (comum em cheques 48hs) ocupa o slot único (cuenta, junho) — o import do extrato real de junho é rejeitado ('Ya existe') e exige eliminar a importação de maio, perdendo aprovações. Também não há validação saldoInicial + Σ montos ≈ saldoFinal contra alucinação do parser IA.
- **Recomendação**: Derivar período da moda/mediana das fechas (ou do header do PDF) e validar a equação de saldos do extrato antes de gravar, rejeitando parse inconsistente.

### [MEDIA] Aprovação de linha de extrato não detecta movimento já registrado manualmente — asiento duplicado
- **Arquivo**: src/lib/actions/extractos.ts:140
- **Evidência**: `const mov = await tx.movimientoTesoreria.create({ data: { tipo, cuentaBancariaId..., monto: montoAbsStr, ..., referenciaBanco: linea.referenciaBanco } });`
- **Descrição**: aprobarLineaAction sempre cria movimento+asiento novos. Se o pago/cobro já foi lançado manualmente em tesorería (fluxo normal: pagar primeiro, conciliar extrato depois), aprovar a línea correspondente duplica o lançamento no ledger — duplica saída de banco e baixa de proveedor. Não há nem warning por referenciaBanco/comprobante/monto/fecha coincidentes na mesma cuenta.
- **Recomendação**: Antes de aprovar, buscar MovimientoTesoreria da mesma cuenta com referenciaBanco igual ou (monto, fecha±2d) coincidentes e exigir confirmação/permitir 'vincular' em vez de criar novo.

### [MEDIA] Saldos exterior: match por embarqueCodigo credita o mesmo pago a todas as facturas do embarque
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:1696
- **Evidência**: `const matchEmbarque = embarqueCodigo !== null && p.tokens.has(embarqueCodigo);
if (matchNumero || matchEmbarque) { pagado = pagado.plus(p.neto); }`
- **Descrição**: Em pagadoUsdParaFactura, um único pago USD cuja descrição contém o código do embarque (padrão do pagarFacturaExteriorAction: 'Cancelación FC-X AR-...') soma o neto inteiro em CADA factura do mesmo proveedor/embarque (Compra + EmbarqueCostos + virtual). Pagar a factura FOB pode zerar também a factura de serviços USD do mesmo embarque sem pagamento real.
- **Recomendação**: Priorizar match por numero; usar matchEmbarque apenas como fallback quando nenhuma factura do embarque deu match por numero, rateando o pago em vez de duplicá-lo.

### [MEDIA] Extracto bancário declara 'saldo en ARS' mas soma debe/haber crus de cuenta USD
- **Arquivo**: src/lib/services/extracto-bancario.ts:99
- **Evidência**: `const saldoInicial = toDecimal(saldoInicialAgg._sum.debe ?? 0).minus(toDecimal(saldoInicialAgg._sum.haber ?? 0)); // tipo: saldoFinal: string; // saldo acumulado en ARS`
- **Descrição**: Para cuenta bancária USD, as linhas vindas de movimientos USD simples estão em USD e as de transferências/Fase 2/préstamos em ARS; o extracto soma tudo num único saldo corrido rotulado ARS. O saldo corrido exibido não corresponde nem ao extrato USD do banco nem a uma valuação ARS — manifestação direta do mix de unidades no ledger.
- **Recomendação**: Exibir o extracto na moneda da cuenta usando montoOrigen quando disponível (ou converter linhas de asientos USD por tipoCambio), e validar a invariante de unidade por cuenta.

### [BAIXA] EmbarqueCosto sem fechaFactura usa new Date() como fecha — FIFO instável e factura sempre 'mais nova'
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:686
- **Evidência**: `fecha: (c.fechaFactura ?? new Date()).toISOString(),`
- **Descrição**: Facturas de embarque sem fechaFactura recebem o timestamp do request como fecha. No FIFO dos Layers 3/4 elas ordenam sempre por último (recebem pago genérico por último) e a ordem muda a cada render, tornando a distribuição de pagos sem ID não-determinística entre execuções.
- **Recomendação**: Usar uma data estável (createdAt do EmbarqueCosto ou fecha do asiento) como fallback em vez de new Date().

### [BAIXA] Histórico de pagos: take 500 antes de filtrar não-contabilizados e proveedor = primeira línea DEBE
- **Arquivo**: src/lib/services/historico-pagos.ts:106
- **Evidência**: `orderBy: { fecha: "desc" }, take: filtros.limit ?? 500, ... if (mov.asiento && mov.asiento.estado !== AsientoEstado.CONTABILIZADO) { continue; }`
- **Descrição**: O limit é aplicado no banco antes de descartar movimentos com asiento não contabilizado — páginas podem retornar menos itens e omitir pagos válidos mais antigos. Além disso, em pago multi-proveedor (intermediario) só o primeiro proveedor com línea DEBE é exibido, e o match de facturas por subset de tokens pode listar facturas de outro contexto com tokens coincidentes.
- **Recomendação**: Filtrar estado do asiento no where da query (asiento: { estado: CONTABILIZADO } OR asientoId null) e listar todos os proveedores com DEBE no asiento.

### [BAIXA] gravarAplicacionesPago assume ordem das lineas DEBE por id — frágil a linhas DEBE extras (pérdida cambiaria, IDCB)
- **Arquivo**: src/lib/actions/movimientos-tesoreria.ts:41
- **Evidência**: `const lineasDebe = await tx.lineaAsiento.findMany({ where: { asientoId, debe: { gt: 0 } }, select: { id: true }, orderBy: { id: "asc" } });`
- **Descrição**: O binding posicional bindings[i] → lineasDebe[i] funciona hoje porque as linhas extras (pérdida cambiaria Fase 2, crédito IDCB) são inseridas depois das contrapartidas. Qualquer mudança na ordem de montagem do asiento (ex.: inserir a línea de pérdida antes) vincularia AplicacionPago* à línea errada silenciosamente, corrompendo o Layer 0 do CxP.
- **Recomendação**: Vincular por cuentaId+monto em vez de posição, ou retornar os ids das linhas criadas em crearAsientoManual e passá-los explicitamente.


---

## 7. Falhas de lógica — Compras / Gastos / CRM / Simulación

## Resumo
Auditoria de lógica em compras, pedidos de compra, gastos, gastos fijos, CRM, simulação de importação e cotizaciones. A contabilização (IVA crédito, IIBB crédito, pasivo USD-nato) está em geral correta, mas há buracos de máquina de estados: compra CANCELADA pode ser emitida, e compra de mercadería emitida nunca movimenta stock/costoPromedio. O fluxo de gastos fijos é idempotente, porém anular o asiento direto na contabilidade trava o período para sempre (anularAsiento não desvincula GastoFijoRegistro). Na simulação, a feature nova de margen % bidirecional tem mutação de ref dentro do updater de setState (sobrescreve o valor digitado em StrictMode) e não trata margens < -100%; a base sugerida de percepción IIBB inclui o IVA, divergindo da base aduaneira usual. No CRM, o import de leads não deduplica dentro do próprio CSV, editar oportunidade não deriva estado do stage e o resumo via Anthropic SDK interpola dados do lead sem mitigação de prompt injection nem rate limit. Retenciones RG830 existem só no schema; nenhum fluxo as calcula.

## Achados

### [ALTA] ✅ CONFIRMADO Compra de mercadería emitida não movimenta stock nem atualiza costoPromedio
- **Arquivo**: src/lib/services/asiento-automatico.ts:3310
- **Evidência**: `const gastoDef = GASTO_POR_TIPO_PROVEEDOR[compra.proveedor.tipoProveedor]; ... lineas = [{ cuentaId: gastoCuentaId, debe: money(subtotal)...}] // MERCADERIA_LOCAL → 1.1.5.01 (ACTIVO); nenhum MovimientoStock é criado`
- **Descrição**: emitirCompraAction só cria asiento. Para proveedor MERCADERIA_LOCAL o débito vai a 1.1.5.01 Estoque (correto contabilmente), mas ItemCompra com productoId/cantidad nunca gera MovimientoStock nem recalcula stockActual/costoPromedio. Inventário físico diverge do saldo contábil e o CMV de vendas usa costoPromedio defasado — mesmo padrão de bug já visto no comex (despacho cruzado).
- **Recomendação**: Ao emitir compra com itens de produto, criar MovimientoStock de ingreso e recalcular costoPromedio/stockActual por item, ou bloquear itens de produto no módulo compras direcionando para comex.
- **Veredito**: Confirmado: emitirCompraAction (compras.ts:361-389) só cria asiento; crearAsientoCompra debita 1.1.5.01 (ACTIVO, cuenta-registry.ts:435). MovimientoStock não tem FK p/ compra (schema:1366-1386), stock.ts recalcula só de MovimientoStock, e zero referência a stock no módulo compras — ItemCompra exige productoId/cantidad.

### [ALTA] ✅ CONFIRMADO anularAsiento não desvincula GastoFijoRegistro: período fica travado permanentemente
- **Arquivo**: src/lib/services/asiento-automatico.ts:523
- **Evidência**: `await tx.compra.updateMany({ where: { asientoId }, ... }); await tx.gasto.updateMany({...}); await tx.embarqueCosto.updateMany({...}); // não há tx.gastoFijoRegistro.updateMany`
- **Descrição**: anularEnTx desvincula compra/gasto/venta/embarqueCosto, mas não GastoFijoRegistro. Se o usuário anula o asiento do gasto fijo pela tela de asientos, o registro fica órfão apontando para asiento ANULADO; registrarGastoFijoPeriodo segue bloqueado pela unique (gastoFijoId, year, month) e anularRegistroGastoFijoAction falha porque anularAsiento exige estado CONTABILIZADO (asiento-automatico.ts:475). O período nunca mais pode ser registrado nem o registro removido.
- **Recomendação**: Em anularEnTx, deletar ou desvincular GastoFijoRegistro do asiento anulado; em anularRegistroGastoFijoAction, pular anularAsiento quando o asiento já está ANULADO.
- **Veredito**: Confirmado: anularEnTx (asiento-automatico.ts:497-536) desvincula compra/gasto/venta/embarqueCosto mas não gastoFijoRegistro; anularAsientoAction só guarda ZP/despacho; registrarGastoFijoPeriodo bloqueia pelo unique (gasto-fijo.ts:46-61); anularRegistroGastoFijoAction falha pois anularEnTx exige CONTABILIZADO (linha 475) e dá rollback no delete.

### [MEDIA] ✅ CONFIRMADO emitirCompraAction não valida estado: compra CANCELADA pode ser emitida
- **Arquivo**: src/lib/actions/compras.ts:366
- **Evidência**: `select: { estado: true, asientoId: true, numero: true } ... if (c.asientoId) { throw new AsientoError("DOMINIO_INVALIDO", `Compra ${c.numero} ya tiene asiento.`); } // c.estado é lido mas nunca verificado`
- **Descrição**: anularCompraAction sem asiento marca estado=CANCELADA mas mantém asientoId=null. emitirCompraAction só checa asientoId, então uma compra anulada pode ser emitida depois, gerando asiento e cuenta a pagar de um documento cancelado. Contraste com contabilizarGastoAction (gastos.ts:289) que exige estado BORRADOR. guardarCompraAction também permite editar CANCELADA sem reverter para BORRADOR.
- **Recomendação**: Em emitirCompraAction, exigir c.estado === BORRADOR (como em gastos). Em guardarCompraAction, bloquear edição de CANCELADA ou resetar estado a BORRADOR ao salvar.
- **Veredito**: Confirmado: compras.ts:368 seleciona estado mas só checa asientoId (l.371); anularCompraAction (l.400-404) deixa CANCELADA com asientoId=null; crearAsientoCompra tampouco valida. Porém compras/[id]/page.tsx:23 só mostra o form Emitir em BORRADOR — explorável só por aba stale ou chamada direta da action.

### [MEDIA] crearCompraDesdePedido aplica IVA 21% hardcoded a todos os itens
- **Arquivo**: src/lib/actions/pedidos-compra.ts:267
- **Evidência**: `const ivaCalc = toDecimal(subtotalCalc).times(0.21).toDecimalPlaces(2); ... const iva = sub.times(0.21).toDecimalPlaces(2); // por item, linha 314`
- **Descrição**: A fatura criada a partir do pedido assume IVA 21% para todos os itens, sem considerar alíquota por produto (10,5% etc.) nem proveedor exterior/monotributista (IVA 0). A compra nasce BORRADOR e é editável, mas o IVA por item gravado em ItemCompra não é recalculável pela UI de compra (que recebe ivaPorcentaje do form), induzindo crédito fiscal errado se emitida sem revisão.
- **Recomendação**: Derivar a alíquota do produto/proveedor (ex.: condición IVA do proveedor; 0% para exterior) ou pedir confirmação da alíquota antes de criar a fatura.

### [MEDIA] crearCompraDesdePedido sem guard de duplicidade: N faturas para o mesmo pedido
- **Arquivo**: src/lib/actions/pedidos-compra.ts:256
- **Evidência**: `if (pedido.estado === PedidoEstado.CANCELADO || pedido.estado === PedidoEstado.COMPLETADO) { return { ok: false, ... } } // não verifica se já existe Compra com pedidoCompraId = pedido.id`
- **Descrição**: Compra.pedidoCompraId é Int? sem unique (schema.prisma). A action só bloqueia pedidos CANCELADO/COMPLETADO; clicar duas vezes (ou refazer depois) cria múltiplas compras BORRADOR para o mesmo pedido, e cada uma pode ser emitida, duplicando pasivo e IVA crédito.
- **Recomendação**: Verificar existência de Compra não-cancelada com pedidoCompraId igual antes de criar (ou unique parcial no schema) e avisar o usuário.

### [MEDIA] transicionarPedidoCompraAction aceita qualquer transição de estado
- **Arquivo**: src/lib/actions/pedidos-compra.ts:224
- **Evidência**: `await db.pedidoCompra.update({ where: { id }, data: { estado: nuevoEstado } }); // sem validar estado atual nem grafo de transições`
- **Descrição**: Não há máquina de estados: um pedido CANCELADO pode voltar a BORRADOR ou pular para COMPLETADO, e COMPLETADO pode ser cancelado, sem nenhuma checagem. Combinado com crearCompraDesdePedido (que só bloqueia CANCELADO/COMPLETADO no momento da chamada), permite faturar pedidos revividos indevidamente.
- **Recomendação**: Validar a transição contra um mapa de estados permitidos (BORRADOR→ENVIADO→CONFIRMADO→COMPLETADO; CANCELADO terminal) e rejeitar as demais.

### [MEDIA] Registro de gasto fijo não valida coerência entre fecha e período (year/month)
- **Arquivo**: src/lib/actions/gastos-fijos.ts:226
- **Evidência**: `const registrarSchema = z.object({ gastoFijoId..., year..., month..., fecha: z.coerce.date(), tipoCambio... }); // nenhuma checagem de que fecha pertence a month/year`
- **Descrição**: registrarGastoFijoPeriodo grava o registro do período (year, month) mas o asiento usa fecha livre digitada pelo usuário. É possível registrar o período 06/2026 com asiento datado 15/01/2026: a competência contábil (libro diario, posición IVA do mês) diverge do período marcado como registrado, sem aviso.
- **Recomendação**: Validar fecha.getUTCFullYear()===year && getUTCMonth()+1===month no schema (ou derivar fecha do período + diaVencimiento) antes de criar o asiento.

### [MEDIA] Gasto fijo em USD cria pasivo sem monedaOrigen/montoOrigen (saldo USD não invariante)
- **Arquivo**: src/lib/services/gasto-fijo.ts:126
- **Evidência**: `lineas.push({ cuentaId: proveedorPasivoId, debe: "0", haber: totalArs.toFixed(2), descripcion: `Cta. a pagar — ${gasto.proveedor.nombre}` }); // sem monedaOrigen/montoOrigen/tipoCambioOrigen`
- **Descrição**: crearAsientoCompra e crearAsientoGasto marcam a línea do pasivo USD com monedaOrigen/montoOrigen (feature dos PRs #174/#175) para manter saldo USD invariante a TC e habilitar diferencia cambiaria FIFO no pago. registrarGastoFijoPeriodo, para gasto fijo em USD, cria o pasivo só em ARS — o saldo USD do proveedor e a diferencia cambiaria automática não funcionam para esses lançamentos.
- **Recomendação**: Quando gasto.moneda===USD, incluir monedaOrigen: USD, montoOrigen: total (moeda origem) e tipoCambioOrigen na línea do pasivo, espelhando crearAsientoGasto.

### [MEDIA] Sugestão de tributos: base de percepción IIBB inclui o IVA
- **Arquivo**: src/lib/services/comex.ts:58
- **Evidência**: `const baseIibb = round2(baseTributaria.plus(iva)); const iibb = round2(baseIibb.times(ALICUOTAS_IMPORTACION.IIBB));`
- **Descrição**: calcularTributosSugeridos (usado na simulação e no embarque-form) calcula IIBB 2,5% sobre baseTributaria+IVA. A percepción IIBB aduaneira (SIRPEI) normalmente incide sobre a base imponible do IVA (CIF + derechos + tasa estadística), sem somar o IVA — a sugestão superestima a percepción em ~21% e infla o desembolso estimado da simulação versus o VEP real do despacho.
- **Recomendação**: Confirmar a base com o despachante e, se for o caso, mudar para baseIibb = baseTributaria; documentar a convenção adotada junto a ALICUOTAS_IMPORTACION.

### [MEDIA] Margen %: mutação de ref dentro do updater de setState sobrescreve valor digitado
- **Arquivo**: src/app/(dashboard)/comex/simulaciones/_components/simulacion-form.tsx:338
- **Evidência**: `setMargenInputs((prev) => { ... if (lastEditedRef.current[it.index] === "margen") { lastEditedRef.current[it.index] = null; continue; } ... });`
- **Descrição**: O updater de setMargenInputs tem efeito colateral (zera lastEditedRef). Updaters devem ser puros: em StrictMode (dev do Next 15) e sob re-render concorrente o React invoca o updater duas vezes — a 1ª consome o flag e a 2ª sobrescreve o margen recém-digitado pelo valor recalculado (ex.: usuário digita "3" a caminho de "30" e o input vira "3.00"). Bug da feature nova do branch atual.
- **Recomendação**: Mover a limpeza do ref para fora do updater (no corpo do useEffect, antes/depois do setState) ou guardar o flag em estado; manter o updater puro.

### [MEDIA] Import de leads: dedup ignora duplicatas dentro do próprio CSV
- **Arquivo**: src/lib/actions/import-leads.ts:134
- **Evidência**: `for (const row of validas) { const valor = row.data[dedupBy]; if (valor && setExistentes.has(valor)) { ignoradas.push(...) } else { insertaveis.push(row); } } // setExistentes nunca recebe os valores das filas aceitas`
- **Descrição**: aplicarDedup compara apenas contra leads já existentes no banco; duas filas do mesmo CSV com o mesmo cuit/email são ambas inseridas (Lead.email/cuit não têm unique no schema). Como CSVs de campanhas frequentemente repetem contatos, o cenário é comum. A comparação também é case-sensitive para email (John@x.com ≠ john@x.com), furando o dedup contra o banco.
- **Recomendação**: Adicionar valores aceitos ao set durante o loop (dedup intra-arquivo) e normalizar email com toLowerCase() em ambos os lados.

### [MEDIA] editarOportunidadAction troca stage sem derivar estado (inconsistência com moverStage)
- **Arquivo**: src/lib/actions/oportunidades.ts:186
- **Evidência**: `const updated = await db.oportunidad.update({ where: { id }, data: { ..., stageId: parsed.data.stageId, ... } }); // não consulta stage.esGanada/esPerdida nem ajusta estado`
- **Descrição**: moverStageAction deriva estado (GANADA/PERDIDA/ABIERTA) do stage destino, mas o form de edição grava stageId cru. Editar uma oportunidade para um stage esGanada deixa estado=ABIERTA (aparece como aberta no pipeline e nos KPIs dentro da coluna ganada); inversamente, uma GANADA editada para stage normal continua GANADA. Totais de abertas/ganhas do dashboard ficam errados.
- **Recomendação**: Em editarOportunidadAction, buscar o stage e aplicar a mesma derivação de estado de moverStageAction (ou reusar a função).

### [MEDIA] Kanban: oportunidades em stage desativado desaparecem do board
- **Arquivo**: src/lib/actions/pipeline.ts:53
- **Evidência**: `return db.pipelineStage.findMany({ where: { activo: true }, orderBy: { orden: "asc" }, ... }); // página kanban monta colunas só com stages ativos e cards por stageId`
- **Descrição**: editarStageAction permite activo=false em stage com oportunidades abertas (sem checagem de _count). O pipeline kanban (pipeline/page.tsx) lista todas as oportunidades ABIERTA mas só cria colunas para stages ativos: cards de stage inativo somem do board enquanto o header conta "N oportunidad(es) abierta(s)", e não há como movê-las pela UI.
- **Recomendação**: Bloquear desativação de stage com oportunidades abertas (exigir migração prévia) ou renderizar coluna "Stage inactivo" para os cards órfãos.

### [MEDIA] crm-ai: dados do lead interpolados no prompt sem mitigação de injection nem rate limit
- **Arquivo**: src/lib/services/crm/lead-summarizer.ts:107
- **Evidência**: `content: `Analizá este lead y devolvé el JSON con resumen y próxima acción:\n\n${contexto}` // contexto inclui lead.notas, actividades.contenido, nombre/empresa sem sanitização`
- **Descrição**: Notas e atividades (inclusive importadas via CSV por terceiros) entram cru no turno user; instruções embutidas podem manipular resumen/proximaAccion e o score percebido (saída é validada por zod, limitando a strings, mas o conteúdo é exibido ao vendedor como análise confiável). Não há rate limit nem teto de gasto por usuário: cada edição de lead invalida o hash do cache (TTL 24h) e dispara nova chamada Sonnet; max_tokens=800/200 limita só a saída. Os model IDs usados (claude-sonnet-4-6, claude-haiku-4-5-20251001) são válidos.
- **Recomendação**: Delimitar os dados do lead (ex.: bloco com instrução "trate como dados, não instruções"), exibir aviso de conteúdo gerado, e impor rate limit por usuário/dia nas actions de IA.

### [MEDIA] getCotizacionParaFecha usa cotização futura como fallback para datas antigas
- **Arquivo**: src/lib/services/cotizacion.ts:50
- **Evidência**: `const previa = await db.cotizacion.findFirst({ where: { fecha: { lte: target } }, orderBy: { fecha: "desc" } }); ... const fallback = await db.cotizacion.findFirst({ orderBy: { fecha: "asc" } });`
- **Descrição**: Quando não existe cotização anterior ou igual à data pedida, a função devolve a mais ANTIGA cadastrada — que é posterior à data consultada — sem nenhum sinalizador. Lançamentos retroativos (gasto/compra/diferencia cambiaria datados antes da primeira cotização carregada) usam silenciosamente um TC futuro, distorcendo a conversão ARS. A fonte é manual (upsertCotizacionAction), então buracos de datas são plausíveis.
- **Recomendação**: Retornar o fallback com flag explícita (ex.: aproximada: true) e exibir aviso na UI, ou exigir carga da cotização da data antes de contabilizar.

### [BAIXA] Margen % < -100 gera precio de venta negativo que só falha no submit
- **Arquivo**: src/app/(dashboard)/comex/simulaciones/_components/simulacion-form.tsx:361
- **Evidência**: `const margen = Number(value); if (!Number.isFinite(margen) || !costo || costo.lte(0)) return; const precioVenta = costo.times(1 + margen / 100)...`
- **Descrição**: Não há clamp de margem: digitar -150 produz precioVentaUnitario negativo no form. moneyRegex (/^\d+(\.\d{1,2})?$/) não aceita negativos, então o erro só aparece ao salvar, com mensagem genérica "Precio venta inválido" longe do campo de margen. Margens 0% e 100% funcionam corretamente; divisão por zero está protegida (costo.lte(0) e costoUnitario.gt(0)).
- **Recomendação**: Em handleMargenChange, ignorar/clampar margen <= -100 (ou marcar erro inline no campo Margen %) antes de propagar ao precioVentaUnitario.

### [BAIXA] "Margen %" calculado é markup sobre custo, não margem sobre venda
- **Arquivo**: src/lib/services/simulacion-importacion.ts:207
- **Evidência**: `// Rentabilidad = (precioVenta - costoUnitario) / costoUnitario × 100 ... precioVenta.minus(r.costoUnitario).dividedBy(r.costoUnitario).times(100)`
- **Descrição**: O campo rotulado "Margen %" divide pelo custo (markup), não pela venda (margem bruta). É consistente nos dois sentidos da feature bidirecional, mas comercialmente "margen 30%" costuma significar 30% do preço de venda — usuário pode precificar abaixo do pretendido (markup 30% = margem 23% sobre venda).
- **Recomendação**: Renomear o label para "Markup % s/ costo" ou oferecer toggle markup/margem; documentar a convenção no form.

### [BAIXA] moverStageAction reabre oportunidade GANADA/PERDIDA por drag sem confirmação
- **Arquivo**: src/lib/actions/oportunidades.ts:231
- **Evidência**: `let estado: OportunidadEstado = OportunidadEstado.ABIERTA; if (stage.esGanada) estado = OportunidadEstado.GANADA; else if (stage.esPerdida) estado = OportunidadEstado.PERDIDA;`
- **Descrição**: Arrastar uma oportunidade fechada (GANADA/PERDIDA) para uma coluna normal do kanban a reabre silenciosamente (estado=ABIERTA), alterando KPIs históricos ("Ganadas acumulado") sem qualquer confirmação ou trilha. Não há registro de fechaCierre, então a reabertura é indetectável.
- **Recomendação**: Exigir confirmação (ou bloquear) transição de oportunidade fechada para stage não-final; considerar persistir fechaCierre/auditoria de transições.

### [BAIXA] Stage pode ser criado com esGanada e esPerdida simultaneamente true
- **Arquivo**: src/lib/actions/pipeline.ts:18
- **Evidência**: `const stageSchema = z.object({ nombre..., esGanada: z.boolean().optional().default(false), esPerdida: z.boolean().optional().default(false), activo... }); // sem refine de exclusividade`
- **Descrição**: Nada impede um stage com esGanada=true e esPerdida=true. moverStageAction prioriza esGanada (else if), então oportunidades movidas para esse stage viram GANADA mesmo que a intenção fosse perdida; cerrarPerdidaAction também pode escolher esse stage como destino de perdida, gerando estado contraditório com o nome do stage.
- **Recomendação**: Adicionar .refine((v) => !(v.esGanada && v.esPerdida)) no stageSchema e validar também em editarStageAction.

### [BAIXA] Conversão de lead sem CUIT sempre cria cliente novo (clientes duplicados)
- **Arquivo**: src/lib/actions/leads.ts:260
- **Evidência**: `if (lead.cuit) { const existente = await tx.cliente.findUnique({ where: { cuit: lead.cuit } ... }); if (existente) return existente.id; } const nuevo = await tx.cliente.create({ ... });`
- **Descrição**: findOrCreateClienteFromLead só tenta casar por CUIT. Leads sem CUIT (comuns em import de CSV) sempre geram um Cliente novo com tipoCanal=MINORISTA e condicionIva=RI hardcoded, mesmo que já exista cliente com mesmo email/nome — duplicando o maestro de clientes e fragmentando histórico de vendas.
- **Recomendação**: Tentar match secundário por email (case-insensitive) e avisar/escolher na UI quando houver candidato; revisar defaults RI/MINORISTA.

### [BAIXA] listarSimulaciones calcula costo nacionalizado com arredondamento diferente do detalhe
- **Arquivo**: src/lib/actions/simulaciones-importacion.ts:99
- **Evidência**: `const tributosArs = toDecimal(s.die).plus(toDecimal(s.tasaEstadistica)).plus(toDecimal(s.arancelSim)).times(tcEmb); // detalhe arredonda cada tributo×TC a 2dp antes de somar (simulacion-importacion.ts:125-128)`
- **Descrição**: A lista soma DIE+TE+arancel e multiplica pelo TC uma vez, sem arredondar parcelas; calcularResumenSimulacion arredonda cada tributo convertido individualmente (round2). Com TCs quebrados (ex.: 1399,5) o total da lista difere em centavos do total do detalhe — mesmo padrão do bug de 1 centavo já documentado no D4 (helper agregado vs asiento granular).
- **Recomendação**: Reusar calcularResumenSimulacion (ou ao menos a mesma granularidade de arredondamento) em listarSimulaciones para garantir consistência lista/detalhe.

### [BAIXA] deducibleGanancias é persistido mas nenhum relatório fiscal o consome
- **Arquivo**: src/lib/actions/gasto-schema.ts:40
- **Evidência**: `deducibleGanancias: z.nativeEnum(DeduccionGanancias).default("NETO"), // grep: único consumo fora do form é badge em gasto-detail-view.tsx; nenhum service/reporte usa`
- **Descrição**: O campo de dedução de Ganancias (NETO/TOTAL/NO_DEDUCIBLE) é validado, persistido e testado (test/gasto-deducible-ganancias.test.ts confirma que o asiento não muda), mas não existe relatório de Ganancias que o agregue. Igualmente, ConceptoRG830/agenteRetencion existem no schema do proveedor sem nenhum cálculo de retención em compras, gastos ou pagos — classificação fiscal acumulada sem efeito prático.
- **Recomendação**: Planejar o relatório de deducciones de Ganancias que consuma o campo (e o fluxo de retenciones RG830 nos pagos) ou documentar como dívida consciente.

### [BAIXA] Asientos de compra e gasto fijo gravados com origen MANUAL
- **Arquivo**: src/lib/services/asiento-automatico.ts:3392
- **Evidência**: `origen: AsientoOrigen.MANUAL, // crearAsientoCompra; idem gasto-fijo.ts:137 (origen: AsientoOrigen.MANUAL) — enum tem GASTO/TESORERIA/COMEX disponíveis`
- **Descrição**: crearAsientoCompra e registrarGastoFijoPeriodo marcam os asientos como MANUAL, enquanto crearAsientoGasto usa GASTO e préstamos usam TESORERIA. Filtros e auditorias por origen no libro diario tratam asientos gerados automaticamente como lançamentos manuais, dificultando reconciliação e mascarando a origem do documento.
- **Recomendação**: Usar AsientoOrigen.GASTO para gasto fijo e adicionar/usar um origen específico (ex.: COMPRA) para compras; migrar dados se necessário.

### [BAIXA] Filtro hasta de listarGastos usa setHours em fuso local sobre data UTC
- **Arquivo**: src/lib/actions/gastos.ts:47
- **Evidência**: `const h = new Date(filters.hasta); h.setHours(23, 59, 59, 999); where.fecha.lte = h;`
- **Descrição**: new Date("YYYY-MM-DD") é meia-noite UTC; setHours aplica o fuso do servidor. Em servidor UTC (Vercel) funciona, mas rodando em ART (UTC-3) o limite vira 02:59:59Z do dia seguinte, incluindo gastos datados no dia posterior ao filtro. Comportamento depende do ambiente de execução.
- **Recomendação**: Usar setUTCHours(23,59,59,999) (ou somar 1 dia em UTC e usar lt) para tornar o filtro determinístico.

### [BAIXA] Geração de números por ordenação lexicográfica quebra após 9999 documentos
- **Arquivo**: src/lib/actions/compras.ts:195
- **Evidência**: `const ultimo = await db.compra.findFirst({ where: { numero: { startsWith: prefix } }, orderBy: { numero: "desc" } }); ... String(next).padStart(4, "0")`
- **Descrição**: Padrão repetido em compras, pedidos-compra, gastos, oportunidades e simulaciones: orderBy de string com padStart(4). Ao chegar em 10000, "C-2026-9999" > "C-2026-10000" lexicograficamente, então findFirst devolve sempre 9999 e todo novo documento colide com a unique (P2002) em loop. Também há corrida entre geração e gravação fora de transação (mitigada pela unique, mas com erro pouco amigável).
- **Recomendação**: Ordenar pelo sufixo numérico (raw query ou parse no app) ou usar sequence/contador por ano; tratar P2002 com retry regenerando o número.


---

## 8. Segurança, autorização e integridade transacional

## Resumo
A autenticação está corretamente centralizada: src/proxy.ts é o middleware do Next 16 (PROXY_FILENAME='proxy') e bloqueia rotas não-logadas; o cron exige CRON_SECRET (fail-closed) e o upload de blob valida sessão. bcrypt(10) e $queryRaw parametrizado (tagged templates) estão OK, sem exposição de passwordHash ao client. O problema central é AUTORIZAÇÃO: o enum Role(ADMIN/USER) só é verificado em um único ponto (pipeline.ts CRM); nenhuma página /admin, layout ou ação contábil/destrutiva diferencia papéis, então qualquer USER pode anular massivamente vendas, reabrir períodos cerrados e mover asientos. Em paralelo, ~10 server actions que mutam dados (ventas, compras, despachos, entregas, transferencias, embarques) não revalidam a sessão na própria action, dependendo só do middleware (quebra de defesa em profundidade). Integridade transacional é majoritariamente sólida ($transaction nos fluxos venda+stock+asiento), mas faltam locks otimistas nas entidades quentes (embarque/despacho/venta) e os guards de "já tem asiento" são suscetíveis a corrida sem SELECT FOR UPDATE.

## Achados

### [ALTA] ✅ CONFIRMADO Role (ADMIN/USER) nunca é enforçado fora do CRM — escalonamento de privilégio
- **Arquivo**: src/lib/actions/admin-percepcion-iibb.ts:79
- **Evidência**: `const session = await auth();
  if (!session) return { ok: false, error: "No autenticado." };`
- **Descrição**: O único role-check do app está em pipeline.ts:35 (Role.ADMIN). Ações destrutivas/contábeis exigem apenas estar logado: anularVentasMasivoAction anula TODAS as vendas EMITIDAS (reverte asientos + anula cheques), reabrirPeriodo reabre período CERRADO e moverAsientosDePeriodoAction reescreve numeração. Qualquer USER tem poder total de ADMIN, podendo corromper a contabilidade fechada.
- **Recomendação**: Criar helper requireRole(Role.ADMIN) e aplicá-lo nas actions admin/contábeis sensíveis (anular masivo, cerrar/reabrir período, mover/cambiar fecha de asientos).
- **Veredito**: Confirmado: único check de role é pipeline.ts:35. anularVentasMasivoAction (admin-percepcion-iibb.ts:79), reabrirPeriodo (periodos.ts:58) e moverAsientosDePeriodoAction (asientos.ts:318) só checam `if (!session)`; authorized() em auth.config.ts:7 só exige login, sem gate em /admin.

### [ALTA] ✅ CONFIRMADO Página /admin/recalcular-percepcion-iibb sem guard de role
- **Arquivo**: src/app/(dashboard)/admin/recalcular-percepcion-iibb/page.tsx:9
- **Evidência**: `export default async function RecalculoPercepcionIIBBPage() {
  const ventas = await listarVentasParaRecalculo();`
- **Descrição**: A página que dispara a 'operación destructiva' (anular todas as vendas EMITIDAS) é um server component sem nenhuma checagem de session.user.role; nenhum layout do grupo (dashboard) restringe acesso por papel. Qualquer usuário logado navega para /admin/... e executa o reset massivo da contabilidade de vendas.
- **Recomendação**: Verificar session.user.role===ADMIN no server component (redirect/notFound se não-admin) e replicar a checagem na action anularVentasMasivoAction.
- **Veredito**: Confirmado: page.tsx não chama auth(); layout (dashboard) só faz `if (!session) redirect`; não há middleware.ts; anularVentasMasivoAction (admin-percepcion-iibb.ts:80) só checa `if (!session)`. O padrão de guard existe (pipeline.ts:35 `role !== Role.ADMIN`), mas falta aqui.

### [MEDIA] Operações de período/asiento contábeis acessíveis a qualquer USER
- **Arquivo**: src/lib/actions/periodos.ts:14
- **Evidência**: `const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }`
- **Descrição**: cerrarPeriodo/reabrirPeriodo só exigem login. reabrirPeriodo reverte a imutabilidade de um período CERRADO; moverAsientosDePeriodoAction (asientos.ts:318) e cambiarFechaAsientosAction reescrevem numeração e datas de asientos. São controles contábeis típicos de ADMIN expostos a USER comum, permitindo manipular meses já fechados.
- **Recomendação**: Exigir Role.ADMIN para reabrir período, mover asiento de período e alterar fecha de asientos contabilizados.

### [MEDIA] Server actions que mutam dados não revalidam sessão na própria action
- **Arquivo**: src/lib/actions/ventas.ts:587
- **Evidência**: `export async function guardarVentaAction(raw: VentaInput): Promise<VentaActionResult> {
  const parsed = ventaInputSchema.safeParse(raw);  // sem auth()`
- **Descrição**: Dezenas de actions mutadoras não chamam auth(), dependendo apenas do middleware proxy.ts: guardarVentaAction/emitirVentaAction/anularVentaAction, emitirCompraAction/anularCompraAction (compras.ts:361/391), crearDespacho/contabilizarDespacho/anularDespacho/eliminarDespacho (despachos.ts:415/452/713/851), crearEntregaAction (entregas.ts:133), crearTransferenciaAction (transferencias.ts:128), guardarEmbarqueAction. Quebra defesa em profundidade: se o matcher mudar ou a action for invocada por caminho não coberto, ficam abertas.
- **Recomendação**: Adicionar um require de sessão no topo de toda action que muta dados (ex.: const s=await auth(); if(!s) return {ok:false,...}), padronizando como em asientos.ts.

### [MEDIA] eliminarSimulacionAction: delete físico por id arbitrário sem auth nem guard
- **Arquivo**: src/lib/actions/simulaciones-importacion.ts:418
- **Evidência**: `export async function eliminarSimulacionAction(id: string): Promise<EliminarSimulacionResult> {
  try {
    await db.simulacionImportacion.delete({ where: { id } });`
- **Descrição**: Hard delete direto por id, sem auth() na action, sem verificar existência/proprietário e sem soft-delete. Qualquer caller autenticado (ou não, se o middleware for contornado) apaga permanentemente qualquer simulação enumerando ids, sem trilha de auditoria.
- **Recomendação**: Exigir sessão, validar o id com zod e opcionalmente o criador; preferir soft-delete ou registrar AuditLog.

### [MEDIA] eliminarGastoAction: delete físico de gasto sem auth na action
- **Arquivo**: src/lib/actions/gastos.ts:336
- **Evidência**: `if (g.asientoId || g.estado === "CONTABILIZADO") { return {...} }
    await db.gasto.delete({ where: { id: gastoId } });`
- **Descrição**: Embora bloqueie gastos contabilizados, gastos em BORRADOR são removidos fisicamente sem que a action revalide a sessão; combinado com a ausência de require de auth, depende exclusivamente do middleware. Sem trilha de auditoria para a exclusão.
- **Recomendação**: Adicionar require de sessão e registrar a exclusão em AuditLog.

### [MEDIA] Edição de embarque sem lock otimista (last-write-wins)
- **Arquivo**: src/lib/actions/embarques.ts:502
- **Evidência**: `const actual = await tx.embarque.findUnique({ where: { id: input.id }, select: { estado:true, ... } });
        ...
        const embarque = await tx.embarque.update({ where: { id: input.id }, data });`
- **Descrição**: O update de embarque não usa expectedUpdatedAt no where (ao contrário de contenedor.ts:279/502 que tem lock por updatedAt). Dois editores concorrentes sobrescrevem-se silenciosamente, e a reconciliação de packing list/costos (deleteMany de BORRADOR) de um pode descartar mudanças do outro. Mesma lacuna em despacho e venta (entidades quentes).
- **Recomendação**: Adicionar updatedAt esperado no where do update (P2025 vira erro de conflito) para embarque, despacho e venta.

### [MEDIA] Guard 'já tem asiento' suscetível a corrida → asiento/stock duplicados
- **Arquivo**: src/lib/actions/ventas.ts:821
- **Evidência**: `if (v.asientoId) { throw new AsientoError(..."ya tiene asiento"); }
      await reservarStockEmision(tx, v.items);
      const asiento = await crearAsientoVenta(ventaId, tx);`
- **Descrição**: O guard lê asientoId dentro da $transaction (Read Committed) sem SELECT FOR UPDATE nem unique constraint. Dois double-submit concorrentes de emitirVentaAction lêem asientoId=null e ambos criam asiento + reservam stock, gerando lançamento duplicado e duplo desconto de estoque. Padrão idêntico em emitirCompraAction (compras.ts:371) e contabilizarDespachoAction (despachos.ts:459).
- **Recomendação**: Bloquear a linha com SELECT...FOR UPDATE (ou updatedAt lock) antes do guard, ou impor unique em Venta.asientoId/Compra.asientoId.

### [BAIXA] login sem rate limiting / lockout por tentativas
- **Arquivo**: src/lib/actions/auth.ts:6
- **Evidência**: `await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });`
- **Descrição**: A action de login executa bcrypt.compare a cada tentativa sem throttling, lockout por usuário/IP ou backoff. Em app interno o risco é menor, mas permite brute force online contra senhas fracas, sem registro de tentativas falhas.
- **Recomendação**: Adicionar throttle/backoff por IP+usuário e bloqueio temporário após N falhas; logar tentativas malsucedidas.


---

## 9. Fluxos e máquinas de estado

## Resumo
As máquinas novas (contenedor, despacho cruzado, borrador, divergência, extracto) são as mais bem guardadas (rank estrito, single-shot, idempotency keys, updates condicionais). Os riscos concentram-se em: (a) o **detach genérico de `anularEnTx`**, que permite contornar as actions dedicadas de venta/entrega/cierre; (b) o **caminho de divergência D9 que nunca aplica os efeitos bloqueados**; (c) **estados manuais sem guard** (EmbarqueEstado, PedidoEstado, leads); (d) **estados de enum mortos** (RECIBIDA, VENCIDO, CANCELADO, NACIONALIZADO_DIRECTO) que docs e filtros já tratam como vivos.

## Achados

### [CRITICA] D9: concluir/arquivar investigação não aplica counters, stock nem asiento de traslado — contenedor vira dead end
- **Arquivo**: src/lib/services/divergencia-investigacion.ts:357-370 (e :394-406), src/lib/services/desconsolidacion.ts:211-222
- **Evidência**: `await t.contenedor.update({ where: { id: contenedor.id }, data: { estado: ContenedorEstado.DESCONSOLIDADO } });` (concluir) — nenhuma chamada a counters/movimientoStock/crearAsientoTransferenciaSubcuenta
- **Descrição**: No gate D9 a desconsolidación bloqueia counters + MovimientoStock + asiento TRASLADO_DF. Ao concluir/arquivar, o contenedor vai a DESCONSOLIDADO mas cantidadDisponible=0, sem stock no DF e sem débito 1.1.5.05. Re-desconsolidar é impossível (guard YA_DESCONSOLIDADO + header 1:1). Mercadoria fica indespachável e o custo preso em 1.1.5.04.
- **Recomendação**: Ao concluir/arquivar, aplicar os efeitos bloqueados (counters = cantidadFisica, ingreso consolidado no DF, asiento de traslado) dentro da mesma transação do fechamento da investigação.

### [ALTA] anularAsientoAction não bloqueia asiento de venta — anula sem liberar reservas, sem checar entregas/cheques/flete
- **Arquivo**: src/lib/actions/asientos.ts:121-140, src/lib/services/asiento-automatico.ts:519-522
- **Evidência**: `await tx.venta.updateMany({ where: { asientoId }, data: { asientoId: null, estado: "CANCELADA" } });`
- **Descrição**: A action só bloqueia asientos de ZP e despacho. Anular um asiento de venta via /contabilidad/asientos seta CANCELADA sem liberarReservasAnulacion, sem ensureSinEntregasConfirmadas, sem anular cheques/gasto de flete. Resultado: cantidadReservada órfã no SPD e entregas CONFIRMADAS de venta cancelada.
- **Recomendação**: Bloquear na action asientos linkados a venta apontando para "Anular venta".

### [ALTA] Anular asiento de entrega direto deixa entrega CONFIRMADA com stock egressado e asiento ANULADO
- **Arquivo**: src/lib/services/asiento-automatico.ts:497-536, src/lib/actions/entregas.ts:346-357
- **Evidência**: anularEnTx faz detach de embarque/movimiento/prestamo/venta/compra/gasto/embarqueCosto — não há entregaVenta.updateMany
- **Descrição**: O asiento CMV de entrega não está na lista de bloqueio de anularAsientoAction nem no detach de anularEnTx. Anulá-lo direto deixa EntregaVenta.estado=CONFIRMADA apontando para asiento ANULADO, com MovimientoStock EGRESO intacto — livros revertidos, stock não.
- **Recomendação**: Bloquear anulação direta de asientos com entrega vinculada, exigindo anularEntregaAction.

### [ALTA] Anular cierre de embarque via asientos UI reverte stock sem validar disponibilidade (stock negativo)
- **Arquivo**: src/lib/services/asiento-automatico.ts:497-510, src/lib/services/stock.ts:330-353
- **Evidência**: `for (const e of embarquesAnulados) { await revertirIngresoEmbarque(tx, e.id); } await tx.embarque.updateMany({ ..., data: { asientoId: null, estado: EmbarqueEstado.EN_DEPOSITO } });`
- **Descrição**: O asiento de cierre não está bloqueado em anularAsientoAction. revertirIngresoEmbarque deleta os ingresos e replaya o custo sem validar disponível. Se a mercadoria já foi vendida/entregue, stockActual fica negativo. O estado é forçado a EN_DEPOSITO independentemente do estado pré-cierre.
- **Recomendação**: Validar validarDisponible antes de reverter e/ou direcionar para action dedicada de reabertura de embarque.

### [ALTA] revertirZonaPrimariaAction (Modelo Y) não checa desconsolidaciones — 1.1.5.04 fica negativa
- **Arquivo**: src/lib/actions/embarques.ts:930-984
- **Evidência**: guards são apenas !embarque.asientoZonaPrimariaId, embarque.asientoId e despachosActivosCount > 0 — nenhuma consulta a contenedor/desconsolidacion
- **Descrição**: Num embarque Modelo Y com contenedor já desconsolidado, reverter o arribo anula o débito original de 1.1.5.04 e deixa o traslado + stock DF órfãos (MovimientoStock de desconsolidación linkam por itemContenedorId, não itemEmbarqueId).
- **Recomendação**: Bloquear a reversão se existir Desconsolidacion/MovimientoStock de contenedor no embarque.

### [ALTA] Ordem embarque×contenedor não imposta: desconsolidar sem arribo confirmado credita 1.1.5.04 sem débito prévio
- **Arquivo**: src/lib/services/desconsolidacion.ts:131-162, src/lib/services/contenedor.ts:364-424
- **Evidência**: guards de desconsolidar: estado EN_DEPOSITO_FISCAL, packing list, depósito fiscal, FC fechado, TC válido — nenhum check de embarque.asientoZonaPrimariaId
- **Descrição**: O ciclo físico do contenedor e a desconsolidación avançam independentemente de o embarque ter confirmado o arribo (que debita 1.1.5.04). Se o operador desconsolida antes de confirmar ZP, o asiento de traslado credita 1.1.5.04 sem saldo → conta negativa e reconciliação Σ FC×cant×TC quebrada.
- **Recomendação**: Exigir embarque.asientoZonaPrimariaId != null em desconsolidar (ou já em EN_ZONA_PRIMARIA do contenedor).

### [MEDIA] transicionarPedidoCompra/VentaAction: transição de estado totalmente livre
- **Arquivo**: src/lib/actions/pedidos-compra.ts:219-234, src/lib/actions/pedidos-venta.ts:217-232
- **Evidência**: `await db.pedidoCompra.update({ where: { id }, data: { estado: nuevoEstado } });` — sem leitura do estado atual
- **Descrição**: Qualquer sequência é possível: CANCELADO→COMPLETADO, COMPLETADO→BORRADOR etc. PARCIAL/COMPLETADO nunca são derivados das facturas geradas — são manuais.
- **Recomendação**: Tabela de transições válidas + derivar PARCIAL/COMPLETADO das compras/ventas vinculadas.

### [MEDIA] EmbarqueEstado é setado livremente pelo form — estados com semântica contábil sem efeito algum
- **Arquivo**: src/lib/actions/embarques.ts:469, src/lib/actions/embarque-schema.ts:143,163
- **Evidência**: `estado: input.estado` no upsert com z.nativeEnum(EmbarqueEstado); só CERRADO é rejeitado no superRefine
- **Descrição**: O usuário pode saltar BORRADOR→DESPACHADO→EN_TRANSITO em qualquer ordem. EN_ZONA_PRIMARIA é setável sem confirmar ZP, e pago-exterior.ts:31-36 / getVepEmbarques filtram por esses estados — listas de saldo/VEP dependem de estado manual.
- **Recomendação**: Separar estado logístico (livre) de marcos contábeis (derivados de asientoZonaPrimariaId/asientoId), ou impor rank como em avanzarEstadoContenedor.

### [MEDIA] emitirVentaAction/emitirCompraAction não validam estado: CANCELADA → EMITIDA direto
- **Arquivo**: src/lib/actions/ventas.ts:820-823, src/lib/actions/compras.ts:370-373
- **Evidência**: `if (v.asientoId) { throw ... }` — único guard; não há if (estado !== BORRADOR)
- **Descrição**: Venta/compra cancelada (asientoId null) pode ser emitida sem reabertura: transição ilegal CANCELADA→EMITIDA em um clique.
- **Recomendação**: Exigir estado === BORRADOR (ou reset explícito a BORRADOR na edição pós-anulação).

### [MEDIA] CompraEstado.RECIBIDA é órfão e compra local nunca gera stock
- **Arquivo**: prisma/schema.prisma:156-161, src/lib/actions/compras.ts:361-389, src/lib/services/cuentas-a-pagar.ts:537
- **Evidência**: `where: { estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] } }` (CxP/BI/pago-exterior consomem RECIBIDA) — nenhum update/create seta RECIBIDA em todo src
- **Descrição**: O estado existe no enum e em filtros, mas é inalcançável. ItemCompra (productoId/cantidad) nunca vira MovimientoStock: mercadoria comprada localmente não entra no inventário.
- **Recomendação**: Implementar "Recibir compra" (EMITIDA→RECIBIDA + ingreso de stock) ou remover o estado dos filtros/enum.

### [MEDIA] VepEstado.VENCIDO inalcançável — nenhum código o seta
- **Arquivo**: prisma/schema.prisma:281-285, src/lib/actions/vep-despacho.ts:389
- **Evidência**: `where: { estado: { in: ["GENERADO", "VENCIDO"] } }` — único uso; grep não encontra escrita de VENCIDO
- **Descrição**: O enum prevê vencimento do VEP mas não existe cron/action que transicione GENERADO→VENCIDO.
- **Recomendação**: Cron diário marcando VENCIDO por fechaVencimiento, ou remover do enum.

### [MEDIA] ContenedorEstado.CANCELADO e NACIONALIZADO_DIRECTO inalcançáveis
- **Arquivo**: src/lib/services/contenedor.ts:60-65, src/lib/services/asiento-automatico.ts:1959,1974
- **Evidência**: NACIONALIZADO_DIRECTO: 10, CANCELADO: 11 aparecem só na tabela de rank; flujos ARRIBO_ZONA_PRIMARIA/NACIONALIZACION_DIRECTA definidos sem nenhum caller
- **Descrição**: O doc desenha CANCELADO e o Workflow 2 (nacionalização direta no porto), mas não há action que os alcance. Contenedor errado só pode ser deletado em estados editáveis; depois disso, não há saída administrativa.
- **Recomendação**: Action cancelarContenedor (com validação de counters zerados) e wiring do Workflow 2, ou remover os estados.

### [MEDIA] Pagamento de VEP: check de "já pago" fora da transação (double-click paga 2x)
- **Arquivo**: src/lib/actions/vep-embarque.ts:102-115, src/lib/actions/vep-despacho.ts:151-153,342
- **Evidência**: `const todos = await getVepEmbarques(); const vep = todos.find(...); if (vep.pagado) { return ... }` — tudo antes de db.$transaction
- **Descrição**: No VEP de embarque o "pagado" é derivado do ledger fora da tx; dois submits concorrentes geram dois movimientos+asientos de pago. No VEP de despacho o update para PAGADO não é condicional.
- **Recomendação**: Transição single-shot (updateMany where estado: 'GENERADO', count===1).

### [MEDIA] Doc × código: VEP do despacho anulado é DELETADO, não "marcado ANULADO"
- **Arquivo**: docs/fluxo-zona-primaria.md:237, src/lib/actions/despachos.ts:821, prisma/schema.prisma:281-285
- **Evidência**: doc: "VepDespacho marcado ANULADO (não eliminado — preserva trail)". Código: `await tx.vepDespacho.delete(...)`. Enum VepEstado nem possui ANULADO
- **Descrição**: O trail prometido pelo doc não existe — anular o despacho apaga o VEP.
- **Recomendação**: Alinhar (adicionar ANULADO ao enum e marcar, ou corrigir o doc).

### [MEDIA] ZP legacy: rateio do stock inclui facturas EMITIDA mas o asiento ZP não — stock ≠ 1.1.5.02
- **Arquivo**: src/lib/actions/embarques.ts:812-814, src/lib/services/asiento-automatico.ts:1583-1585
- **Evidência**: action: filter momento ZONA_PRIMARIA && estado !== ANULADA (alimenta rateio); asiento: estado BORRADOR || LEGACY_BUNDLED
- **Descrição**: No fluxo legacy, uma factura ZP já EMITIDA entra no custo do stock ZPA mas não no débito de 1.1.5.02 (foi a gasto 5.x). O arribo Modelo Y reclassifica; o legacy não → valuação de stock descola do razonete.
- **Recomendação**: Replicar a reclassificação gasto→1.1.5.02 do arribo no crearAsientoZonaPrimaria, ou alinhar o filtro do rateio.

### [BAIXA] bulkUpdateLeadsEstadoAction: transição livre, CONVERTIDO sem cliente
- **Arquivo**: src/lib/actions/leads.ts:211-226
- **Evidência**: `await db.lead.updateMany({ where: { id: { in: ids } }, data: { estado: parsed.data.estado } });`
- **Descrição**: Bulk permite DESCALIFICADO→CONVERTIDO ou marcar CONVERTIDO sem clienteId — lead "convertido" sem cliente quebra o invariante do funil.
- **Recomendação**: Excluir CONVERTIDO do bulk (ou validar transições e exigir conversão pelo fluxo dedicado).

### [BAIXA] Despacho cruzado contabilizável com tributos = 0 → VEP GENERADO impagável
- **Arquivo**: src/lib/actions/despachos.ts:452-611,948-960, src/lib/actions/vep-despacho.ts:170-175
- **Evidência**: materialização cria despacho com tributos default 0; contabilizarDespachoAction não exige tributos; VEP GENERADO com montoTotal 0; pagar lança "VEP vacío"
- **Descrição**: Pular o editor de tributos e contabilizar direto gera nacionalização sem DIE/Tasa/IVA e um VEP zumbi eternamente GENERADO.
- **Recomendação**: Bloquear contabilização com tributos zerados (ou não criar VEP quando total = 0).

### [BAIXA] Doc × código: estado EN_EDICION do borrador não existe
- **Arquivo**: docs/fluxo-zona-primaria.md:216, src/lib/services/despacho-parcial.ts:128-137
- **Evidência**: doc: "crearBorrador() DespachoBorrador EN_EDICION → CONFIRMADO_TRABA_COUNTS"; código: estadoActual: ESTADO_CONFIRMADO direto no create
- **Descrição**: A máquina real do borrador tem 2 estados (+ delete ao contabilizar); o doc sugere um estágio de edição que nunca existiu.
- **Recomendação**: Corrigir o doc.

### [BAIXA] "Anule a desconsolidação primeiro" — mas não existe anulação de desconsolidación
- **Arquivo**: src/lib/services/contenedor.ts:488-497
- **Evidência**: throw "No se puede revertir un contenedor con desconsolidación/stock — anule la desconsolidación primero."
- **Descrição**: A mensagem instrui um caminho de reversão que não está implementado. Contenedor desconsolidado com erro de conferência (sem divergência formal) não tem volta — dead end espelho do gap "revertir".
- **Recomendação**: Implementar anulación de desconsolidación (reverter counters + stock DF + asiento traslado, só se nada despachado) ou ajustar a mensagem.

### [BAIXA] aprobarLineaAction sem idempotência forte na transição PENDIENTE→APROBADA
- **Arquivo**: src/lib/actions/extractos.ts:100-103,208-214
- **Evidência**: guard read-then-write na mesma tx, update incondicional
- **Descrição**: Dois aprobar concorrentes da mesma línea podem criar dois movimientos+asientos (o segundo update sobrescreve movimientoId, deixando um movimiento órfão contabilizado).
- **Recomendação**: updateMany({ where: { id, status: 'PENDIENTE' } }) com check de count.

## Fluxos reais implementados

### Comex: embarque → ZPA → desconsolidación → despacho → nacional
1. **Embarque BORRADOR** (guardarEmbarqueAction): form cria/edita embarque + ItemEmbarque + facturas (EmbarqueCosto BORRADOR); facturas com fechaFactura são auto-emitidas (asiento DEBE gasto 5.x + IVA/IIBB crédito / HABER proveedor — CxP nasce aqui). Estados logísticos manuais via dropdown, sem guard. Edição bloqueada se CERRADO/asientoZonaPrimariaId/asientoId.
2. **Confirmar Zona Primaria** (confirmarZonaPrimariaAction) bifurca:
   - **Modelo Y** (flag on + contenedores): crearAsientoArriboComex — DEBE 1.1.5.04 (FOB+flete/seguro origem+facturas ZP; EMITIDA reclassificadas de 5.x) / HABER proveedor exterior; embarque → EN_ZONA_PRIMARIA (update condicional anti-race). **Sem stock** — primeiro ingresso só na desconsolidación.
   - **Legacy**: crearAsientoZonaPrimaria (DEBE 1.1.5.02 / HABER proveedores) + ingreso físico no depósito ZPA; embarque → EN_ZONA_PRIMARIA. Filtros divergem entre stock e asiento.
   - Reversão: revertirZonaPrimariaAction → anula asiento ZP, reverte stock, embarque → EN_PUERTO; não checa desconsolidaciones do Modelo Y.
3. **Ciclo do contenedor** (avanzarEstadoContenedor): BORRADOR→EN_TRANSITO→ARRIBADO_PUERTO→EN_ZONA_PRIMARIA→TRASLADO_DF→EN_DEPOSITO_FISCAL, rank estrito só-avança (pode pular fases), sem efeito contábil; exige depositoFiscalId e custos FC fechados para entrar em DF. revertirEstadoContenedor retrocede com lock otimista, proibido após desconsolidación. **Não há sincronização com o passo 2.**
4. **Desconsolidación** (desconsolidar): lock pessimista + idempotencyKey; só de EN_DEPOSITO_FISCAL. Sem divergência: counters (cantidadDisponible=fisica), MovimientoStock INGRESO no DF, asiento TRASLADO_DF (DEBE 1.1.5.05 / HABER 1.1.5.04) → DESCONSOLIDADO. Com divergência: → AGUARDANDO_INVESTIGACAO, tudo bloqueado; concluir/arquivarInvestigacion gera só o ajuste D9 e volta a DESCONSOLIDADO **sem nunca aplicar counters/stock/traslado** (dead end).
5. **Despacho cruzado**: crearBorrador trava counters single-shot (CONFIRMADO_TRABA_COUNTS, TTL + cron de expiração idempotente); contabilizarBorrador materializa Despacho BORRADOR (counters → despachada) e deleta o borrador; actualizarTributosDespachoCruzadoAction carrega tributos (opcional); contabilizarDespachoAction: crearAsientoDespachoCruzado (DEBE 1.1.5.01 landed + créditos fiscais / HABER 1.1.5.05 + pasivos Aduana, link race-safe), aplicarNacionalizacionDF (transferência DF→destino com custo landed), despacho → CONTABILIZADO, VEP upsert GENERADO, recomputarEstadoContenedor (→ PARCIALMENTE/TOTALMENTE_DESPACHADO). anularDespachoAction reverte tudo (valida disponível, devolve counters, deleta VEP) → ANULADO. VEP pago via pagarVepDespachoAction → PAGADO; VENCIDO morto.
6. **Cierre monolítico legacy** (cerrarYContabilizarEmbarqueAction): bloqueado com despachos ativos/destino ZPA; asiento de nacionalização + ingreso de stock → CERRADO. Anulação só via asientos UI, sem validação de disponível.

**Gaps principais**: dead end D9, ordem arribo×desconsolidación, reversões destrutivas, estados de contenedor inalcançáveis.

### Ventas: pedido → venta → entrega → cobro
1. **PedidoVenta**: estados 100% manuais via transicionarPedidoVentaAction **sem guard**; crearVentaDesdePedidoAction gera Venta BORRADOR (bloqueado só para CANCELADO/COMPLETADO) e não move o pedido.
2. **Venta BORRADOR** (guardarVentaAction): editável até ter asiento; cheques recebidos e gasto de flete vinculados recriados na edição.
3. **Emitir** (emitirVentaAction): reserva SPD (validarDepositoVenta bloqueia ZPA + validarDisponible + aplicarReservaSPD), crearAsientoVenta (link race-safe; DEBE CxC/cheques + CMV→1.1.5.03 / HABER ventas + IVA DF + 1.1.5.01) → EMITIDA. Guard de estado ausente.
4. **Entrega**: exige venta EMITIDA; EntregaVenta BORRADOR → confirmarEntregaAction (guard BORRADOR + depósito do item, valida stock físico, MovimientoStock EGRESO + aplicarEgresoSPD, asiento baixa a provisória 1.1.5.03) → CONFIRMADA. anularEntregaAction: BORRADOR deleta; CONFIRMADA restaura SPD + anula asiento → ANULADA. Bem guardado — exceto bypass via asientos UI.
5. **Cobro**: não há estado "COBRADA" — cobro é MovimientoTesoreria COBRO (manual ou via aprovação de línea de extracto) contra a cuenta contable do cliente; saldo CxC derivado do ledger. Cheques têm máquina própria (ChequeRecibidoEstado), anulados em cascata por anularVentaAction.
6. **Anular venta** (anularVentaAction): bloqueia com entregas CONFIRMADAS, anula flete/cheques, libera reservas, anula asiento → CANCELADA. Bypass direto pelo asiento pula tudo isso.

### Compras: pedido → compra → pago
1. **PedidoCompra**: mesmas transições livres do pedido de venta; crearCompraDesdePedidoAction cria Compra BORRADOR (IVA 21% hardcoded) sem mover o pedido.
2. **Compra BORRADOR** → emitirCompraAction: guard só asientoId; crearAsientoCompra (DEBE gasto/mercadería + IVA crédito / HABER proveedor — CxP) → EMITIDA. **Nenhum ingreso de stock** e RECIBIDA inalcançável.
3. **Pago**: crearMovimientoTesoreriaAction PAGO contra a cuenta do proveedor (com diferencia cambiaria automática p/ USD — Fase 2) ou pago-exterior.ts para proveedores do exterior (3 paths: compra/embarque/embarqueFob). Saldo CxP derivado do ledger; sem estado "PAGADA" na compra.
4. **Anular**: anularCompraAction — sem asiento seta CANCELADA; com asiento delega ao anularAsiento (detach + CANCELADA). Sem reversão de stock porque nunca houve.

### Tesorería: extracto → conciliación
1. **Import** (extractos-import.ts): ImportacionExtracto (PENDIENTE) + LineaExtractoSugerencia PENDIENTE por linha do extrato parseado.
2. **Triagem por línea** (extractos.ts): editarLinea (bloqueado se APROBADA), rechazar/ignorar (PENDIENTE→RECHAZADA/IGNORADA), revertirLinea (→PENDIENTE; APROBADA é rejeitada).
3. **Aprobar** (aprobarLineaAction): cria MovimientoTesoreria (COBRO se monto>0, PAGO se <0) contra a contrapartida sugerida, asiento contabilizado na hora (caso especial Ley 25413: split 33% crédito Ganancias / 67% gasto), línea → APROBADA + recálculo do status da importação (PENDIENTE/PARCIAL/COMPLETADO). Guard read-then-write não condicional.
4. **Desaprobar** (desaprobarLineaAction): só de APROBADA; anula asiento, deleta o movimiento e volta a PENDIENTE — reversão completa e simétrica.
5. **Períodos**: cerrarPeriodoAction exige zero asientos BORRADOR no período → CERRADO; reabertura simétrica. Asientos: BORRADOR→CONTABILIZADO (valida balanceio + período ABERTO) →ANULADO (só CONTABILIZADO + período ABERTO, com detach dos documentos-fonte — o ponto fraco central).


---

## 10. Performance e otimizações

## Resumo
A auditoria de performance encontrou um padrão consistente: a camada de banco depende de replays e agregações em JS sobre tabelas que crescem sem limite, com índices de FK ausentes nos modelos mais quentes. Os achados mais graves são a falta de índice em LineaAsiento.asientoId (toda leitura de lineas por asiento vira seq scan na maior tabela), o getSaldosPorProveedorConAging que carrega o ledger inteiro de fornecedores + todas as aplicações de pago a cada load de cuentas-a-pagar, e o balance de sumas y saldos que materializa todas as lineas do período com drill-down embutido no payload. O recálculo de stock (recalcularStockYCostoPromedio/recalcularSPDPorProducto) replaya o histórico completo de MovimientoStock por produto dentro de transações, e os fluxos de ingresso fazem ~7 queries sequenciais por item. No front, 89 de 91 páginas são force-dynamic sem nenhum unstable_cache, as listagens não têm take/paginação server-side e o DataTable compartilhado renderiza todas as rows (react-virtual instalado mas usado só na matriz de inventário); Suspense/streaming existe apenas em /dashboard e /bi. Nada corrompe dados — são riscos de degradação progressiva e timeouts de transação conforme o histórico contábil e de stock cresce.

## Achados

### [MEDIA] ✅ CONFIRMADO LineaAsiento sem índice em asientoId (FK da maior tabela)
- **Arquivo**: prisma/schema.prisma:459
- **Evidência**: `model LineaAsiento { id Int @id ... asientoId String ... asiento Asiento @relation(fields: [asientoId], references: [id], onDelete: Restrict) ... @@index([cuentaId]) }`
- **Descrição**: LineaAsiento só tem @@index([cuentaId]). Postgres não indexa FK automaticamente, então toda busca de lineas por asiento (detalhe de asiento, include lineas no libro diario/flujo de caja, extracto-bancario que carrega lineas irmãs, deletes com onDelete: Restrict) faz seq scan na tabela que mais cresce do sistema (cada asiento gera 2+ lineas).
- **Recomendação**: Adicionar @@index([asientoId]) em LineaAsiento (e considerar @@index([cuentaId, asientoId]) para os group-bys de saldo). Migração simples via prisma migrate/db push.
- **Veredito**: Confirmado: schema.prisma:459 só tem @@index([cuentaId]); asientoId (linha 438, FK linha 452) sem índice, sem CREATE INDEX em migrations-manual. Paths reais: asientos.ts:210, extracto-bancario.ts:133, libro-diario. Mas são includes batched, sem N+1; relatórios pesados filtram por cuentaId indexado.

### [MEDIA] ✅ CONFIRMADO getSaldosPorProveedorConAging carrega o ledger inteiro de fornecedores em cada load
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:390
- **Evidência**: `const lineasTodas = cuentaIds.length > 0 ? await db.lineaAsiento.findMany({ where: { cuentaId: { in: cuentaIds }, asiento: { estado: AsientoEstado.CONTABILIZADO } }, ...`
- **Descrição**: Carrega TODAS as lineaAsiento históricas de todas as cuentas de proveedor, TODAS as aplicaciones de pago (3 findMany sem where, linhas 418-428), todas as Compras EMITIDA/RECIBIDA (536) e todos os EmbarqueCostos (555), e faz token-matching O(facturas×pagos) em JS. Roda em cada load de /tesoreria/cuentas-a-pagar e /tesoreria/saldos-proveedores; custo cresce linearmente com o histórico contábil, sem cache.
- **Recomendação**: Limitar lineas a asientos com neto pendente (ou últimos N meses), filtrar AplicacionPago* por lineaAsientoId in (lineas carregadas), e cachear o resultado por request (unstable_cache + revalidateTag em pagos).
- **Veredito**: Confirmado: linhas 388-404 carregam todo o ledger das cuentas de proveedor; 418-428 têm 3 findMany sem where; 536/555/578 sem bound; token-matching O(facturas×pagos) em 513-516. Páginas force-dynamic, sem cache/take. Mas é só latência crescente, não resultado errado — severidade media.

### [MEDIA] ✅ CONFIRMADO Balance de sumas y saldos carrega todas as lineas do período com join de asiento
- **Arquivo**: src/lib/services/balance-sumas-saldos.ts:107
- **Evidência**: `db.lineaAsiento.findMany({ where: { asiento: { estado: AsientoEstado.CONTABILIZADO, ...(fechaWhere ? { fecha: fechaWhere } : {}) } }, orderBy: [...], select: { id, cuentaId, debe, haber, descripcion, asiento: {...} } })`
- **Descrição**: Além do groupBy de saldos prévios (correto), o relatório materializa TODAS as lineas do período com dados do asiento para montar o drill-down por conta — tudo serializado ao client de uma vez. Sem fechaDesde/fechaHasta (URL com range amplo ou 'histórico completo') carrega o livro inteiro em memória e no payload da página. debe/haber do período também poderiam vir de um groupBy.
- **Recomendação**: Calcular debe/haber do período via lineaAsiento.groupBy e carregar as lineas de drill-down sob demanda (server action por cuenta, com take), em vez de embutir o livro inteiro no payload.
- **Veredito**: Confirmado: findMany sem take em balance-sumas-saldos.ts:107-130, lineas embutidas no tree e serializadas ao client (balance-tree-table.tsx "use client"). Porém page.tsx:44-45 aplica default mês-corrente; botão "Histórico completo" deleta params e o default reativa — caminho sem filtro só via URL manual. Range amplo via DatePicker segue ilimitado.

### [MEDIA] Venta sem índice em (estado, fecha) usado por BI, CxC e listagens
- **Arquivo**: prisma/schema.prisma:1462
- **Evidência**: `model Venta { ... fecha DateTime ... estado VentaEstado @default(BORRADOR) ... @@index([fechaVencimiento]) @@index([clienteId]) @@index([percepcionIIBBJurisdiccionId]) }`
- **Descrição**: Quase toda query de Venta filtra estado + fecha (bi.ts:102, 221, 425, 452, 1368, 1469; cuentas-a-cobrar.ts:276; listagem de ventas), mas o modelo só indexa fechaVencimiento, clienteId e percepcionIIBBJurisdiccionId — cada chamada vira seq scan. O BI dispara ~6 dessas queries por aba.
- **Recomendação**: Adicionar @@index([estado, fecha]) em Venta. Avaliar o mesmo para EntregaVenta ([estado, fecha], usado em bi.ts:142) e Compra ([estado]).

### [MEDIA] ItemEmbarque sem índice em embarqueId nem productoId
- **Arquivo**: prisma/schema.prisma:747
- **Evidência**: `model ItemEmbarque { id Int @id @default(autoincrement()) embarqueId String productoId String ... } // sem nenhum @@index`
- **Descrição**: ItemEmbarque é consultado por embarqueId em todo o fluxo comex (embarques.ts:533 itemsActuales, stock.ts:331 revertirIngresoEmbarque, includes de embarque com items) e por productoId nos 3 paths de saldos exterior. Sem índice de FK, cada operação varre a tabela inteira, que cresce com cada embarque (~dezenas de SKUs por embarque).
- **Recomendação**: Adicionar @@index([embarqueId]) e @@index([productoId]) em ItemEmbarque.

### [MEDIA] ItemVenta indexa só depositoId; falta ventaId e productoId
- **Arquivo**: prisma/schema.prisma:1528
- **Evidência**: `model ItemVenta { ... ventaId String productoId String ... @@index([depositoId]) }`
- **Descrição**: recalcularReservasPorProducto (stock-recalc.ts:37) consulta itemVenta por productoId + venta.estado em cada emissão/anulação/entrega; includes de venta carregam items por ventaId; BI percorre items por venta. Nenhum dos dois campos tem índice — com vendas acumulando, cada recálculo de reserva degrada para seq scan dentro de transação.
- **Recomendação**: Adicionar @@index([ventaId]) e @@index([productoId]) em ItemVenta.

### [MEDIA] MovimientoTesoreria sem índice em cuentaBancariaId e tipo
- **Arquivo**: prisma/schema.prisma:571
- **Evidência**: `model MovimientoTesoreria { ... tipo MovimientoTesoreriaTipo cuentaBancariaId String ... @@index([fecha]) }`
- **Descrição**: A página /tesoreria/movimientos filtra por tipo e cuentaBancariaId (page.tsx:88-90) e historico-pagos filtra tipo=PAGO + cuentaBancariaId (historico-pagos.ts:82-106). Só fecha é indexada; filtros por conta bancária ou tipo num histórico longo dependem de scan + filter.
- **Recomendação**: Adicionar @@index([cuentaBancariaId, fecha]) e @@index([tipo, fecha]) em MovimientoTesoreria.

### [MEDIA] recalcularStockYCostoPromedio faz replay do histórico completo de movimientos
- **Arquivo**: src/lib/services/stock.ts:382
- **Evidência**: `const movimientos = await tx.movimientoStock.findMany({ where: { productoId }, orderBy: [{ fecha: "asc" }, { id: "asc" }], ... }); ... for (const m of movimientos) { ... }`
- **Descrição**: Cada reversão de embarque/despacho e cada transferência/nacionalização (aplicarTransferenciaDespacho:713, aplicarNacionalizacionDF:790) replaya TODOS os MovimientoStock do produto desde o início dos tempos, em loop por produto, dentro da transação. recalcularSPDPorProducto (886) duplica o replay. O custo cresce sem limite com o histórico — pneus de alto giro acumulam milhares de movimentos.
- **Recomendação**: Introduzir snapshot/checkpoint periódico (saldo+promedio até data X) e replay só do delta, ou manter o agregado incrementalmente e reservar o replay completo para job de validação (CI), não para o hot path transacional.

### [MEDIA] aplicarIngreso*: 4+ roundtrips sequenciais por item dentro da transação
- **Arquivo**: src/lib/services/stock.ts:63
- **Evidência**: `for (const item of params.items) { await tx.itemEmbarque.update(...); await tx.movimientoStock.create(...); await aplicarIngresoProducto(...); await aplicarIngresoSPD(...); }`
- **Descrição**: aplicarIngresoEmbarque/Zpa/Despacho executam por item: update + create + findUnique(deposito) + findUnique(producto) + update + findUnique(SPD) + update — ~7 queries sequenciais. Um embarque de 40 SKUs gera ~280 roundtrips dentro de uma transação interativa (timeout default do Prisma = 5s). Mesmo padrão em reservarStockEmision (ventas.ts:781) e aplicarTransferenciaDespacho (1 count+create+3 queries por produto).
- **Recomendação**: Buscar deposito/producto/SPD uma vez fora do loop (findMany + Map), usar createMany para MovimientoStock e updates em batch; o tipo do depósito é o mesmo para todos os itens.

### [MEDIA] BI agrega em JS carregando ventas com items/producto/cliente linha a linha
- **Arquivo**: src/lib/services/bi.ts:452
- **Evidência**: `const ventasRng = await db.venta.findMany({ where: { estado: VentaEstado.EMITIDA, fecha: dateWhere(rng) }, select: { total, moneda, tipoCambio, cliente: {...provincia...}, items: { select: { cantidad, subtotal, producto: {...} } } } });`
- **Descrição**: getAnalisisVentas, getAnalisisRentabilidad (1368 e 1469: 12 meses de ventas com items×producto) e getResumenEjecutivo (230: lineas de 12 meses) materializam todas as linhas e somam em JS com Decimal. São rankings/somatórios que o Postgres faria com GROUP BY em uma passada. A cada troca de aba/range do BI tudo é recarregado (force-dynamic, sem cache).
- **Recomendação**: Migrar cortes dimensionais para $queryRaw com GROUP BY (mês, cliente, marca, canal) ou groupBy do Prisma, e envolver cada aba em unstable_cache com TTL curto.

### [MEDIA] getSaldosExteriorPorProveedor: 3 paths com findMany amplos + matching em JS
- **Arquivo**: src/lib/services/cuentas-a-pagar.ts:1694
- **Evidência**: `const pagos = pagosUsdPorCuenta.get(cuentaId); ... for (const p of pagos) { const matchNumero = numTokens.size > 0 && [...numTokens].every((t) => p.tokens.has(t)); ...`
- **Descrição**: Para cada load de /tesoreria/cuentas-a-pagar e /comex/proveedores carrega todas as compras USD, todos os embarqueCostos USD com lineas, todos os embarques do proveedor com items (1765-1790) e refaz o token-matching de pagos por descripción. Combinado com getSaldosPorProveedorConAging na mesma página, o custo dobra.
- **Recomendação**: Compartilhar os dados base entre as duas funções (uma única carga por request), restringir embarques a estados com saldo provável e materializar saldo por proveedor em tabela/visão atualizada nos pagos.

### [MEDIA] Página cuentas-a-pagar bloqueia em 12 fetches pesados sem Suspense
- **Arquivo**: src/app/(dashboard)/tesoreria/cuentas-a-pagar/page.tsx:51
- **Evidência**: `] = await Promise.all([ getCuentasAPagar(), getCuentasAPagarPorEmbarque(), getSaldosPorProveedorConAging(), getVepEmbarques(), listarVepDespachosPendientes(), ... getSaldosExteriorPorProveedor(), ]);`
- **Descrição**: A página mais pesada do app espera 12 consultas (duas delas varrem o ledger inteiro) antes de renderizar 1 byte. Suspense/streaming só existe em /dashboard e /bi; aqui o TTFB é a soma do pior caso e qualquer seção lenta trava todas as outras.
- **Recomendação**: Quebrar em seções com <Suspense> (saldos aging e exterior como componentes async separados com skeleton), renderizando o header e o total imediatamente.

### [MEDIA] App 100% force-dynamic: nenhum uso de unstable_cache ou cache de dados
- **Arquivo**: src/app/(dashboard)/contabilidad/asientos/page.tsx:55
- **Evidência**: `export const dynamic = "force-dynamic"; // padrão repetido em 89 de 91 page.tsx; grep por unstable_cache/"use cache" no src retorna 0 resultados`
- **Descrição**: Toda navegação re-executa todas as queries do zero. Dados de referência praticamente estáticos — plan de cuentas (cuentaContable.findMany em ~10 páginas), productos (1053 rows), depositos, provincias, jurisdicciones — são recarregados a cada request. revalidatePath é usado nas actions (42 imports), mas não há nada para invalidar porque nada é cacheado.
- **Recomendação**: Envolver loaders de referência em unstable_cache com tags (ex.: "cuentas", "productos") e chamar revalidateTag nas actions de escrita correspondentes; manter dynamic apenas para dados transacionais.

### [MEDIA] Listagens de asientos/movimientos sem take: range amplo carrega tudo
- **Arquivo**: src/app/(dashboard)/contabilidad/asientos/page.tsx:80
- **Evidência**: `const asientos = await db.asiento.findMany({ where, orderBy: [{ fecha: "desc" }, { numero: "desc" }], select: {...} }); // sem take/skip`
- **Descrição**: O default (mês atual) mitiga, mas o DateRangeFilter permite ranges arbitrários: um ano de operação carrega todos os asientos do range de uma vez, serializa no RSC payload e renderiza todas as rows no client. Mesmo padrão em tesoreria/movimientos/page.tsx:98 e getLibroDiario (libro-diario.ts:53, que ainda inclui todas as lineas por asiento).
- **Recomendação**: Adicionar take + paginação por cursor (searchParam page) nessas listagens, como já feito em listarEmbarques (embarques.ts:81-97), e cap de segurança (ex. 1000 rows) nos reportes.

### [MEDIA] DataTable renderiza todas as rows; react-virtual só usado na matriz de inventário
- **Arquivo**: src/components/ui/data-table.tsx:56
- **Evidência**: `rows.map((row) => ( <TableRow key={row.id}> {row.getVisibleCells().map((cell) => ( <TableCell key={cell.id}> {flexRender(...)} </TableCell> ))} </TableRow> ))`
- **Descrição**: O DataTable compartilhado (asientos, movimientos, ventas, gastos...) não tem paginação client nem virtualização — com 2-3 mil rows de um range amplo o commit do React e o DOM ficam pesados. @tanstack/react-virtual está instalado mas só inventario-matrix.tsx (useVirtualizer na linha 81) o utiliza.
- **Recomendação**: Aplicar useVirtualizer no DataTable acima de ~200 rows (padrão já existente em inventario-matrix) ou ativar getPaginationRowModel do tanstack table.

### [MEDIA] getLibroMayor sem take: contas de banco carregam histórico completo
- **Arquivo**: src/lib/services/reportes/libro-mayor.ts:113
- **Evidência**: `const rows = await db.lineaAsiento.findMany({ where: { cuentaId, asiento: { estado: AsientoEstado.CONTABILIZADO, ...(fechaWhere ? { fecha: fechaWhere } : {}) } }, orderBy: [...], ... });`
- **Descrição**: Sem filtro de data (estado default da página: filtros vazios são permitidos), uma conta movimentada (banco, IVA, mercaderías) retorna todas as lineas da história com join de asiento — payload e render integrais. O saldo acumulado exige ordem, mas não exige materializar tudo no servidor Next.
- **Recomendação**: Default de range (mês/trimestre) na página + take com paginação; saldoInicial já é computado via aggregate, então paginar não quebra o acumulado se cada página partir do acumulado anterior.

### [MEDIA] getFlujoCaja carrega todos os asientos do período com lineas para agregação em JS
- **Arquivo**: src/lib/services/reportes/flujo-caja.ts:115
- **Evidência**: `const asientos = await db.asiento.findMany({ where: { estado: AsientoEstado.CONTABILIZADO, fecha: { gte: desde, lte: hasta }, moneda, lineas: { ...`
- **Descrição**: O flujo de caja materializa cada asiento que toca banco/caja com todas as suas lineas e cuenta, e monta a árvore mensal em JS. Para um range anual isso é o ledger de tesouraria inteiro em memória por request, sem cache — e a falta de índice em LineaAsiento.asientoId encarece o include.
- **Recomendação**: Agregar por (cuentaId, mês) via $queryRaw com date_trunc e juntar só os códigos de cuenta no JS; cachear por (desde, hasta, moneda) com revalidateTag em contabilização.

### [BAIXA] Extracto bancário inclui todas as lineas irmãs de cada asiento do range
- **Arquivo**: src/lib/services/extracto-bancario.ts:104
- **Evidência**: `const lineasBanco = await db.lineaAsiento.findMany({ ... asiento: { select: { ... lineas: { orderBy: { id: "asc" }, select: { cuentaId, debe, haber, descripcion, cuenta: {...} } } } } });`
- **Descrição**: Para achar a contrapartida, cada linha de banco carrega TODAS as lineas do asiento com cuenta aninhada — asientos multi-linha (pagos múltiplos com dezenas de lineas) multiplicam o payload. Sem take e sem default de range obrigatório.
- **Recomendação**: Selecionar apenas a primeira contrapartida não-banco via subquery/raw, ou limitar lineas com take e filtrar cuentaId != banco no where aninhado.

### [BAIXA] getIngresosEgresosUltimos6m soma lineas individuais em JS no dashboard
- **Arquivo**: src/lib/services/dashboard.ts:379
- **Evidência**: `const lineas = await db.lineaAsiento.findMany({ where: { asiento: { estado: ..., fecha: { gte: desde } }, cuenta: { categoria: { in: [INGRESO, EGRESO] } } }, select: { debe, haber, asiento: { select: { fecha } }, cuenta: { select: { categoria } } } });`
- **Descrição**: O gráfico do dashboard carrega cada linea de 6 meses com join duplo para somar por mês/categoria em JS. Um $queryRaw com date_trunc('month') + GROUP BY devolveria no máximo 12 rows. Executa em toda visita ao dashboard (force-dynamic).
- **Recomendação**: Substituir por agregação SQL (date_trunc + categoria) e/ou unstable_cache com TTL de minutos — o gráfico não precisa de consistência por request.

### [BAIXA] calcularDiferenciaCambiariaPago replaya todas as lineas USD da cuenta a cada pago
- **Arquivo**: src/lib/services/asiento-automatico.ts:659
- **Evidência**: `const lineasUsd = await tx.lineaAsiento.findMany({ where: { cuentaId: cuentaProveedorId, monedaOrigen: Moneda.USD, asiento: { estado: AsientoEstado.CONTABILIZADO } }, ... orderBy: { asiento: { fecha: "asc" } } });`
- **Descrição**: Cada pago USD reconstrói o FIFO completo da cuenta do proveedor desde a primeira fatura — o custo cresce com o histórico de faturas/pagos do fornecedor (operação frequente numa importadora). Dentro de transação interativa, alonga o lock.
- **Recomendação**: Persistir o ponteiro FIFO (saldo USD pendente por linha HABER) ou limitar o replay a lineas posteriores ao último zeramento de saldo da cuenta.

### [BAIXA] cerrarCostos do contenedor: update de itemContenedor um a um em loop
- **Arquivo**: src/lib/services/contenedor.ts:654
- **Evidência**: `for (const it of items) { const fc = overridePorProducto.get(it.productoId) ?? fcPorProducto.get(it.productoId); ... await inner.itemContenedor.update({ where: { id: it.id }, data: { costoFCUnitario: fc } }); }`
- **Descrição**: N updates sequenciais dentro da transação (um por item do contenedor). Mesmo padrão em autoCorrigirFechaAsientosAction (actions/asientos.ts:508-513: findUnique + update por asiento do lote) e extractos-import (create por linha). Funciona, mas alonga transações e escala mal em lotes grandes.
- **Recomendação**: Agrupar por valor (updateMany where productoId in (...) por fc igual), usar createMany onde aplicável, ou Promise.all com chunking quando não há dependência de ordem.

### [BAIXA] Forms client gigantes recebem listas de referência completas como props
- **Arquivo**: src/lib/actions/ventas.ts:144
- **Evidência**: `const rows = await db.producto.findMany({ where: { activo: true }, orderBy: { codigo: "asc" }, select: { id, codigo, nombre, precioVenta, costoPromedio, stockPorDeposito: { where: { deposito: { tipo: TipoDeposito.NACIONAL } }, ... } } });`
- **Descrição**: Após o import FOB o maestro tem ~1053 produtos: /ventas/nueva, /comex/embarques (listarProductosParaEmbarque, embarques.ts:147 sem take) e /compras serializam a lista inteira (com join de SPD no caso de ventas) no RSC payload a cada abertura do form, alimentando componentes client de 1400-2200 linhas (venta-form.tsx, embarque-form.tsx).
- **Recomendação**: Trocar por combobox com busca server-side (server action com contains + take 50) ou cachear a lista de produtos com unstable_cache + revalidateTag("productos") nas actions de produto.

### [BAIXA] Asiento: falta índice composto (estado, fecha) para o padrão de filtro dominante
- **Arquivo**: prisma/schema.prisma:432
- **Evidência**: `model Asiento { ... @@unique([periodoId, numero]) @@index([fecha]) @@index([estado]) }`
- **Descrição**: Praticamente todas as queries de reportes/BI filtram estado=CONTABILIZADO AND fecha entre X e Y (libro diario, flujo caja, balance, dashboard). Com índices separados o Postgres recorre a bitmap-AND; estado tem cardinalidade baixíssima, então o índice de estado sozinho é quase inútil e o composto serviria o range direto.
- **Recomendação**: Substituir @@index([estado]) por @@index([estado, fecha]) (mantém a utilidade para counts por estado e cobre o padrão estado+range).


---

## 11. Falhas de escrita — UI (comex, compras, inventario, maestros, gastos, admin)

## Resumo
Auditoria de escrita da UI (comex, compras, inventario, maestros, gastos, gastos-fijos, admin, perfil, login) baseada em varredura de strings visíveis (JSX, placeholders, toasts sonner, mensagens zod, aria-labels) com extração automatizada e leitura dirigida. O grosso da UI está em espanhol es-AR correto, com voseo e acentuação bem cuidados; login, perfil e os formulários principais de compras/gastos estão limpos. Os problemas mais sérios são vazamentos de português em telas inteiras: "vendas" em vez de "ventas" no painel admin de recálculo de IIBB e em jurisdicciones-iibb, "Cadastro(s)" e a conjunção "e" na página índice de Maestros, "frete" no embarque-form, e "Lacre"/"Conferencia física" (calcos do pt) na tela de investigación de contêiner. Também há terminologia inconsistente ("linkar" vs "vincular" no fluxo de despachos), catch-alls que repassam err.message cru do Prisma (inglês técnico) aos toasts em compras/pedidos/gastos, e mistura de registro voseo/usted/tuteo nas validações. Achados cosméticos incluem "Sin items" sem acento, badge "Legacy bundled" em inglês, "Close" sr-only nos diálogos e anglicismos template/override/default em gastos-fijos.

## Achados

### [MEDIA] "vendas" (português) em vez de "ventas" em todo o painel admin
- **Arquivo**: src/app/(dashboard)/admin/recalcular-percepcion-iibb/recalculo-panel.tsx:73
- **Evidência**: `{ventas.length} venda{ventas.length === 1 ? "" : "s"} EMITIDA … "No hay vendas EMITIDAS para anular." … <DialogTitle>Anular {ventas.length} venda(s) EMITIDA(s)</DialogTitle>`
- **Descrição**: A tela inteira usa "venda(s)" (pt) onde o espanhol exige "venta(s)" — em es-AR "venda" significa atadura/curativo. Ocorre em recalculo-panel.tsx:60,73,100,123,153,156,196 e também em admin/recalcular-percepcion-iibb/page.tsx:19,22,31 ("Recálculo de Percepción IIBB en vendas", "Vendas EMITIDAS").
- **Recomendação**: Substituir todas as ocorrências de "venda/vendas" por "venta/ventas" nos dois arquivos do módulo admin.

### [MEDIA] "vendas" (português) em texto de ajuda de Jurisdicciones IIBB
- **Arquivo**: src/app/(dashboard)/maestros/jurisdicciones-iibb/jurisdicciones-iibb-table.tsx:149
- **Evidência**: `Cambios afectan vendas futuras. Vendas ya emitidas guardan el snapshot de alícuota (l.149) … Si está apagado, las vendas a clientes de esta jurisdicción no llevan percepción (l.180)`
- **Descrição**: Texto explicativo visível no diálogo de edição de jurisdição usa "vendas" (pt) em vez de "ventas" duas vezes (linhas 149 e 180), em tela de maestros usada para configurar percepción IIBB.
- **Recomendação**: Trocar "vendas"→"ventas" nas linhas 149 e 180.

### [MEDIA] "Reverte" (conjugação pt) em vez de "Revierte" em diálogo destrutivo
- **Arquivo**: src/app/(dashboard)/admin/recalcular-percepcion-iibb/recalculo-panel.tsx:155
- **Evidência**: `Operación irreversible. Reverte asientos contables, libera reservas de stock y anula`
- **Descrição**: Em espanhol o verbo "revertir" conjuga "revierte" (e→ie); "reverte" é a forma portuguesa. O erro aparece na DialogDescription de uma operação irreversível em massa, texto que o usuário lê com atenção antes de confirmar.
- **Recomendação**: Trocar "Reverte" por "Revierte" (ou reformular: "Se revierten asientos contables…").

### [MEDIA] "Cadastro/Cadastros" (português) na página índice de Maestros
- **Arquivo**: src/app/(dashboard)/maestros/page.tsx:31
- **Evidência**: `description: "Cadastro de clientes y vinculación contable" (l.31) … "Cadastro de proveedores locales e del exterior" (l.38) … Cadastros base que alimentan los módulos de Tesorería, COMEX y Ventas. (l.69)`
- **Descrição**: "Cadastro" é português; em espanhol usa-se "Registro", "Padrón" ou "Alta". Aparece 3 vezes na landing page do módulo Maestros (descrições dos cards de Clientes e Proveedores e no subtítulo da página).
- **Recomendação**: Trocar "Cadastro de"→"Registro/Padrón de" (l.31,38) e "Cadastros base"→"Datos maestros" ou "Registros base" (l.69).

### [MEDIA] Conjunção "e" (português) em vez de "y"
- **Arquivo**: src/app/(dashboard)/maestros/page.tsx:38
- **Evidência**: `description: "Cadastro de proveedores locales e del exterior"`
- **Descrição**: Além do "Cadastro", a frase usa a conjunção portuguesa "e" no lugar de "y" ("locales e del exterior"). Erro duplo de idioma visível no card Proveedores da página Maestros.
- **Recomendação**: Corrigir para "…proveedores locales y del exterior".

### [MEDIA] "frete" (português) em vez de "flete" em label de select
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:1870
- **Evidência**: `Zona primaria (puerto, frete, op. log., línea marítima)`
- **Descrição**: Opção visível do select "momento" dos gastos de nacionalización no formulário de embarque usa "frete" (pt) em vez de "flete". O restante do mesmo arquivo usa corretamente "Flete nacional", "Valor de flete inválido" etc.
- **Recomendação**: Trocar "frete"→"flete" na linha 1870.

### [MEDIA] "Lacre" (português) em vez de "precinto" na conferência de contêiner
- **Arquivo**: src/app/(dashboard)/comex/contenedores/[id]/investigacion/_components/investigacion-form.tsx:364
- **Evidência**: `Lacre origen OK (l.364) … Lacre PEMA OK (l.372) … Lacre Aduana OK (l.380) … Observación de lacres (l.384)`
- **Descrição**: "Lacre" é o termo português; no espanhol aduaneiro argentino o selo de contêiner é "precinto". Aparece em 3 checkboxes e 1 label do bloco de verificação física da tela de investigación de divergencia.
- **Recomendação**: Trocar "Lacre origen/PEMA/Aduana OK"→"Precinto origen/PEMA/Aduana OK" e "Observación de lacres"→"Observación de precintos".

### [MEDIA] "Conferencia física" — calco do português (conferência) na tela de investigación
- **Arquivo**: src/app/(dashboard)/comex/contenedores/[id]/investigacion/_components/investigacion-form.tsx:343
- **Evidência**: `<h3 className="text-sm font-medium">Conferencia física</h3> … Guardar conferencia (l.431) … toast.success("Conferencia guardada.") (l.269)`
- **Descrição**: Em espanhol "conferencia" significa palestra/chamada; a checagem física de carga é "verificación" (termo AFIP) ou "control físico". O calco do pt "conferência física" aparece no título da seção (l.343), no botão (l.431), no toast (l.269) e no texto introdutório (l.83 "registrar la conferencia").
- **Recomendação**: Renomear para "Verificación física" / "Guardar verificación" / "Verificación guardada." em todas as ocorrências.

### [MEDIA] Anglicismo "linkar/linkado/linkadas" vs "vincular" usado em telas vizinhas
- **Arquivo**: src/app/(dashboard)/comex/embarques/[id]/despachos/_components/crear-despacho-form.tsx:258
- **Evidência**: `Facturas DESPACHO disponibles para linkar (l.258); "libera las facturas linkadas" (despacho-actions.tsx:122,156); "creado y linkado al despacho" (despacho-cruzado-tributos.tsx:325); "facturas DESPACHO linkadas" (despachos/page.tsx:361)`
- **Descrição**: O fluxo de despachos usa o anglicismo "linkar" em títulos, toasts e descrições, enquanto o mesmo módulo comex usa "vinculado/vinculación" ("Facturas sin embarque vinculado" em proveedores-exterior-table.tsx:206; "vinculación contable" em maestros). Terminologia inconsistente para o mesmo conceito.
- **Recomendação**: Padronizar para "vincular/vinculada(s)/vinculado" em crear-despacho-form.tsx:258, despacho-actions.tsx:122/156, despacho-cruzado-tributos.tsx:155/325/339 e despachos/page.tsx:361.

### [MEDIA] Catch-all expõe err.message cru (Prisma em inglês) no toast — compras
- **Arquivo**: src/lib/actions/compras.ts:356
- **Evidência**: `if (err instanceof Error) return { ok: false, error: err.message };`
- **Descrição**: Após tratar P2002, qualquer outro Error (inclusive PrismaClientKnownRequestError com mensagens longas em inglês tipo "Invalid `prisma.compra.create()` invocation…") é devolvido como `error` e exibido via toast.error no compra-form. O mesmo padrão existe em pedidos-compra.ts:214 e 336 e gastos.ts:271. Outras actions (clientes.ts:217, embarques.ts) filtram por prefixo e usam fallback em espanhol.
- **Recomendação**: Restringir o repasse de err.message a erros de domínio conhecidos (como em clientes.ts/embarques.ts) e usar fallback "Error inesperado al guardar…" para o resto.

### [BAIXA] "Sin items" sem acento — resto do app usa "ítems"
- **Arquivo**: src/app/(dashboard)/inventario/_components/en-produccion-table.tsx:38
- **Evidência**: `Sin items en producción. (en-produccion-table.tsx:38); Sin items en tránsito. (en-transito-table.tsx:39)`
- **Descrição**: Os empty states das abas "En producción" e "En tránsito" do inventário grafam "items" sem acento, enquanto todo o resto do app usa "ítems" ("Sin ítems para mostrar", "Agregar ítem", "Seleccioná al menos un ítem").
- **Recomendação**: Trocar "Sin items"→"Sin ítems" nos dois arquivos.

### [BAIXA] aria-label "Remover factura" contradiz o texto visível "Quitar factura" do mesmo botão
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:1770
- **Evidência**: `aria-label="Remover factura" … <HugeiconsIcon icon={Delete02Icon} … /> Quitar factura (l.1774); aria-label="Remover ítem" (l.1461)`
- **Descrição**: Os aria-labels usam "Remover" (lusismo; em es-AR remover = revolver/mexer) enquanto o texto visível do mesmo botão diz "Quitar factura" e outras telas usam "Eliminar ítem"/"Quitar línea". Leitores de tela anunciam termo diferente do que está na tela.
- **Recomendação**: Alinhar aria-labels com o texto visível: "Quitar factura" (l.1770) e "Quitar ítem" ou "Eliminar ítem" (l.1461).

### [BAIXA] Mistura de registro: voseo ("Agregá/Ingresá") vs usted ("Agregue/Ingrese") vs tuteo ("Tipea") nas mesmas telas
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:1001
- **Evidência**: `"Aún no hay ítems. Agregue al menos uno." (l.1001) vs "Ingresá el número de contenedor." (contenedor-matriz.tsx:135); "Ingrese tipo de cambio…" (pago-exterior-dialog.tsx:157) vs "Seleccioná un proveedor."; "Tipea ANULAR" (recalculo-panel.tsx:45)`
- **Descrição**: O app alterna entre voseo es-AR (Agregá, Seleccioná, Indicá, Creá, Configurá), tratamento usted (Agregue, Ingrese, Complete, Cree, Seleccione) e tuteo (Tipea) — às vezes dentro do mesmo formulário (embarque-form usa "Agregue" e "Definí"). Inconsistência de tom em mensagens de validação, placeholders e empty states.
- **Recomendação**: Padronizar no voseo es-AR (Agregá, Ingresá, Tipeá, Seleccioná, Creá) em todo o escopo; varrer com grep por "Agregue|Ingrese|Complete |Cree |Seleccione |Tipea ".

### [BAIXA] Badge "Legacy bundled (cierre)" em inglês para estado de factura
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:1579
- **Evidência**: `LEGACY_BUNDLED: { bg: "bg-amber-100 text-amber-900", label: "Legacy bundled (cierre)" },`
- **Descrição**: O label visível do estado LEGACY_BUNDLED das facturas do embarque fica em inglês técnico ("Legacy bundled"), enquanto os demais estados estão traduzidos (Borrador, Emitida, Anulada). Usuário contábil não tem como interpretar.
- **Recomendação**: Usar algo como "Incluida en cierre (legado)" ou "Contabilizada en el cierre".

### [BAIXA] Botão de fechar de todos os Dialog/Sheet com nome acessível "Close" em inglês
- **Arquivo**: src/components/ui/dialog.tsx:66
- **Evidência**: `<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /><span className="sr-only">Close</span> (dialog.tsx:66; idem sheet.tsx:69; DialogFooter renderiza botão com texto "Close" em dialog.tsx:96)`
- **Descrição**: O X de fechar (showCloseButton default true) presente em todos os diálogos de maestros, comex, gastos etc. tem texto sr-only "Close" — leitores de tela anunciam em inglês num app 100% espanhol. O DialogFooter também tem um botão default literal "Close" (hoje não usado).
- **Recomendação**: Trocar para "Cerrar" em dialog.tsx:66/96 e sheet.tsx:69.

### [BAIXA] Concordância: "; 3 falló" — verbo no singular com plural de fallidas
- **Arquivo**: src/app/(dashboard)/admin/recalcular-percepcion-iibb/recalculo-panel.tsx:60
- **Evidência**: ``${r.anuladas} venda(s) anulada(s)${r.fallidas.length > 0 ? `; ${r.fallidas.length} falló` : ""}.``
- **Descrição**: O toast de resultado fixa "falló" no singular independentemente da contagem ("3 falló" em vez de "3 fallaron"). O bloco de resultado logo abaixo (l.127) usa corretamente "fallaron". Além do "venda(s)" já reportado.
- **Recomendação**: Pluralizar: `${n} ${n === 1 ? "falló" : "fallaron"}` e corrigir "venta(s) anulada(s)".

### [BAIXA] Identificador interno "cantidadEnDespacho" exposto em texto de ajuda ao usuário
- **Arquivo**: src/app/(dashboard)/comex/embarques/[id]/despachos/_components/despacho-cruzado-matriz.tsx:156
- **Evidência**: `Reservar traba las unidades (cantidadEnDespacho) sin contabilizar. El borrador vence en 24 h o lo libera el cron.`
- **Descrição**: A descrição do fluxo de reserva mostra o nome do campo do schema Prisma (cantidadEnDespacho) e menciona "el cron" — jargão técnico interno em texto destinado ao operador.
- **Recomendação**: Remover o parêntese técnico e reescrever: "Reservar traba las unidades sin contabilizar. El borrador vence en 24 h y se libera automáticamente."

### [BAIXA] Anglicismos "template/override/default" em textos visíveis de Gastos fijos
- **Arquivo**: src/app/(dashboard)/gastos-fijos/gastos-fijos-table.tsx:406
- **Evidência**: `"Default del proveedor — opcional override" (l.406) / "Default por tipo de proveedor — opcional override" (l.407); title="Editar template" (l.200); "Templates de gastos recurrentes…" (page.tsx:24)`
- **Descrição**: Placeholders, tooltips e o subtítulo da página misturam inglês de desenvolvedor ("template", "override", "default") em frases com sintaxe estranha ("opcional override"). Em es-AR: "plantilla", "reemplazo/anulación", "predeterminado".
- **Recomendação**: Reescrever: "Plantillas de gastos recurrentes", "Editar plantilla", "Predeterminada del proveedor — reemplazo opcional".

### [BAIXA] Valores de domínio em português (NENHUM, FORNECEDOR, FABRICA_ORIGEM, AGUARDANDO_INVESTIGACAO) sob labels em espanhol
- **Arquivo**: src/app/(dashboard)/comex/contenedores/[id]/investigacion/_components/investigacion-form.tsx:45
- **Evidência**: `{ value: "FORNECEDOR", label: "Proveedor" }, … { value: "NENHUM", label: "Ninguno" }; AGUARDANDO_INVESTIGACAO: "Investigación" (stock-aduanero-table.tsx:19)`
- **Descrição**: Os enums do fluxo de investigación/divergencia estão em português (FABRICA_ORIGEM, NAO_IDENTIFICADA, SINISTRO_SEGURADO, FORNECEDOR, NENHUM, AGUARDANDO_INVESTIGACAO). A UI mapeia para labels em espanhol, mas qualquer estado não mapeado (fallback `?? estado`) vaza o valor pt cru para o usuário, e os valores ficam persistidos no banco.
- **Recomendação**: Dívida: garantir que todo render use o mapa de labels (sem fallback cru) e, em migração futura, renomear os enums para espanhol no schema.

### [BAIXA] Pontuação inconsistente em toasts e placeholders ("Factura anulada" sem ponto; "Seleccionar..." vs "Seleccione cuenta…")
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:1568
- **Evidência**: `toast.success("Factura anulada") (sem ponto) vs toast.success("Compra anulada."); placeholder "Seleccionar..." (gastos-fijos-table.tsx:366) vs "Seleccione cuenta…" (pago-exterior-dialog.tsx:237)`
- **Descrição**: Toasts ora terminam com ponto final ora não, e placeholders alternam três pontos ASCII ("...") com o caractere de reticências ("…") entre telas dos mesmos módulos. Cosmético, mas perceptível em uso contínuo.
- **Recomendação**: Padronizar: toasts com ponto final e reticências tipográficas "…" em placeholders; ajustar embarque-form.tsx:1568 e gastos-fijos-table.tsx:366/368/370.


---

## 12. Falhas de escrita — UI (contabilidad, tesorería, reportes, ventas, CRM, compartilhados)

## Resumo
A camada compartilhada de formatação (src/lib/format.ts) é sólida — Intl es-AR com timeZone UTC bem documentado — mas vários módulos não a usam. Os achados mais graves são datas formatadas no fuso local em client components (date-fns format e toLocaleDateString sem UTC em contabilidad e tesoreria), que mostram o dia anterior para o usuário argentino e causam hydration mismatch. O módulo contabilidad renderiza montos crus em formato en-US (toFixed sem fmtMoney) destoando do resto do app. Em idioma, sobraram lusismos visíveis ("Beneficiário (intermediário)" em toasts e labels do pago batch) e inglês no CRM (Owner/Stage/Score/Templates), em ventas ("Default (NACIONAL)") e nos defaults do shadcn (Close/Toggle Sidebar). Há ainda inconsistências terminológicas que induzem erro: Débito/Crédito com significados opostos entre as duas telas de extracto, e "Crédito/Débito" vs "Debe/Haber" entre os tree tables de reportes, além de mistura de voseo e usted nas mesmas telas e símbolos de moeda (US$/USD/ARS) sem padrão.

## Achados

### [ALTA] Datas formatadas no fuso local em client components — exibem dia anterior (UTC-3)
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/contabilidad/asientos/asientos-table.tsx:63
- **Evidência**: `"use client" ... function formatDate(d: Date) { return format(d, "dd/MM/yyyy"); } — idem mover-form.tsx:69, asiento-detalle-sheet.tsx:103, movimientos-table.tsx:75, movimiento-detalle-sheet.tsx:106`
- **Descrição**: date-fns format() usa o fuso do browser. As fechas-solo são persistidas como midnight UTC (documentado em src/lib/format.ts:15-20, que criou fmtDateAR com timeZone UTC exatamente para isso). Em client components, o usuário argentino (UTC-3) vê a data com 1 dia a menos na lista de asientos, mover-período, sheets de detalhe e tabela de movimientos de tesorería, além de hydration mismatch (React #418) com o SSR em UTC.
- **Recomendação**: Substituir format(d, "dd/MM/yyyy") por fmtDate()/fmtDateOrDash() de src/lib/format.ts (Intl com timeZone UTC) em todos os client components que exibem datas.

### [ALTA] pagos-historial: toLocaleDateString sem timeZone UTC — data errada e hydration mismatch
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/pagos-historial/pagos-historial-table.tsx:18
- **Evidência**: `function fmtFecha(iso: string) { return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }); } — arquivo é "use client"`
- **Descrição**: Mesma classe do achado anterior, em arquivo "use client": sem timeZone: "UTC", pagos com fecha midnight-UTC aparecem com 1 dia a menos no Histórico de pagos para o cliente em Argentina (UTC-3), divergindo do SSR. O próprio módulo redefine fmtMoney/fmtFecha localmente em vez de usar o helper compartilhado.
- **Recomendação**: Usar fmtDateOrDash de src/lib/format.ts (já trata string/Date e timeZone UTC) e remover os formatters locais duplicados.

### [MEDIA] Português em labels e toasts: "Beneficiário"/"intermediário" em telas de pago batch
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/saldos-proveedores/saldos-batch-pago.tsx:385
- **Evidência**: `<Label className="text-[11px]">Beneficiário (intermediário) *</Label> ... toast.error("Seleccioná el beneficiário (intermediário).") (l.208) ... "Pago vía intermediário (despachante / agente)" (l.371)`
- **Descrição**: Grafia portuguesa ("beneficiário", "intermediário") em vez do espanhol "beneficiario"/"intermediario" (sem tilde em -ario) em ~10 strings visíveis: labels, placeholders (l.391/393), toasts de erro/sucesso (l.208/233/235/496) e texto de ajuda (l.376). O mesmo bloco está duplicado em cuentas-a-pagar/embarque-batch-pago.tsx (l.179, 204, 360-470).
- **Recomendação**: Buscar/substituir beneficiário→beneficiario e intermediário→intermediario nos dois arquivos (saldos-batch-pago.tsx e embarque-batch-pago.tsx), inclusive em toasts e placeholders.

### [MEDIA] Contabilidad exibe valores monetários crus (formato en-US, sem separador de milhar)
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/contabilidad/asientos/[id]/page.tsx:149
- **Evidência**: `{detalle.totalDebe} ... {Number(l.debe) > 0 ? l.debe : ""} (l.126) ... US$ {totalUsdDebe.toFixed(2)} (l.157) — origem: actions/asientos.ts:241 totalDebe: asiento.totalDebe.toFixed(2)`
- **Descrição**: Todo o módulo contabilidad renderiza Decimals serializados com toFixed(2) sem passar por fmtMoney: detalhe do asiento (l.126/129/134/149/152/157), lista de asientos (asientos-table.tsx:144), mover-período (mover-form.tsx:364), totais do form novo (asiento-form.tsx:401-416) e asiento-detalle-sheet.tsx:144. Usuário vê "412345.67" enquanto tesorería/BI/reportes mostram "412.345,67" — em es-AR o ponto é separador de milhar, induzindo leitura errada.
- **Recomendação**: Envolver todos os valores com fmtMoney() (ou MoneyAmount) nos pontos de render do módulo contabilidad, mantendo o toFixed apenas na serialização.

### [MEDIA] Convenção Débito/Crédito invertida entre telas irmãs de tesorería (extracto vs extractos importados)
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/extracto/page.tsx:164
- **Evidência**: `<TableHead>Débito (entrada)</TableHead> / <TableHead>Crédito (salida)</TableHead> — mas em extractos/[id]/page.tsx:117 "Total débitos" = .filter((l) => Number(l.monto) < 0) (salidas) e lineas-review.tsx:300 Débito = mode="debit-column" (monto<0)`
- **Descrição**: Na tela /tesoreria/extracto, "Débito" significa entrada de dinheiro (perspectiva contábil da conta ativo). Na tela de extractos importados (/tesoreria/extractos/[id]) e em lineas-review, "Débito" significa saída (convenção do extrato bancário, monto negativo). As mesmas palavras com significados opostos em duas telas do mesmo módulo induzem erro na conciliação.
- **Recomendação**: Unificar a convenção (ex.: usar "Entradas/Salidas" ou padronizar a perspectiva bancária nas duas telas) e ajustar os labels dos KPIs "Total débitos/créditos".

### [MEDIA] Terminologia e ordem inconsistentes: "Crédito/Débito" vs "Debe/Haber" entre tree tables de reportes
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/contabilidad/reportes/balance/balance-tree-table.tsx:134
- **Evidência**: `id: "credito", header: ... >Crédito< ... value = r.haber (l.133-137); id: "debito", header: >Débito< ... r.debe (l.146-152) — vs reportes/_components/cuenta-tree-table.tsx:155/167: headers "Debe" e "Haber"`
- **Descrição**: O Balance de Sumas y Saldos rotula os movimentos como "Crédito" (=haber) e "Débito" (=debe), com a coluna Crédito ANTES da Débito, enquanto Balance General/Estado de Resultados (cuenta-tree-table) usam "Debe"/"Haber" na ordem clássica. Mesmo dado, dois vocabulários e ordens diferentes entre relatórios vizinhos — confunde a leitura de partida doble.
- **Recomendação**: Padronizar em "Debe"/"Haber" (termo usado no resto do app) e ordenar Debe antes de Haber no balance-tree-table.

### [MEDIA] Inglês visível no CRM: "Owner", "Stage", "Score" e "Templates" misturado com "Plantillas"
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/crm/leads/_components/leads-table-bulk.tsx:132
- **Evidência**: `<th className="px-3 py-2 text-right">Score</th> <th className="px-3 py-2">Owner</th> — também oportunidades-table.tsx:61/64 (Stage/Owner), mover-stage-select "Mover a stage:", crm/page.tsx:115-116 title="Templates de email" + description "Plantillas reutilizables (envío manual hasta W5)."`
- **Descrição**: Cabeçalhos de tabela e labels do CRM usam inglês ("Owner", "Stage", "Score") em telas de leads, oportunidades e detalhe. Na home do CRM o card mistura "Templates de email" (título) com "Plantillas reutilizables" (descrição), e expõe jargão interno de roadmap "hasta W5" ao usuário final. crm/page.tsx:124 ainda mistura "por etapa, mover entre stages" na mesma frase.
- **Recomendação**: Traduzir: Owner→Responsable, Stage→Etapa, Score→Puntaje; unificar Templates→Plantillas; remover "hasta W5" da descrição.

### [MEDIA] "Default (NACIONAL)" e "default" em inglês no fluxo de ventas
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/ventas/_components/venta-form.tsx:1411
- **Evidência**: `<SelectValue placeholder="Default" /> ... <SelectItem value="__default__">Default (NACIONAL)</SelectItem> — e venta-detail-view.tsx:183: <span className="text-muted-foreground italic">default</span>`
- **Descrição**: O seletor de depósito por ítem na nova venta mostra "Default" / "Default (NACIONAL)" e o detalhe da venta mostra "default" em itálico na coluna Depósito. É a única tela do fluxo com termo em inglês; o resto do form está em espanhol. Tela de uso diário (criação de venta).
- **Recomendação**: Trocar para "Predeterminado (NACIONAL)" ou "Depósito por defecto" no form e "por defecto" no detail view.

### [MEDIA] Voseo e usted misturados na mesma tela (Seleccioná vs Seleccione/Registre/créelos)
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/movimientos/nuevo/movimiento-form.tsx:387
- **Evidência**: `<SelectValue placeholder="Seleccione una cuenta"> (l.387) vs "Podés partir el cobro en varias contrapartidas" (l.640) — também nueva-cuenta-sheet.tsx:152 "Registre una cuenta...", prestamo-form.tsx:198 "créelos en Maestros", venta-form.tsx:1099 "Verifique IVA:"`
- **Descrição**: O app usa voseo rioplatense na maioria das strings ("Seleccioná", "Subí", "Cargá", "Podés"), mas várias telas misturam tratamento de usted no mesmo formulário: placeholders "Seleccione...", textos "Registre...", "créelos", "use", "Verifique". A alternância dentro da mesma tela passa impressão de descuido e quebra o tom es-AR.
- **Recomendação**: Definir voseo como padrão (já majoritário) e revisar placeholders/helps com formas de usted: Seleccione→Seleccioná, Registre→Registrá, créelos→crealos, Verifique→Verificá.

### [MEDIA] Símbolo de dólar/posição de moeda inconsistente: "US$", "USD " prefixo e "ARS" sufixo
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/cuentas-a-pagar/page.tsx:209
- **Evidência**: `{r.saldoUsd ? `US$ ${fmtMoney(r.saldoUsd)}` : "—"} — vs bi/_tabs/stock-tab.tsx:242 `USD ${fmtMoney(...)}`, bi/compras-tab.tsx:50 `USD ${...}`, saldos-proveedores/page.tsx:86 `${fmtMoney(totalVencido)} ARS` (sufixo)`
- **Descrição**: Valores em dólar aparecem como "US$ 1.234,56" (contabilidad asientos/[id]:157, tesoreria movimientos/[id]:314, reportes libro-mayor:140) e como "USD 1.234,56" no BI; pesos ora levam prefixo "ARS ", ora sufixo " ARS", ora "$". A mistura na mesma suíte de telas dificulta bater valores entre relatórios.
- **Recomendação**: Padronizar um único formato (ex.: prefixo "USD "/"ARS " via prop symbol do MoneyAmount) e aplicar nas telas que concatenam manualmente.

### [MEDIA] Toasts e labels dinâmicos com montos sem formato es-AR (toFixed/string crua)
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/saldos-proveedores/saldos-batch-pago.tsx:235
- **Evidência**: ``Quedó saldo pendiente de ARS ${Math.abs(Number(r.diferencia)).toFixed(2)} con el intermediário.` — e l.233 `ARS ${r.diferencia}` cru; movimiento-form.tsx:1088 `— ARS ${totalSeleccionado.toFixed(2)}``
- **Descrição**: Mensagens de sucesso do pago batch e o header do seletor "Layer 0" interpolam montos com toFixed(2) (ponto decimal, sem milhar) ou o Decimal serializado cru, enquanto o restante da tela usa toLocaleString("es-AR"). O usuário vê "ARS 1234567.89" num toast logo após ver "1.234.567,89" na tabela.
- **Recomendação**: Passar os montos das mensagens por fmtMoney() antes de interpolar (saldos-batch-pago.tsx:233/235, embarque-batch-pago.tsx:204/206, movimiento-form.tsx:1088).

### [BAIXA] Jargão interno "Layer 0" visível como badge no form de movimiento
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/movimientos/nuevo/movimiento-form.tsx:1099
- **Evidência**: `<span className="text-[10px] uppercase tracking-wider text-muted-foreground">Layer 0</span> <span>{labelHeader}</span>`
- **Descrição**: O seletor de facturas a aplicar no novo movimiento exibe o badge "Layer 0" — nome interno da feature de distribuição FIFO (comentários nas l.166/223 de outros arquivos) — sem significado para o operador. Texto em inglês e jargão de implementação vazando para a UI.
- **Recomendação**: Trocar por um rótulo funcional em espanhol, ex.: "Aplicación a facturas" ou simplesmente remover o badge.

### [BAIXA] Datas em formato ISO/inconsistente: moneda-toggle (YYYY-MM-DD), drill-down do balance e cuentas-a-cobrar
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/reportes/_components/moneda-toggle.tsx:80
- **Evidência**: `ARS · {tcInfo.fecha} — tipado como `fecha: string; // YYYY-MM-DD` (l.15); balance-tree-table.tsx:79 format(r.fecha, "yyyy-MM-dd"); cuentas-a-cobrar/page.tsx:281 toLocaleDateString("es-AR", { timeZone: "UTC" }) → "5/6/2026"`
- **Descrição**: O toggle ARS/USD presente em todos os reportes e no BI mostra a data da cotização em ISO ("2026-06-10") em vez de dd/mm/yyyy. O drill-down do Balance de Sumas y Saldos também usa yyyy-MM-dd, e cuentas-a-cobrar usa toLocaleDateString sem 2-digit ("5/6/2026"), divergindo do padrão "05/06/2026" do resto do app.
- **Recomendação**: Usar fmtDate/fmtDateOrDash nesses três pontos para uniformizar em DD/MM/YYYY.

### [BAIXA] Strings em inglês nos componentes ui compartilhados (Close, Toggle Sidebar, Search for a command)
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/components/ui/dialog.tsx:96
- **Evidência**: `<DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close> — também dialog.tsx:66 / sheet.tsx:69 sr-only "Close", sidebar.tsx:281 title="Toggle Sidebar", command.tsx:33 "Search for a command to run..."`
- **Descrição**: Defaults do shadcn não traduzidos: o botão de footer "Close" (renderizado quando showCloseButton=true), o sr-only "Close" lido por leitores de tela, o tooltip nativo "Toggle Sidebar" no trigger da sidebar (visível em hover) e a descrição default do CommandDialog. São os únicos restos de inglês na camada compartilhada.
- **Recomendação**: Traduzir os defaults: Close→Cerrar, Toggle Sidebar→Mostrar/ocultar barra lateral, e a descrição do CommandDialog para espanhol.

### [BAIXA] Tooltip default dos gráficos usa toLocaleString() sem locale fixo
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/components/ui/chart.tsx:243
- **Evidência**: `{typeof item.value === "number" ? item.value.toLocaleString() : String(item.value)}`
- **Descrição**: O formatter default do ChartTooltipContent usa toLocaleString() sem argumento — cai no locale do browser do usuário. Num browser en-US, tooltips de gráficos do dashboard/BI que não passam formatter custom mostrarão "1,234.56" em vez de "1.234,56", divergindo dos eixos formatados com Intl.NumberFormat("es-AR").
- **Recomendação**: Trocar por toLocaleString("es-AR") ou reutilizar fmtInt/fmtMoney de src/lib/format.ts.

### [BAIXA] "Items pendientes" sem acento — resto do app usa "Ítems"
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/ventas/[id]/entregas/nueva/_components/nueva-entrega-form.tsx:114
- **Evidência**: `<h2 className="mb-2 text-sm font-medium">Items pendientes</h2>`
- **Descrição**: Título da seção no form de nova entrega grafado "Items" sem acento, enquanto venta-form.tsx, pedido-venta-form.tsx ("Agregar ítem", "Ítems del pedido") e pedidos-venta-table.tsx usam "Ítem/Ítems" com acento, conforme a RAE.
- **Recomendação**: Corrigir para "Ítems pendientes".

### [BAIXA] Ortografia: "Sobreescribir" em vez de "Sobrescribir" no import de extracto
- **Arquivo**: /Users/abdolatif/Projects/sunset-erp-v4/src/app/(dashboard)/tesoreria/extractos/nuevo/upload-form.tsx:107
- **Evidência**: `Sobreescribir cuenta bancaria (opcional)`
- **Descrição**: Label do campo de override no upload de extracto bancario usa "Sobreescribir", grafia não recomendada pela RAE (o correto é "Sobrescribir", com um só "e").
- **Recomendação**: Trocar para "Sobrescribir cuenta bancaria (opcional)".


---

## 13. Falhas de escrita e desatualização — Vault Obsidian

## Resumo
O vault é disciplinado (ADRs datados, erratas IIBB bem feitas, INDEX com regras de manutenção), mas os documentos de referência pararam no tempo: 01-contabilidad e 02-workflows refletem o sistema de abril/2026, anteriores às ondas Comex ZPA/Modelo Y (PRs #109-143), ao pago exterior USD (#161-165), à moneda funcional (#174-176) e à renomeação das cuentas 1.1.5 (#177). STATE.md está congelado em 2026-05-20 e o PRD descreve a geração anterior do sistema (Python/Flask v2). Há contradições não marcadas como superseded (diferencia cambiaria no pago exterior: 2026-05-23 vs 2026-05-26/27), um arquivo duplicado em 04-decisions e logs de execução na pasta de decisões. Estruturalmente faltam notas por módulo (ventas, stock dual, gastos, BI), um fluxograma do fluxo bonded/Modelo Y dentro do vault e um glossário — hoje o fluxo dominante em produção só está documentado no repo (docs/fluxo-zona-primaria.md) e em ADRs dispersas.

## Achados

### [ALTA] plan-de-cuentas.md ignora renomeação 'Estoque + depósito + estado' e subcontas 1.1.5.03/.04/.05
- **Arquivo**: SUNSET ERP/01-contabilidad/plan-de-cuentas.md
- **Evidência**: `Doc (ultima_atualizacao: 2026-04-26): '1.1.5 BIENES DE CAMBIO' sem analíticas. Código: MERCADERIAS { codigo: "1.1.5.01", nombre: "Estoque TP - Nacionalizado" } + 1.1.5.03/.04/.05 (cuenta-registry.ts:171, 86, 288, 293; PR #177 commit 9b41ad/9b9342)`
- **Descrição**: O doc de referência do plano de contas não menciona nenhuma das 5 analíticas de Bienes de Cambio nem seus nomes atuais pós-PR #177 ('Estoque TP - Nacionalizado', 'Estoque En Tránsito - Marítimo', 'Estoque a Entregar', 'Estoque TP Logistica - Zona Primária/Depósito Fiscal'). Quem consultar o vault para lançamento manual ou conciliação usará nomes antigos e desconhecerá 1.1.5.04/.05 (núcleo do fluxo ZPA/DF).
- **Recomendação**: Adicionar seção 'Bienes de Cambio (1.1.5)' com a tabela atual das 5 analíticas + mapping de flujos (ARRIBO/TRASLADO/NACIONALIZACION), citando COMEX_ZPA_CODIGOS, e atualizar ultima_atualizacao.

### [ALTA] reglas-asientos.md documenta 5 geradores; motor real tem ~20 e tributos de despacho cruzado capitalizam
- **Arquivo**: SUNSET ERP/01-contabilidad/reglas-asientos.md
- **Evidência**: `Doc: 'Debe: Contas de Gastos (ex: 5.7.1.01 DIE...)'. Código: 'capitaliza DIE + Tasa + Arancel + subtotal' e 'NO se debitan a egreso 5.7.1.x' (asiento-automatico.ts:2711, 2753); faltam crearAsientoVenta/Compra/Gasto/ZonaPrimaria/ArriboComex/DespachoCruzado/Entrega`
- **Descrição**: O doc é apontado pelo CLAUDE.md como leitura obrigatória antes de refactor do motor contábil, mas cobre apenas préstamo, cobro, pago, transferência e o embarque monolítico legacy. No fluxo Modelo Y vigente, DIE+Tasa+Arancel capitalizam em 1.1.5.01 (decisão de 2026-05-22), o oposto do que o doc afirma. Asientos de venta (CMV, provisión, IIBB embutido), ZP, arribo, despacho cruzado e diferencia cambiaria estão ausentes.
- **Recomendação**: Reescrever listando os ~20 geradores de asiento-automatico.ts com 1 linha de DEBE/HABER cada, marcando a seção de embarque monolítico como legacy e documentando a capitalização de tributos no despacho cruzado.

### [ALTA] importacion.md não cobre Modelo Y/contenedores; afirma que ZP sempre gera stock físico no depósito ZPA
- **Arquivo**: SUNSET ERP/02-workflows/importacion.md
- **Evidência**: `Doc: 'Confirmar Zona Primária ... + MovimientoStock INGRESO no depósito ZPA (novidade da Fase B)'. Código: 'Modelo Y (Ponte PR C): embarques CON contenedores (flag on) NO usan el...' + crearAsientoArriboComex debita 1.1.5.04 (embarques.ts:824-831)`
- **Descrição**: A última atualização do doc é de 2026-05-19 (PR #95). Todo o desenho posterior — Contenedor/ItemContenedor, desconsolidación no DF, despacho cruzado, VEP por despacho cruzado, flag CONTENEDOR_DESCONSOLIDACION_ENABLED, asiento de arribo DEBE 1.1.5.04/HABER 1.1.5.02 — não existe no vault workflow. No Modelo Y a ZP NÃO move stock (1º ingresso físico é a desconsolidación), contradizendo o texto. O fluxo descrito não é o usado em prod.
- **Recomendação**: Adicionar seção 'Modelo Y (vigente)' espelhando docs/fluxo-zona-primaria.md do repo (máquina de estados do Contenedor + asientos por transição) e marcar as seções anteriores como legacy/modular intermediário.

### [ALTA] tributos-import.md com contrapartidas pasivo erradas e tratamento DIE/Tasa superseded sem nota
- **Arquivo**: SUNSET ERP/01-contabilidad/tributos-import.md
- **Evidência**: `Doc: '| IVA Adicional 20% | 1.1.4.05 | `2.1.3.01` IVA ADICIONAL POR PAGAR |' e 'DIE ... Gasto Real (5.7.1.01)'. Registry: IVA_POR_PAGAR 2.1.5.04, DIE_PASIVO 2.1.5.01, TASA 2.1.5.02, ARANCEL 2.1.5.03 (cuenta-registry.ts:230-248)`
- **Descrição**: A coluna 'Contrapartida (Passivo 2.1.3)' mistura código e nome de cuentas diferentes (2.1.3.01 é IVA DÉBITO FISCAL, não 'IVA ADICIONAL POR PAGAR') e ignora que o código real usa pasivos 2.1.5.x para tributos aduaneros. Além disso, 'Somente DIE e Tasa são gastos reais (5.7.1.x)' vale só para o fluxo legacy: no despacho cruzado (Modelo Y) esses tributos capitalizam no custo. Doc sem frontmatter/data, parece vigente.
- **Recomendação**: Corrigir a tabela com os pares reais do EMBARQUE_CODIGOS (créditos 1.1.4.x ↔ pasivos 2.1.5.x/2.1.3.02/03) e adicionar errata sobre capitalização de DIE/Tasa/Arancel no fluxo Modelo Y.

### [ALTA] STATE.md congelado em 2026-05-20 — não cobre Comex ZPA ondas, pago exterior, moneda funcional
- **Arquivo**: SUNSET ERP/STATE.md
- **Evidência**: `Frontmatter: 'tipo: live-state / ultima_atualizacao: 2026-05-20 / ultima_sesion: analise-vault-execucao-automatica'. Git real: PRs #109-177 (ondas ZPA, Modelo Y, pago exterior #161-165, moneda funcional #174-176, renombrar 1.1.5 #177) até junho.`
- **Descrição**: O 'estado vivo do sistema' (2º arquivo do cold-start protocol) está ~3 semanas atrás do código e não menciona nada do trabalho mais transformador do projeto (fluxo bonded em produção, infra de testes Vitest+Testcontainers, saldo USD invariante). Ainda lista como 'capacidades atuais' o fluxo de 2026-04-27/28 e como backlog itens já entregues (ex.: 'Saldos por cliente (CxC)' — entregue no PR #78).
- **Recomendação**: Reestruturar STATE como snapshot curto e substituível (estado em prod, módulos, pendências reais) e mover o histórico de sessões acumulado para 03-sessions/changelog; atualizar até PR #177.

### [ALTA] Contradição não marcada: diferencia cambiaria no pago exterior (ADR 2026-05-23 v2 vs Fase 2 de 2026-05-26/27)
- **Arquivo**: SUNSET ERP/04-decisions/2026-05-23-comex-pago-exterior-usd-desde-ars.md
- **Evidência**: `2026-05-23 (Atualização 2/PR #165): 'Sem 4.3.1.01 ... nem 5.8.2.01 nesta rota ... Diferença cambial NÃO se gera no momento do pago'. 2026-05-26 ADR + INDEX 2026-05-27: 'PRs #175 (Fase 2 booking auto, helper FIFO...)' com 4.5.1.01/5.5.3.01 mergeado.`
- **Descrição**: A decisão v2 do pago exterior (asiento 2 linhas, diferencia só em fechamento manual) foi revertida 3 dias depois pela Fase 2 da moneda funcional (booking automático FIFO de diferencia cambiaria no pago USD, PR #175). Nenhum dos documentos referencia o outro nem usa marcador 'superseded'; o ADR de 2026-05-26 segue status vigente dizendo que o booking automático está 'fora do alcance (fase 2)', embora já esteja em prod.
- **Recomendação**: Adicionar nota de supersede cruzada nos dois ADRs (frontmatter supersede_parcialmente, como feito na cadeia IIBB) e addendum no ADR 2026-05-26 registrando que a Fase 2 foi implementada (PR #175).

### [ALTA] PRD.md descreve o sistema v2 em Python/Flask — não o ERP atual
- **Arquivo**: SUNSET ERP/00-project/PRD.md
- **Evidência**: `'Backend | Python 3.11 + Flask', 'ORM | SQLAlchemy', 'sunset-erp-v2/', 'Frontend | HTML5 + Bootstrap 5', plano de contas estático com 2.1.3.05 RETENCIONES GANANCIAS / 2.1.3.06 RETENCIONES IIBB.`
- **Descrição**: O único documento de requisitos do vault (apontado pelo INDEX como 'Requisitos de produto') é da geração anterior (v2, 2026-04-15). Stack, arquitetura, modelos, fórmulas (ex.: contabilização do embarque com 'Haber: Banco') e até o plano de contas divergem do sistema v4 em produção. Qualquer agente/pessoa que o use como spec produzirá decisões erradas.
- **Recomendação**: Renomear/mover para histórico (ex.: 00-project/_archive/PRD-v2-flask.md) com banner de obsolescência, e criar um PRD v4 enxuto ou apontar explicitamente para o código + workflows como spec vigente.

### [MEDIA] INDEX.md: banner de retomada e tabela de ADRs recentes desatualizados
- **Arquivo**: SUNSET ERP/INDEX.md
- **Evidência**: `'⚠️ ¿Retomando? Última sesión: [[2026-05-20-analise-vault-execucao-automatica]] ... Pendiente bloqueante: acceso al DB Railway (ECONNRESET)'; tabela 'ADRs recentes (alta prioridade)' termina em 2026-05-11.`
- **Descrição**: O entry-point do cold-start aponta sessão de 2026-05-20 como última, embora existam sessões até 2026-05-27 e os appends do próprio INDEX cheguem a 2026-05-27. O 'pendiente bloqueante' Railway já foi superado (trabalho em prod continuou). A tabela curada de ADRs prioritários não inclui nenhuma das ~20 decisões de 19-26/05 (ZPA, Modelo Y, moneda funcional), que só aparecem em appends cronológicos no fim.
- **Recomendação**: Atualizar o banner a cada fim de sessão (ou removê-lo em favor de STATE) e incluir na tabela de ADRs os registros de maio (tipo-deposito, ondas ZPA, pago exterior, moneda funcional).

### [MEDIA] CLAUDE.md afirma que não há suite de testes — falso desde a Onda 2 (Vitest+Testcontainers)
- **Arquivo**: SUNSET ERP/CLAUDE.md
- **Evidência**: `Doc: 'Testes: Não há suite ativa (vitest/jest). Validação via pnpm typecheck + pnpm build + smoke manual.' Repo: package.json:26 '"test": "vitest run"' + vitest.config.ts + test/*.test.ts (ex.: pago-exterior-action.test.ts, 11 testes).`
- **Descrição**: O doc de convenções (ultima_revisao: 2026-04-26) instrui agentes a validar só com typecheck/build, quando o projeto tem infra Vitest+Testcontainers desde os PRs #115-119 e os ADRs recentes dependem dela (9-12 testes por PR). Um agente que siga o CLAUDE.md do vault deixará de rodar/escrever testes. Também lista stack sem itens novos (Testcontainers, decimal.js explícito) e geradores de asiento incompletos na 'Regra de Ouro 4'.
- **Recomendação**: Atualizar seção Testes (pnpm test, Testcontainers, quando mockar @/lib/auth) e a lista de geradores da Regra 4; revisar ultima_revisao.

### [MEDIA] CLAUDE.md e INDEX.md dão instruções opostas sobre como atualizar STATE
- **Arquivo**: SUNSET ERP/CLAUDE.md
- **Evidência**: `CLAUDE.md: '1. Update [[STATE]] (estado atual) — overwrite, não append.' INDEX.md: '1. Update [[STATE]] (estado atual, anexar nova seção).'`
- **Descrição**: Os dois documentos de governança do vault se contradizem no ritual de fim de sessão. Na prática venceu o append: STATE.md virou um log de ~126k chars com dezenas de seções 'Sessão ...' — exatamente o que o CLAUDE.md tenta evitar — duplicando o papel de 03-sessions e do changelog e tornando o 'estado atual' difícil de extrair.
- **Recomendação**: Decidir um modelo (recomendado: STATE = snapshot substituível; histórico em changelog/sessions), alinhar o texto nos dois arquivos e compactar o STATE atual movendo as seções antigas para 03-sessions.

### [MEDIA] Arquivo duplicado '2026-05-23-comex-pago-exterior-usd-desde-ars 1.md' (artefato de cópia/sync)
- **Arquivo**: SUNSET ERP/04-decisions/2026-05-23-comex-pago-exterior-usd-desde-ars 1.md
- **Evidência**: `Arquivo ' 1.md' contém apenas '## Atualização (mais tarde no mesmo dia) — PR #163 mergeado...', texto quase idêntico à seção '## Atualização 1' do arquivo principal (diferença: status #164 'aberto, aguardando review' vs 'MERGED' no principal).`
- **Descrição**: É uma cópia parcial e DESATUALIZADA (snapshot anterior à merge do #164) da atualização que já vive consolidada no ADR principal. Sem frontmatter nem título H1. Padrão de nome ' 1.md' indica colisão de criação do Obsidian/sync. Mantê-la cria risco de alguém ler a versão velha do status dos PRs.
- **Recomendação**: Deletar o arquivo ' 1.md' (conteúdo integralmente coberto pela 'Atualização 1' do ADR principal), conforme a própria regra do INDEX de deletar docs stale.

### [MEDIA] Dois pares de cuentas de diferencia de cambio (4.3.1.01/5.8.2.01 vs 4.5.1.01/5.5.3.01) sem doc de uso
- **Arquivo**: SUNSET ERP/01-contabilidad/plan-de-cuentas.md
- **Evidência**: `Registry: TRANSFERENCIA_CODIGOS DIF_CAMBIO_POSITIVA 4.3.1.01 / NEGATIVA 5.8.2.01 e DIFERENCIA_CAMBIO_CODIGOS GANANCIA 4.5.1.01 / PÉRDIDA 5.5.3.01 (cuenta-registry.ts:313-365). Vault só documenta 4.3.1.01/5.8.2.01 ('Ganho cambial em revaluação USD').`
- **Descrição**: Desde os PRs #174-175 coexistem dois pares de contas de diferencia cambiaria: o par legado (transferências/VEP) e o par novo da moneda funcional (booking automático em pago USD). Nenhum doc de 01-contabilidad explica qual par usar em cada situação — plan-de-cuentas.md e categorias-cliente-proveedor.md citam só o par antigo. Risco real de asiento manual de centavos/conciliação na cuenta errada, poluindo o Estado de Resultados.
- **Recomendação**: Adicionar em plan-de-cuentas.md (ou impuestos-argentina.md) uma tabela 'Diferencias de cambio: qual cuenta usar' cobrindo transferências, VEP, pago exterior e revaluación, com referência aos ADRs 2026-05-23/26.

### [MEDIA] categorias-cliente-proveedor.md ainda 'proposta-pendiente-implementacion' e com ranges exterior errados
- **Arquivo**: SUNSET ERP/01-contabilidad/categorias-cliente-proveedor.md
- **Evidência**: `Frontmatter: 'status: proposta-pendiente-implementacion'. Doc: 'Proveedores do Exterior — sob 2.1.1.50-99 (atual scheme)'. Código: PROVEEDOR_MERCADERIA_EXTERIOR { padre: "2.1.8" } (cuenta-auto.ts:192-200).`
- **Descrição**: A proposta foi implementada em 2026-04-26 (ADR + enums TipoCanal/TipoProveedor no schema), mas o doc segue marcado como pendente — dívida já apontada no consolidado de pendências (§4.3) e nunca fechada. Pior: a seção de proveedores exterior descreve o range antigo 2.1.1.50-99 como 'atual', contradizendo plan-de-cuentas.md e o código (2.1.8.10-49/50-99). Dois docs de referência vigentes dão respostas diferentes para a mesma pergunta.
- **Recomendação**: Mudar status para 'vigente/implementado', corrigir a seção exterior para 2.1.8.x e remover a nota 'decidir no refactor' (já decidido).

### [MEDIA] pendientes-2026-05-18-consolidado.md marcado 'vigente' mas ~3 semanas defasado
- **Arquivo**: SUNSET ERP/00-project/pendientes-2026-05-18-consolidado.md
- **Evidência**: `Frontmatter: 'ultima_revisao: 2026-05-19 / status: vigente'. Top-5: 'Confirmar/concluir merge do PR #78 ... e do PR #76' (mergeados); nada sobre ondas ZPA, 6 gaps do piloto bonded, moneda funcional.`
- **Descrição**: O INDEX aponta este snapshot como ⭐ vigente, mas ele antecede todo o ciclo Comex ZPA/Modelo Y e o piloto real (que gerou 6 gaps com pendências próprias). Quem retomar o projeto pelo caminho oficial priorizará smoke tests de PRs de 11-13/05 em vez das pendências reais (gaps do piloto, ativação flag, asientos manuais de centavo, rotação de senha Railway ainda sem evidência de execução).
- **Recomendação**: Gerar novo snapshot consolidado (mesma metodologia de 4 subagentes) ou rebaixar o status deste para 'historico', atualizando o ponteiro no INDEX.

### [MEDIA] 02-workflows cobre só 3 módulos — faltam ventas, stock dual, gastos, CRM, BI, simulaciones
- **Arquivo**: SUNSET ERP/02-workflows/
- **Evidência**: `Listagem: contabilidad.md, importacion.md, tesoreria.md. Módulos do app sem workflow: ventas (CMV/provisión/IIBB embutido/cheques), inventario stock dual físico/aduaneiro (W3), gastos/gastos-fijos, CRM (W4), BI, comex/simulaciones.`
- **Descrição**: Para o vault servir de fonte de verdade narrativa (como o INDEX promete: 'Vault guarda regras, decisões, histórico e workflows'), faltam notas dos fluxos com mais regras de negócio: venta (emissão→entrega, 1.1.5.03, percepción embutida), stock dual SPD e seus invariantes, gastos ad-hoc/fijos. Hoje essas regras só existem espalhadas em ADRs e no STATE — caro de reconstruir e fácil de contradizer.
- **Recomendação**: Criar 1 nota curta por módulo em 02-workflows (estados, asientos gerados, validações, links para ADRs e arquivos do repo), começando por ventas e inventario/stock dual.

### [MEDIA] relatorios-financeiros.md: spec aspiracional do 'ERP v3' sem status, com exemplos fora do padrão do plano
- **Arquivo**: SUNSET ERP/01-contabilidad/relatorios-financeiros.md
- **Evidência**: `'...relatórios financeiros do Sunset Tires ERP v3'; exemplo de tabela com códigos '1.1.01 Caja Abdo AR$' (3 níveis); seção 'Fluxo de Caixa Projetado ... 6 meses' descreve módulo de orçamento/projeção inexistente.`
- **Descrição**: O doc mistura requisitos já implementados (tree-table com drill-down) com um Fluxo de Caixa Projetado que nunca foi construído (o flujo real itera asientos que tocam bancos, redesenho de 2026-04-28). Sem frontmatter, sem status, citando 'v3', e com códigos de exemplo que violam a estrutura de 4 níveis. Leitor não consegue distinguir o que é espec implementada, backlog ou obsoleto.
- **Recomendação**: Adicionar frontmatter com status por seção (implementado/backlog), corrigir exemplos para códigos de 4 níveis e referenciar as rotas reais de /reportes.

### [BAIXA] calendario-fiscal.md aponta revaluação USD para range antigo 2.1.1.50-99
- **Arquivo**: SUNSET ERP/01-contabilidad/calendario-fiscal.md
- **Evidência**: `'Cierre mensual — revaluação USD `2.1.1.50-99` (Proveedores Exterior), conciliação bancária.' Código: proveedores exterior em 2.1.8.x (cuenta-auto.ts:192-200).`
- **Descrição**: Referência residual ao esquema de contas anterior à criação da sintética 2.1.8 PROVEEDORES DEL EXTERIOR. Quem montar a rotina de cierre mensual a partir deste doc revaluaria o range errado (2.1.1.50-99 hoje abriga MARKETING/OTRO nacionais).
- **Recomendação**: Trocar para '2.1.8.x (Proveedores del Exterior)' e mencionar que a revaluación periódica é a Fase 3 deferida do ADR moneda funcional.

### [BAIXA] 04-decisions contém logs de execução; 03-sessions tem lacuna de 20-26/05
- **Arquivo**: SUNSET ERP/04-decisions/2026-05-20-comex-zpa-onda1-execucao.md
- **Evidência**: `Em 04-decisions/: '2026-05-20-comex-zpa-onda1-execucao.md', 'onda2-execucao', '2026-05-21-comex-zpa-onda3-fase4-execucao', 'fase4.4-fase5-execucao'. Em 03-sessions/ não há nenhum log entre 2026-05-20 e 2026-05-26.`
- **Descrição**: A convenção do INDEX (decisões em 04-decisions, logs cronológicos em 03-sessions) foi violada justamente no período mais denso do projeto: os registros de execução das ondas ZPA viraram 'decisions'. Isso infla a pasta de ADRs (56 arquivos), dificulta achar decisões reais e quebra a busca por sessão ('o que aconteceu na sessão Y?').
- **Recomendação**: Mover os arquivos '*-execucao.md' para 03-sessions (mantendo aliases/links) ou renomear deixando claro no frontmatter tipo: session-log.

### [BAIXA] Lixo na raiz do vault: TERMINAL-TESTE.md (dump de terminal) e dependabot-squash-plan-2026-05-19.md
- **Arquivo**: SUNSET ERP/TERMINAL-TESTE.md
- **Evidência**: `TERMINAL-TESTE.md é colagem bruta de log do `next dev` ('▲ Next.js 16.2.4 (Turbopack)... The column `Embarque.valorFleteOrigen` does not exist'), erro de schema resolvido em abril.`
- **Descrição**: Dois arquivos soltos na raiz violam a estrutura por pastas e a regra do próprio INDEX ('stale reference docs → deletar'). O TERMINAL-TESTE.md não tem valor documental (o bug de coluna faltante foi resolvido via db push há semanas); o plano dependabot de 2026-05-19 já foi executado (cascade merge de 11 PRs registrado no INDEX).
- **Recomendação**: Deletar TERMINAL-TESTE.md; mover dependabot-squash-plan-2026-05-19.md para 03-sessions ou _archive com status executado.

### [BAIXA] Especificação UX/UI na raiz: spec já executada, sem frontmatter/status, com stack parcialmente errada
- **Arquivo**: SUNSET ERP/Especificação Funcional e Técnica — Refatoração de UX_UI e Relatórios.md
- **Evidência**: `'Stack: Next.js 16, TypeScript, Tailwind CSS v4, Shadcn/UI, Recharts/Chart.js' + 'Execute esta refatoração passo a passo.' — prompt de 2026-04-27 (ADR 2026-04-27-refator-ux-relatorios) já implementado (redesign warm-light 2026-04-28).`
- **Descrição**: É um prompt de tarefa executado há semanas vivendo na raiz como se fosse spec vigente, sem frontmatter nem marca de concluído. Cita Shadcn/Chart.js quando o projeto usa @base-ui (CLAUDE.md: 'não Radix') e Recharts. A solução implementada divergiu em pontos (paleta warm-light própria vs 'Premium Dark'), o que o doc não registra.
- **Recomendação**: Mover para 00-project/ (ou _archive) com frontmatter status: executado e link para o ADR e a sessão de redesign que registram o resultado real.

### [BAIXA] Frontmatter e idioma inconsistentes entre docs de referência
- **Arquivo**: SUNSET ERP/01-contabilidad/reglas-asientos.md
- **Evidência**: `Sem frontmatter: reglas-asientos.md, tributos-import.md, relatorios-financeiros.md, 02-workflows/*.md, PRD.md. Status values divergentes: 'vigente', 'aceptado', 'aceito', 'proposta-pendiente-implementacion'. Idioma alterna pt-BR/es-AR no mesmo doc (INDEX).`
- **Descrição**: Metade dos docs de 01-contabilidad/02-workflows não tem o frontmatter (tipo/status/ultima_atualizacao) que o restante do vault usa, impossibilitando saber se estão vigentes e desde quando. O vocabulário de status não é padronizado (es/pt misturados), o que quebra qualquer query Dataview/automação futura sobre vigência.
- **Recomendação**: Padronizar frontmatter mínimo (tipo, status com vocabulário fixo, ultima_atualizacao) em todos os docs de referência; rodar uma passada única adicionando-o aos 7 arquivos sem ele.

### [BAIXA] importacion.md: inconsistências menores — rateio 'pelo peso FOB' e ciclo de estados incompleto na seção legacy
- **Arquivo**: SUNSET ERP/02-workflows/importacion.md
- **Evidência**: `'O sistema calcula o custo unitário final de cada item (rateio de todos os custos pelo peso FOB)' vs fórmula seguinte 'proporcion = item.total_fob / embarque.fob_total'; ciclo de 7 estados sem EN_ZONA_PRIMARIA (enum real tem 8, schema.prisma:76-85).`
- **Descrição**: Na seção principal, 'peso FOB' sugere rateio por peso físico quando a fórmula (e o código) usam valor FOB — ambiguidade perigosa num doc contábil. O ciclo de vida lista 7 estados do fluxo legacy e omite EN_ZONA_PRIMARIA, que só aparece no update de 2026-05-19, deixando a primeira metade do doc internamente inconsistente com a segunda.
- **Recomendação**: Trocar 'peso FOB' por 'valor FOB' e atualizar a lista de estados com EN_ZONA_PRIMARIA, marcando explicitamente a seção inicial como fluxo legacy.

### [BAIXA] Falta glossário e fluxograma do fluxo bonded dentro do vault (vive só no repo)
- **Arquivo**: SUNSET ERP/INDEX.md
- **Evidência**: `Único diagrama do fluxo Modelo Y está em docs/fluxo-zona-primaria.md do repo (máquina de estados do Contenedor) — que, aliás, já exibe nomes antigos ('1.1.5.01 MERCADERÍAS') pós-renomeação do PR #177. Vault não tem glossário de ZPA/DF/SPD/Modelo Y/bonded.`
- **Descrição**: Termos centrais do domínio (ZPA, DF, desconsolidación, Modelo Y, SPD, despacho cruzado, bonded, TC oficializado) aparecem em dezenas de notas sem definição canônica. O fluxograma do fluxo dominante não existe no vault e a versão do repo já está desatualizada nos nomes de cuentas, mostrando a fragilidade de manter o diagrama num só lugar sem dono.
- **Recomendação**: Criar 01-contabilidad/glossario.md (ou 00-project/) com definições de 1 linha + links, e espelhar/linkar o diagrama de estados do Contenedor no workflow de importacion.md, atualizando os nomes 1.1.5.x.


---

## 14. UI/UX — auditoria do estado atual

## Resumo
A UI é um dashboard Next.js/shadcn denso e visualmente cuidado: sidebar plana colapsável com 4 grupos (General, Operación, Contabilidad, Maestros) e 13 itens de nível único, header de 44px com breadcrumb auto-gerado, e módulos que abrem em "hub pages" de cards (Comex, Contabilidad, Tesorería) antes de chegar às telas reais. O dashboard mostra card de alertas com links, 4 KPIs principais (saldo bancos+caja, pasivo, resultado, asientos), gráfico ingresos/egresos 6m, cards de saldos bancários/préstamos/últimos asientos/embarques recientes e 4 stats secundários — tudo com Suspense+skeletons (47 loading.tsx), mas nenhum KPI é clicável e não há personalização. As tabelas usam TanStack Table apenas como renderizador (getCoreRowModel em 100% dos casos): não existe ordenação, filtros salvos, colunas configuráveis, seleção em massa, inline edit nem export CSV/Excel em lugar nenhum, e a paginação server-side (componente Pagination, 25/50/100/200) é usada em só 3 de 89 páginas — asientos faz findMany sem take e produtos renderiza ~1053 linhas no DOM. Forms longos (embarque-form, 2215 linhas) têm validação zod inline com FieldError e sticky action bar com totais ao vivo, porém sem dirty guard, sem autosave e sem máscara monetária (regex exige ponto decimal em UI es-AR); erros de servidor chegam por toast. Dark mode está morto (next-themes instalado sem ThemeProvider, classes dark: nunca ativam), há um único error.tsx (comex), busca global/command palette inexiste apesar de cmdk instalado, e cada listagem inventa seu próprio padrão de header, filtros e badges de estado.

## Achados

### [ALTA] Sem busca global / command palette apesar de cmdk instalado
- **Arquivo**: package.json:51
- **Evidência**: `"cmdk": "^1.1.1", — command.tsx é importado apenas por producto-combobox, cliente-combobox, cuenta-combobox, proveedor-combobox e asiento-form; nenhum CommandDialog global`
- **Descrição**: ERP com 89 páginas e registros identificados por código (venta nº, embarque 036CN, asiento nº) não tem nenhuma forma de pular direto a um registro ou tela: nem busca global, nem Cmd+K, nem recents/favoritos. O cmdk já está no bundle mas só alimenta comboboxes de formulário. No NetSuite a Global Search é o principal mecanismo de navegação.
- **Recomendação**: Criar CommandDialog global (Cmd+K) no layout do dashboard: navegação por NAV_ITEMS + busca server de ventas/embarques/asientos/clientes/productos por código/nome, com ações rápidas (nueva venta, nuevo embarque).

### [ALTA] Tabelas são render-only: sem ordenação, filtros salvos, colunas configuráveis, seleção em massa ou inline edit
- **Arquivo**: src/components/ui/data-table.tsx:21
- **Evidência**: `export function DataTable<T>({ table, emptyMessage = "Sin registros.", ... }) — grep por getSortedRowModel|getFilteredRowModel|columnVisibility|rowSelection retorna 0 ocorrências em todo o src`
- **Descrição**: Todas as ~30 tabelas do app usam TanStack Table só com getCoreRowModel: nenhum header é clicável para ordenar, não há seletor de colunas, densidade, seleção em massa para ações em lote, nem edição inline. Filtros não persistem por usuário (saved views). A ordenação é fixa no server (orderBy hardcoded). Benchmark NetSuite: toda list view ordena por coluna, salva views e permite mass update.
- **Recomendação**: Evoluir DataTable: ordenação server-side via searchParams (?sort=), menu de visibilidade de colunas persistido (localStorage/preferência), checkbox de seleção com barra de ações em lote nas listas que têm ações (asientos, leads).

### [ALTA] Nenhum export CSV/Excel/PDF em listagens nem nos reportes contábeis
- **Arquivo**: src/app/(dashboard)/reportes/libro-mayor/page.tsx:123
- **Evidência**: `<MayorFilters cuentas={cuentas} ... /> <DateRangeFilter ... /> <MonedaToggle ... /> — página só tem filtros+tabela; grep -rln "csv|exportar|xlsx" no app só encontra crm/leads/import (importação)`
- **Descrição**: Libro Mayor, Libro Diario, Balance, listagens de ventas/asientos: nada pode ser exportado. Para um ERP contábil argentino isso é gap grave de fluxo real — contador/auditor precisa levar o mayor a Excel, e apresentações AFIP partem de planilhas. Também não há print stylesheet. Único caminho hoje é copiar/colar a tabela HTML.
- **Recomendação**: Botão "Exportar CSV/XLSX" nos reportes e listagens (route handler server-side reusando o mesmo service + filtros da URL) e um print.css básico para os reportes contábeis.

### [ALTA] Paginação server-side existe mas é usada em só 3 de 89 páginas; asientos carrega tudo sem take
- **Arquivo**: src/app/(dashboard)/contabilidad/asientos/page.tsx:80
- **Evidência**: `const asientos = await db.asiento.findMany({ where, orderBy: [{ fecha: "desc" }, ...] — sem take/skip; Pagination só é importada em ventas/page.tsx, compras/page.tsx e comex/embarques/page.tsx`
- **Descrição**: O componente Pagination (25/50/100/200, contador es-AR) é bom, mas asientos, movimientos de tesorería, gastos, leads etc. fazem findMany ilimitado. Em asientos o default é o mês corrente, porém o botão "Histórico completo" do DateRangeFilter remove o filtro e renderiza TODOS os asientos numa tabela só — com anos de partida doble isso degrada e trava o navegador. Padrão inconsistente entre telas.
- **Recomendação**: Adotar parsePaginationParams+Pagination em todas as listagens com findMany ilimitado (asientos, movimientos, gastos, leads) e impor take máximo no server.

### [ALTA] Sem dirty guard nem autosave: 'Cancelar' descarta o form de embarque (2215 linhas) sem confirmação
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:1302
- **Evidência**: `onClick={() => router.push("/comex/embarques")} ... {readonly ? "Volver" : "Cancelar"} — grep por beforeunload|isDirty retorna 0 ocorrências em todo o src`
- **Descrição**: Nenhum form do app protege dados não salvos: clicar Cancelar, num item da sidebar ou no breadcrumb durante a digitação de um embarque (dezenas de campos: itens FOB, facturas de custos, tributos) perde tudo silenciosamente. Não há rascunho automático nem confirm de saída. É o risco de perda de trabalho mais alto do app, justamente no form mais longo.
- **Recomendação**: Usar formState.isDirty do react-hook-form: confirm dialog no Cancelar, listener beforeunload quando dirty, e idealmente rascunho em localStorage para os forms de embarque/venta/compra.

### [ALTA] Rota órfã: /ventas/[id]/entregas não é linkada de nenhuma tela
- **Arquivo**: src/app/(dashboard)/ventas/_components/venta-detail-view.tsx:101
- **Evidência**: `<div className="flex items-center gap-2">{puedeAnular && (<Button variant="destructive" ...>Anular</Button>)}</div> — grep por href com "entregas" só encontra links dentro da própria subárvore [id]/entregas`
- **Descrição**: Existe um fluxo completo de entregas (listagem, nueva-entrega-form, entrega-actions) mas a página de detalhe da venta só oferece o botão Anular — nenhum link leva a /ventas/[id]/entregas. A funcionalidade está pronta e invisível: só é alcançável digitando a URL. Sintoma do problema maior: record views não têm subtabs de registros relacionados.
- **Recomendação**: Adicionar botão/aba "Entregas" no header da VentaDetailView (e contador de entregas pendentes). Padronizar record view com tabs: Resumen / Ítems / Entregas / Asiento.

### [ALTA] Inputs monetários sem máscara e exigem ponto decimal (formato en-US) numa UI es-AR
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:76
- **Evidência**: `const moneyRegex = /^\d+(\.\d{1,2})?$/; ... die: z.string().regex(moneyRegex, "Inválido"), — exibição usa toLocaleString("es-AR") mas a digitação exige "1234.56"`
- **Descrição**: Todos os valores monetários são Input de texto cru validado por regex que só aceita ponto decimal e sem separador de milhar. O usuário argentino digita "1.234,56" e recebe "Inválido" (mensagem que não explica o formato esperado). A própria UI mostra valores formatados es-AR (vírgula decimal), criando dissonância entre o que se lê e o que se deve digitar. Em tributos de embarque com 7 campos isso gera erro repetido.
- **Recomendação**: Componente MoneyInput único: aceitar vírgula ou ponto (normalizar no onChange), formatar milhares ao blur, alinhar à direita, e mensagens de erro explícitas ("use formato 1234,56").

### [ALTA] Botões de data 'Hoy' usam UTC: após as 21h na Argentina selecionam o dia seguinte
- **Arquivo**: src/components/date-range-filter.tsx:10
- **Evidência**: `function todayIso(): string { return new Date().toISOString().slice(0, 10); } — ART é UTC-3: às 22:00 locais toISOString() já devolve a data de amanhã`
- **Descrição**: todayIso() baseado em toISOString() aparece no DateRangeFilter e é duplicado em libro-mayor/page.tsx:53, bi/page.tsx:52 e asientos/page.tsx:39 como default de filtros. Trabalhando à noite (cenário comum), o filtro "Hoy" e o default "hasta" apontam para amanhã — reportes parecem incluir/excluir lançamentos errados e o usuário não entende por quê.
- **Recomendação**: Centralizar um helper todayIsoAr() com timezone America/Argentina/Buenos_Aires (Intl.DateTimeFormat ou date-fns-tz) e substituir as 4+ cópias locais de todayIso/firstOfMonthIso.

### [ALTA] Listagem de Ventas sem busca nem filtros de cliente/data/estado; cada listagem inventa seu padrão
- **Arquivo**: src/app/(dashboard)/ventas/page.tsx:13
- **Evidência**: `type SearchParams = Promise<{ page?: string; perPage?: string; incluirCanceladas?: string; }>; — único filtro é o toggle de canceladas`
- **Descrição**: Para achar uma venda específica é preciso paginar de 50 em 50. Em contraste, asientos tem q+estado+datas, embarques tem tabs+moneda, produtos tem busca client-side: quatro telas, quatro padrões de filtragem distintos, nenhum reutilizável. Não existe um "filter bar" padrão do design system, o que explica a divergência e o custo de adicionar filtros novos.
- **Recomendação**: Criar FilterBar padrão (busca por texto + selects + date range, tudo via searchParams) e aplicá-lo a ventas (cliente, estado, datas, nº) e demais listagens, unificando o padrão de embarques/asientos.

### [MEDIA] Dark mode morto: next-themes instalado mas sem ThemeProvider — classes dark: nunca ativam
- **Arquivo**: src/app/layout.tsx:32
- **Evidência**: `<html lang="es" className={cn("font-sans", figtree.variable)}> — sem ThemeProvider nem suppressHydrationWarning; globals.css:111 define .dark e centenas de dark: espalhadas (money-amount, kpi-card) são código morto`
- **Descrição**: O CSS de dark mode está completo (@custom-variant dark, paleta .dark) e os componentes carregam variantes dark:, mas nada injeta a classe .dark: não há ThemeProvider no root nem toggle de tema em perfil/user-menu. Pior: sonner.tsx usa useTheme() sem provider, defaultando a "system" — em máquinas com SO escuro os toasts renderizam escuros sobre um app claro.
- **Recomendação**: Decidir: ou adicionar ThemeProvider (attribute="class") + toggle no user-menu, ou remover as classes dark: e fixar theme="light" no Toaster para eliminar a inconsistência.

### [MEDIA] Sidebar plana + hub pages de cards adicionam um clique e escondem subáreas (Tesorería tem 10)
- **Arquivo**: src/components/layout/nav-items.ts:28
- **Evidência**: `export const NAV_GROUPS = [...] — 13 itens de nível único; contabilidad/page.tsx:53: <p className="text-sm text-muted-foreground">Seleccioná una sección.</p> (hub de cards)`
- **Descrição**: A sidebar só tem 1 nível: clicar em Tesorería leva a um hub com cards para 10+ subáreas (cuentas, CxP, CxC, movimientos, extractos, préstamos, saldos-proveedores...), invisíveis até carregar a página. Comex, Contabilidad e Maestros seguem o mesmo padrão. Toda navegação cruzada exige voltar ao hub. NetSuite resolve com submenus expansíveis/flyout no hover do módulo.
- **Recomendação**: Adicionar subitens colapsáveis na sidebar (SidebarMenuSub do shadcn) para os módulos com hubs, mantendo o hub como página de overview; ou flyout no modo ícone.

### [MEDIA] Breadcrumb automático com dicionário hardcoded incompleto; IDs viram 'Detalle' genérico
- **Arquivo**: src/components/layout/app-header.tsx:68
- **Evidência**: `if (looksLikeId(seg)) { crumbs.push({ label: "Detalle" }); continue; } — SEGMENT_LABELS não cobre simulaciones, contenedores, pagos-historial, mover-periodo, oportunidades, leads, actividades, despachos, entregas...`
- **Descrição**: O breadcrumb do header deriva do pathname com um Record fixo de 27 labels; qualquer segmento fora do mapa renderiza o slug cru em minúsculas ("Comex > simulaciones", "Contabilidad > Asientos > mover-periodo"). Páginas de detalhe mostram "Detalle" em vez do identificador do registro (venta nº, código do embarque), então duas abas abertas são indistinguíveis. Existe ainda um segundo componente Breadcrumb manual (layout/breadcrumb.tsx) duplicando o padrão.
- **Recomendação**: Permitir que páginas registrem o último crumb (ex.: via slot/context ou route segment config) com o identificador real do registro, e gerar labels com fallback capitalizado em vez de slug cru.

### [MEDIA] Record views sem audit trail e sem registros relacionados em subtabs
- **Arquivo**: src/app/(dashboard)/ventas/_components/venta-detail-view.tsx:128
- **Evidência**: `<Field label="Fecha">...<Field label="Vencimiento">...<Field label="Tipo de cambio">...<Field label="Asiento contable"> — nenhum campo de criado por/em, sem histórico de mudanças de estado`
- **Descrição**: O detalhe de venta (e de asiento) não mostra quem criou/emitiu/anulou nem quando — o diálogo de anulação até promete "se mantiene para auditoría", mas nada de auditoria é visível na UI. Não há timeline de estados (BORRADOR→EMITIDA→CANCELADA) nem links a documentos relacionados além do nº do asiento. Em ERP profissional, audit trail visível (System Notes no NetSuite) é requisito de confiança contábil.
- **Recomendação**: Exibir bloco "Auditoría" (creado/emitido/anulado por+fecha) nos record views e, se o schema não captura usuário, adicionar campos creadoPorId/emitidoEl aos documentos principais.

### [MEDIA] KPIs do dashboard não são acionáveis: sem drill-down nem personalização
- **Arquivo**: src/app/(dashboard)/dashboard/_components/kpi-card.tsx:46
- **Evidência**: `<Card size="sm" className={cn("gap-1.5 border-l-[3px] py-2.5 transition-shadow hover:shadow-md", ...)}> — hover:shadow sugere clique, mas não há Link/onClick`
- **Descrição**: Os 4 KPIs principais (Saldo Bancos+Caja, Total Pasivo, Resultado, Asientos) e os 4 stats secundários são estáticos: "Total Pasivo" não leva ao balance, "Embarques activos" não leva à lista filtrada. O hover:shadow-md ainda sinaliza affordance de clique que não existe. O dashboard tampouco é configurável por usuário (ordem/visibilidade de cards). Só o card de Alertas tem links ("Ver →").
- **Recomendação**: Envolver cada KpiCard/SecondaryStat em Link para a tela correspondente já filtrada (ex.: Pasivo → balance, Embarques activos → /comex/embarques?tab=transito) ou remover o hover effect.

### [MEDIA] Badges de estado sem semântica de cor: 6 estados intermediários de embarque são visualmente idênticos
- **Arquivo**: src/app/(dashboard)/comex/embarques/embarques-table.tsx:29
- **Evidência**: `function estadoVariant(estado: EmbarqueEstado): "default" | "outline" | "secondary" { switch (estado) { case "BORRADOR": return "outline"; case "CERRADO": return "default"; default: return "secondary"; } }`
- **Descrição**: badge.tsx não tem variantes success/warning/info — só default(primary)/secondary/destructive/outline. Resultado: EN_TRANSITO, EN_PUERTO, EN_ZONA_PRIMARIA, EN_ADUANA, DESPACHADO e EN_DEPOSITO aparecem todos com o mesmo badge cinza, e em ventas EMITIDA usa a cor primária (que não comunica "ok"). Para o ciclo aduaneiro — o coração do negócio — o usuário não distingue estágios à primeira vista.
- **Recomendação**: Adicionar variantes semânticas ao badge (success=emerald, warning=amber, info=indigo, coerentes com KpiCard) e mapear cada estado do ciclo a uma cor própria, consistente em todas as telas.

### [MEDIA] Error boundary só existe no Comex; os outros módulos caem na tela de erro crua do Next
- **Arquivo**: src/app/(dashboard)/comex/error.tsx:1
- **Evidência**: `find src/app/(dashboard) -name error.tsx → único resultado: comex/error.tsx (vs 47 loading.tsx)`
- **Descrição**: A cobertura de loading states é exemplar (47 loading.tsx + PageSkeleton + Suspense granular no dashboard), mas o tratamento de erro não acompanha: uma exceção de Prisma/serviço em ventas, contabilidad, reportes ou tesorería derruba para o error genérico do App Router, sem mensagem em espanhol nem botão de retry. Estados de loading/empty/error não formam um trio padronizado.
- **Recomendação**: Criar um error.tsx padrão em (dashboard)/ (mensagem es-AR + botão Reintentar via reset()) e replicar nos módulos críticos, espelhando o de comex.

### [MEDIA] Labels sem htmlFor nos campos com Controller — metade dos campos do embarque-form sem associação programática
- **Arquivo**: src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx:661
- **Evidência**: `<Label>Proveedor</Label> <Controller control={control} name="proveedorId" render={({ field }) => (<ProveedorCombobox ... — no arquivo: 29 <Label vs 14 htmlFor`
- **Descrição**: Campos renderizados via Controller (comboboxes, selects, date pickers) recebem <Label> sem htmlFor nem id no control: leitores de tela não anunciam o rótulo e clicar no label não foca o campo. O padrão se repete em venta-form e compra-form. Combinado com erros só visuais (FieldError sem aria-describedby), a acessibilidade dos forms fica abaixo do mínimo WCAG para software de trabalho diário.
- **Recomendação**: Padronizar id+htmlFor (ou aria-label no trigger dos comboboxes) e ligar FieldError via aria-describedby; considerar o wrapper Field/FormField do shadcn que faz isso automaticamente.

### [MEDIA] User menu sem link para 'Mi perfil' — preferências só acessíveis por URL direta ou pelo banner retroativo
- **Arquivo**: src/components/layout/user-menu.tsx:78
- **Evidência**: `<DropdownMenuSeparator /> <form action={logout}> <DropdownMenuItem ...>Cerrar sesión</DropdownMenuItem> </form> — único item do menu`
- **Descrição**: Existe /perfil com preferências reais (moneda preferida USD/ARS dos reportes, modo retroactivo de datas), mas o dropdown do usuário no rodapé da sidebar só oferece "Cerrar sesión". O caminho de descoberta do modo retroactivo é circular: o banner só aparece quando o modo já está ativo. Usuário comum nunca encontra a página.
- **Recomendação**: Adicionar item "Mi perfil" (e futuro "Tema") no DropdownMenuContent do user-menu, antes do separator de logout.

### [MEDIA] Produtos: ~1053 linhas renderizadas no DOM de uma vez, busca apenas client-side
- **Arquivo**: src/app/(dashboard)/maestros/productos/page.tsx:9
- **Evidência**: `const productos = await listarProductos(); — sem searchParams/take; productos-table.tsx filtra com useMemo e renderiza todos os filtered no DataTable`
- **Descrição**: Após a importação da lista FOB o catálogo passou de 9 para ~1053 produtos, mas a tela continua carregando e renderizando tudo: payload RSC grande e centenas de TableRow no DOM (cada uma com dropdown de ações), degradando scroll e interação. A busca/filtro de marca client-side é boa UX, mas não escala com o catálogo crescendo.
- **Recomendação**: Paginação server-side com busca via searchParams (padrão de ventas/embarques) ou, mantendo client-side, virtualização (@tanstack/react-virtual) e paginação local.

### [BAIXA] Atalho Cmd+S implementado em 5 forms mas ausente no embarque-form; nenhum atalho global além do sidebar toggle
- **Arquivo**: src/app/(dashboard)/ventas/_components/venta-form.tsx:582
- **Evidência**: `useCmdShortcut("s", () => submitGuardar(), !isPending); — usado em venta/compra/pedido-venta/pedido-compra/gasto-form; 0 ocorrências em embarque-form.tsx`
- **Descrição**: O hook useCmdShortcut (Cmd/Ctrl+S salvar) existe e funciona nos forms de venta, compra, pedidos e gastos, mas justamente o form mais longo (embarque) não o usa. Fora isso só existe Cmd+B do sidebar (shadcn). Não há tabela de atalhos, navegação J/K em listas nem tecla de novo registro — e nada é descoberto, pois nenhum tooltip/menu exibe os atalhos.
- **Recomendação**: Aplicar useCmdShortcut ao embarque-form e exibir os atalhos existentes (tooltip no botão Guardar, futura palette Cmd+K com lista de shortcuts).

### [BAIXA] Headers de página inconsistentes: PageHeader existe mas a maioria das telas re-implementa o padrão à mão
- **Arquivo**: src/app/(dashboard)/ventas/page.tsx:36
- **Evidência**: `<h1 className="text-[15px] font-semibold tracking-tight">Ventas</h1> <p className="text-sm text-muted-foreground"> — vs PageHeader: description text-xs + border-b pb-2 (page-header.tsx:23-26)`
- **Descrição**: PageHeader (título 15px + descrição xs + slot de ações + borda inferior) é usado em dashboard, bi e perfil, mas ventas, asientos, embarques, libro-mayor e produtos duplicam o markup manualmente com variações (descrição text-sm vs text-xs, com/sem border-b). Também marca a fraqueza tipográfica geral: h1 de 15px quase não se distingue do corpo, achatando a hierarquia visual.
- **Recomendação**: Migrar todas as páginas para PageHeader (que já tem slot actions para os botões "Nueva venta" etc.) e reavaliar a escala tipográfica (h1 ≥ 18px) no redesign.

### [BAIXA] Empty states sem call-to-action nem ilustração
- **Arquivo**: src/components/ui/data-table.tsx:52
- **Evidência**: `{isFiltered ? filteredMsg : emptyMessage} — célula colSpan com texto puro; ventas-table.tsx:115: "No hay ventas registradas todavía."`
- **Descrição**: Os empty states são uma linha de texto muted centrada. Não orientam a próxima ação ("Crear primera venta"), não distinguem visualmente "sem dados" de "filtro sem resultados" além do texto, e não há componente EmptyState padronizado com ícone+CTA. Em onboarding de módulos novos (CRM, simulaciones) a tela fica morta.
- **Recomendação**: Componente EmptyState (ícone + título + descrição + botão de ação primária) plugável no DataTable, com variante para filtros ("Limpiar filtros").


---

## 15. Proposta de redesign — UI/UX estilo NetSuite

Mapeada à stack real: Next.js App Router + shadcn/ui + Tailwind + `@tanstack/react-table@8.21.3` + `cmdk@1.1.1` + `next-themes@0.4.6` + `recharts@3.8.1` (todos já em `package.json`). Única dependência nova proposta: **`nuqs`** (estado de filtros na URL) e opcionalmente **`@tanstack/react-virtual`** (produtos com ~1053 linhas).

---

## 0. Relação com a spec prévia do vault ("Refatoração de UX/UI e Relatórios")

A spec do Obsidian é **válida porém de altitude menor** — ela ataca bugs de formulário e cosmética de relatórios, não a arquitetura de informação. Veredito por seção:

| Seção da spec | Veredito | Como entra nesta proposta |
|---|---|---|
| 1. Comex custos: fim dos pulos + cards por categoria com `border-l-4` ("palitos") | **Incorporar como está** — o bug de remontagem do `useFieldArray` já está diagnosticado na memória do projeto (FacturaCard remonta a cada setValue). Os "palitos de cores" viram **token de design system** (`--status-*`), não cor ad-hoc por tela | Fase 1 (quick win) + §6 tokens |
| 2. Tesorería redirect pós-pagamento + extrato com saldo acumulado | **Incorporar** — o extrato vira o padrão de "listagem financeira" (saída vermelha/entrada verde/saldo na linha) | Fase 1 |
| 3. Categoria de proveedor → sugestão de conta contábil | **Incorporar** — além disso alimenta o auto-fill do embarque-form (que já existe por proveedor) | Fase 2 |
| 4. Relatórios com hierarquia do plano de contas, `font-mono`, alinhamento à direita | **Incorporar com correção**: usar `font-variant-numeric: tabular-nums` (token `font-feature-settings: "tnum"`) em vez de `font-mono` puro — números tabulares com a fonte da UI é o que o NetSuite faz; `font-mono` destoa | §6 + Fase 3 |
| 5. Dashboard "Premium Dark" com PieChart | **Substituir** pelo modelo de **portlets NetSuite** (§2): a spec propõe um dashboard mais bonito porém ainda estático; NetSuite exige *Reminders clicáveis* e personalização. E "Premium Dark" é impossível hoje: `next-themes` está instalado mas **não há `ThemeProvider`** em `src/app/layout.tsx` — pré-requisito da Fase 1 |
| Critérios de aceite | Mantidos e ampliados pelos critérios das fases abaixo | — |

**Lacunas da spec que esta proposta cobre:** busca global, navegação (sidebar plana de 13 itens + hub pages), tabelas (saved views/export/inline edit/paginação), record pages com subtabs, audit trail (o model `AuditLog` **já existe** em `prisma/schema.prisma:1817` com `tabla`/`registroId`/`datosAnteriores`/`datosNuevos` e nunca é exibido), trilha de transações encadeadas.

---

## 1. Shell — topbar NetSuite + tabs por "Center"

### Decisão: substituir sidebar por tabs horizontais com mega-menu (estilo Centers), mantendo a sidebar como fallback opcional por 1 release

Justificativa contra manter sidebar: o problema real não é sidebar vs tabs, é que a navegação atual tem **1 nível** (`nav-items.ts` tem 13 itens flat em 4 grupos) e empurra a profundidade para hub pages de cards (`/comex/page.tsx`, `/tesoreria/page.tsx` — Tesorería tem 10 subáreas: `cuentas, cuentas-a-cobrar, cuentas-a-pagar, extracto, extractos, movimientos, pagos-historial, prestamos, saldos-proveedores, transferencias`). Mega-menu elimina o clique do hub e expõe as subáreas no hover — exatamente o padrão NetSuite. A sidebar colapsável atual vira redundante; remover libera ~3rem de largura útil para tabelas densas.

### 1.1 Estrutura de navegação (novo `nav-items.ts`)

Reorganizar em **7 centers** com 2 níveis (`NavCenter → seções → links`), derivado das rotas reais de `src/app/(dashboard)/`:

```
Home      → /dashboard, /bi, /perfil
Comex     → embarques, contenedores, despachos, proveedores (exterior), simulaciones
Ventas    → ventas, pedidos, entregas*, clientes (CRM), cuentas-a-cobrar
Compras   → compras, gastos, gastos-fijos, proveedores, cuentas-a-pagar
Inventario→ inventario (stock dual físico/aduaneiro), depósitos, productos
Finanzas  → tesoreria (cuentas, movimientos, transferencias, prestamos, extractos),
            contabilidad (asientos, periodos), saldos-proveedores
Reportes  → balance-general, estado-resultados, flujo-caja, libro-diario, libro-mayor, bi
```
\* resolve a rota órfã `/ventas/[id]/entregas` dando-lhe um ponto de entrada. Nota: `cuentas-a-pagar/cobrar` aparecem em dois centers de propósito — NetSuite duplica links entre centers por papel.

**Arquivos:**
- `src/components/layout/nav-items.ts` — novo tipo `NavCenter { label, href, sections: { label, items: NavItem[] }[] }`.
- **Novo** `src/components/layout/app-topnav.tsx` — tabs horizontais (usar `tabs.tsx`/`dropdown-menu.tsx` existentes; mega-menu = `Popover` com grid 2–3 colunas de seções). Tab ativa por `pathname.startsWith(center.href)`.
- `src/components/layout/app-header.tsx` — vira a **topbar única** (logo + tabs + busca + "+" + notificações + user-menu); breadcrumb desce para a linha do `page-header.tsx`. Altura sobe de 44px para ~48px topbar + 36px de tab-row (padrão NetSuite de 2 linhas).
- `src/app/(dashboard)/layout.tsx` — remove `SidebarProvider/AppSidebar/SidebarInset`, `main` passa a `max-w-none px-4`.
- Hub pages (`comex/page.tsx`, `tesoreria/page.tsx`, `contabilidad/page.tsx`) **não morrem**: viram dashboards de center (mini-portlets + atalhos), como as "center overview pages" do NetSuite — mas deixam de ser passagem obrigatória.

### 1.2 Busca global (cmdk — já instalado, `src/components/ui/command.tsx` já existe)

**Novo** `src/components/layout/global-search.tsx` + server action `src/lib/actions/global-search.ts`:
- Atalho `⌘K` / `Ctrl+K` + campo visível na topbar (NetSuite tem o campo sempre visível, não só modal).
- Grupos de resultado: **Páginas** (estático, do nav-items), **Registros** (queries `contains` em paralelo: Cliente.nombre, Proveedor.nombre, Producto.codigo/descripcion, Embarque.codigo, Venta.numero, AsientoContable.numero), **Ações** ("Nueva venta", "Nuevo embarque", "Registrar pago").
- Prefixos estilo NetSuite: `em:` busca só embarques, `cl:` clientes, `as:` asientos — trivial de implementar roteando o prefixo para uma query só.
- Debounce 200ms, server action retorna no máx. 5 por grupo com `href` direto ao record.

### 1.3 Criação rápida "+" e notificações

- **Novo** `quick-create-menu.tsx`: dropdown "+" na topbar com as ~8 criações (`/ventas/nueva`, `/comex/embarques/nuevo`, `/compras/nueva`, asiento manual, movimiento, transferencia, gasto, cliente). 1 clique de qualquer tela.
- **Novo** `notification-center.tsx` (Popover + badge de contagem): reusa a MESMA query do card de alertas do dashboard atual (embarques sin cerrar costos, cuentas a pagar vencidas, períodos abertos, préstamos com cuota próxima). Server component passado como prop ao header. É o "Reminders" do NetSuite em versão topbar.

---

## 2. Home dashboard — portlets configuráveis

Refatorar `dashboard/page.tsx` de layout fixo para **grade de portlets**:

- **Novo** `src/components/dashboard/portlet.tsx` — casca padrão: título, ações (refresh, configurar, remover), `Suspense` + skeleton próprio (os 47 `loading.tsx` já dão o padrão de skeleton).
- **Catálogo de portlets** (cada um já tem a query pronta no dashboard atual): `RemindersPortlet` (contagens **clicáveis** — "3 embarques sin cerrar costos" → `/comex/embarques?estado=EN_ZONA_PRIMARIA&costos=abiertos`), `KpiPortlet` (valor + Δ% vs período anterior + seta de tendência; **clicável** para a listagem filtrada — hoje nenhum KPI navega), `ChartPortlet` (ingresos/egresos 6m existente + rosca de composição de despesas da spec do vault), `ShortcutsPortlet`, `RecentRecordsPortlet` (últimos asientos / embarques recientes existentes), `SaldosBancariosPortlet`.
- **Persistência da configuração:** campo `dashboardConfig Json?` no model `User` (`prisma/schema.prisma`) — ordem, quais portlets, período dos KPIs. Edição: modo "Personalizar" com drag simples (CSS order + botões mover, sem lib de DnD na v1).
- **Por papel:** `session.user.role` já chega no layout — default de portlets por role (admin vê contábil; operação vê embarques/stock) com override do usuário.

---

## 3. Listagens — padrão "saved search" NetSuite

Hoje `src/components/ui/data-table.tsx` é render-only (`getCoreRowModel` em 100% dos usos) e `pagination.tsx`/`pagination-params.ts` são usados em 3 de 89 páginas. Criar **uma** infraestrutura e migrar listagem a listagem:

### 3.1 Novo `src/components/ui/data-table-advanced/` (pasta)

- `data-table-toolbar.tsx` — busca textual, filtros facetados (estado/cliente/data — reusar `date-range-filter.tsx`, `cliente-combobox.tsx`, `proveedor-combobox.tsx` existentes), seletor de view salva, botão colunas, botão export. **Contagem total sempre visível** ("1.053 productos · mostrando 25").
- **Filtros na URL** via `nuqs` (`useQueryStates`): URL compartilhável = pré-requisito de saved views e do drill-down dos KPIs (§2). Server components leem `searchParams` e montam o `where` Prisma.
- **Saved views**: model novo `SavedView { id, userId, route, nombre, params Json, isDefault }`. Salvar = serializar os search params atuais. Dropdown de views no toolbar. É a feature NetSuite de maior impacto/custo aqui — params na URL tornam isso quase grátis.
- **Ordenação server-side**: header clicável escreve `?sort=fecha&dir=desc`; helper `parseSort()` em `pagination-params.ts` → `orderBy` Prisma.
- **Colunas configuráveis**: `columnVisibility` do TanStack + persistência em `localStorage` por rota (v1) / em SavedView (v2).
- **Export CSV/XLSX**: route handler genérico `src/app/api/export/route.ts` que recebe `route + params`, reexecuta a query da listagem **sem take** e streama CSV (XLSX depois, via exceljs). Cobre também os reportes contábeis.
- **Seleção em massa**: coluna checkbox + action bar flutuante ("3 seleccionados · Contabilizar | Exportar | Anular") — começar onde há ação em lote real: movimientos (conciliar), cuentas-a-pagar (pagar em lote), asientos BORRADOR (contabilizar).
- **Inline edit**: restringir a campos seguros sem efeito contábil (notas, fecha estimada de arribo, referencias). Célula vira input on-click, salva por server action com lock otimista por `updatedAt` (padrão já usado no projeto). **Não** fazer inline edit em valores monetários contabilizados.

### 3.2 Prioridade de migração (pelas dores reais)

1. `/contabilidad` (asientos) — **bug ativo**: `findMany` sem `take`. Paginação server-side + filtros período/cuenta/estado. 
2. `/maestros/productos` — 1053 linhas no DOM → paginação ou react-virtual + busca por código/descripción.
3. `/ventas` — hoje sem busca nem filtro algum: cliente/data/estado + saved views.
4. `/comex/embarques` — já tem `embarques-filters.tsx`/`embarques-tabs.tsx`; migrar para o padrão único e aposentar a variante própria.
5. Tesorería (movimientos, cuentas-a-pagar/cobrar) — herdam seleção em massa.

---

## 4. Record pages — padrão único de detalhe

**Novo** `src/components/layout/record-shell.tsx`, usado por embarque, venta, compra, asiento, cliente, proveedor, producto:

```
[RecordHeader]  Tipo · Código grande · <StatusBadge/> 
                [← anterior | siguiente →]   [Editar] [⋮ acciones] [Botón primario contextual]
[RecordTabs]    Resumen | <relacionados...> | Auditoría
[Body]          field groups em grid 3-col, label em cima, valores com tabular-nums
```

- **Botão primário contextual = transição de estado**: derivado da máquina de estados real (`EmbarqueEstado` em `prisma/schema.prisma:76-85`: `BORRADOR→EN_TRANSITO→EN_PUERTO→EN_ZONA_PRIMARIA→EN_ADUANA→DESPACHADO→EN_DEPOSITO→CERRADO`). Map `estado → { label: "Avanzar a Zona Primaria", action }` por tipo de record. Ações destrutivas/reversas ficam no menu "⋮" (e cobre o gap "revertir estado" anotado no piloto).
- **Subtabs por registros relacionados** (rotas paralelas não são necessárias; tabs client-side com dados já carregados pelo `include` ou `Suspense` por tab):
  - **Embarque** (`comex/embarques/[id]/page.tsx`, hoje uma página única + subrota `despachos/`): `Resumen | Facturas | Contenedores | Costos | Despachos | Asientos | Auditoría`.
  - **Venta**: `Resumen | Items | Entregas | Cobros | Asientos | Auditoría` — a tab Entregas **resolve a rota órfã** `/ventas/[id]/entregas`.
  - **Cliente/Proveedor**: `Resumen | Transacciones | Saldos | Auditoría`.
- **Tab Auditoría = system notes do NetSuite**: componente **novo** `audit-trail.tsx` lendo `AuditLog` por `(tabla, registroId)` (índice já existe: `@@index([tabla, registroId])` em `schema.prisma`). Render: tabela compacta fecha/usuario/acción + diff campo-a-campo de `datosAnteriores` vs `datosNuevos`. Custo baixo, valor altíssimo para contabilidade.
- **Breadcrumb**: `record-shell` injeta o código real do registro num contexto que `app-header.tsx` consome — mata o "Detalle" genérico (`app-header.tsx:69`) e o dicionário hardcoded incompleto (`SEGMENT_LABELS`, linhas 14–41) vira fallback.

---

## 5. Transações encadeadas — trilha "criado a partir de / gerou"

NetSuite mostra "Created From" no header e links bidirecionais. Aqui as FKs já existem (despacho→embarque, asiento→origem via `tabla/registroId`-like, movimiento→cuenta a pagar, entrega→venta):

- **Novo** `src/components/layout/related-records-strip.tsx`: linha logo abaixo do RecordHeader com chips navegáveis — ex. no Despacho: `← Embarque 036CN` · `Generó: Asiento N° 412 · Movimiento de stock`. No Asiento: chip de volta para origem (embarque/venta/pago).
- **Novo** `src/lib/services/record-links.ts`: resolver central `getLinksFor(tipo, id)` → `{ origem: Link[], gerados: Link[] }` com um switch por tipo consultando as FKs reais. Centralizar evita que cada record page invente sua query.
- Fluxos a cobrir na v1: `pedido → venta → entrega → cobro → asiento` e `embarque → despacho → asiento(s) → cuenta a pagar → pago`.

---

## 6. Design system — tokens, densidade, dark mode

### 6.1 Tokens de status (resolve "6 estados de embarque visualmente idênticos" + os "palitos" da spec)

**Novo** `src/lib/status-colors.ts` + variáveis em `globals.css`:

```
--status-draft (zinc) · --status-progress (blue) · --status-attention (amber)
--status-blocked (rose) · --status-success (emerald) · --status-final (slate, sólido)
```

Map semântico único: `BORRADOR→draft`, `EN_TRANSITO/EN_PUERTO→progress`, `EN_ZONA_PRIMARIA/EN_ADUANA→attention`, `DESPACHADO/EN_DEPOSITO→success`, `CERRADO/CONTABILIZADO→final`, `ANULADO→blocked`. **Novo** `status-badge.tsx` (variant por token + ponto colorido + label) substitui todos os badges ad-hoc. Os mesmos tokens alimentam `border-l-4` dos cards de custos do Comex (spec §1) e os palitos dos KPIs (spec §5) — uma paleta, três usos.

### 6.2 Densidade e números

- Densidade compacta de ERP: row-height de tabela 32px (`table.tsx`: `py-1.5`), `text-[13px]` (já é o tamanho da sidebar — padronizar).
- Números: classe utilitária `.num` = `text-right tabular-nums` aplicada por `money-amount.tsx` (componente já existe — concentrar ali) e nos relatórios (atende spec §4 sem `font-mono`).
- **Máscara monetária es-AR**: novo `money-input.tsx` (Intl.NumberFormat `es-AR`, aceita vírgula decimal, normaliza para `Decimal` no submit) substitui os inputs com regex de ponto. Junto: corrigir botões "Hoy" para `America/Argentina/Buenos_Aires` em `date-picker.tsx`.

### 6.3 Dark mode (hoje morto)

`src/app/layout.tsx`: envolver com `<ThemeProvider attribute="class" defaultTheme="system">` (next-themes já instalado, classes `dark:` já escritas). Toggle no `user-menu.tsx`. Auditar `chart.tsx`/recharts (cores hardcoded) e a faixa `bg-amber-100` do modo retroactivo no `layout.tsx`.

### 6.4 Estados padrão

- `empty-state.tsx` novo (ícone + texto + CTA de criação) — usado por DataTable e portlets.
- `error.tsx` por área (hoje só `comex/error.tsx` existe): copiar o padrão para ventas, tesoreria, contabilidad, reportes, maestros — ou um `error.tsx` no root do `(dashboard)`.
- Forms: **dirty guard** genérico (`useFormDirtyGuard` — `beforeunload` + interceptar `router.push` do "Cancelar" com Dialog de confirmação) aplicado primeiro ao `embarque-form.tsx` (2215 linhas); autosave de rascunho fica para depois (estados BORRADOR já existem no domínio, dá para persistir draft real).

---

## 7. Roadmap

### Fase 1 — Quick wins (1–2 semanas)
| Item | Arquivos | Esforço |
|---|---|---|
| ThemeProvider + toggle dark mode | `src/app/layout.tsx`, `user-menu.tsx` | **S** |
| Command palette ⌘K (páginas + ações; records na fase 2) | novo `global-search.tsx`, usa `ui/command.tsx` | **S/M** |
| Status tokens + `status-badge.tsx` em embarques/asientos/despachos | novos `status-colors.ts`, `status-badge.tsx` | **S** |
| Paginação + take em asientos; busca em productos | `contabilidad/page.tsx`, `maestros/productos` | **S** |
| Dirty guard no embarque-form; redirect pós-pago (spec §2); "Hoy" timezone; `money-input.tsx` | `embarque-form.tsx`, action de pago, `date-picker.tsx` | **M** |
| Fix useFieldArray + cards coloridos de custos (spec §1) | `comex/embarques/_components` | **M** |

### Fase 2 — Estrutura de navegação e busca (2–3 semanas)
| Item | Arquivos | Esforço |
|---|---|---|
| Topnav por centers + mega-menu; hub pages viram overview | `nav-items.ts`, novo `app-topnav.tsx`, `app-header.tsx`, `(dashboard)/layout.tsx` | **L** |
| Busca global com records + prefixos | `global-search.ts` (action) | **M** |
| Quick create "+" e notification center | novos componentes na topbar | **M** |
| Categoria de proveedor + sugestão de conta (spec §3) | `schema.prisma`, maestros, form de cuentas a pagar | **M** |

### Fase 3 — Tabelas e relatórios (3–4 semanas)
| Item | Arquivos | Esforço |
|---|---|---|
| `data-table-advanced` (toolbar, sort server, colunas, contagem, nuqs) | novo `src/components/ui/data-table-advanced/` | **L** |
| Migração: asientos, ventas, embarques, movimientos, productos | páginas respectivas | **L** |
| Saved views (model `SavedView`) | `schema.prisma` + toolbar | **M** |
| Export CSV (listagens + reportes) | novo `api/export/route.ts` | **M** |
| Relatórios com hierarquia do plano de contas + tabular-nums (spec §4) | `reportes/*` | **M** |

### Fase 4 — Record pages e encadeamento (3–4 semanas)
| Item | Arquivos | Esforço |
|---|---|---|
| `record-shell.tsx` + subtabs no embarque (piloto) | novo shell + `comex/embarques/[id]/page.tsx` | **L** |
| Audit trail UI sobre `AuditLog` existente | novo `audit-trail.tsx` | **S/M** |
| Related-records strip + `record-links.ts` | novos | **M** |
| Rollout para venta (com tab Entregas), asiento, cliente, proveedor | páginas `[id]` | **L** |
| Breadcrumb com código real do registro | `app-header.tsx` + contexto | **S** |

### Fase 5 — Dashboard de portlets (2 semanas)
| Item | Arquivos | Esforço |
|---|---|---|
| Casca de portlet + extração dos blocos atuais | novo `src/components/dashboard/` | **M** |
| Reminders/KPIs clicáveis com drill-down (depende dos filtros-URL da fase 3) | dashboard + listagens | **M** |
| Config por usuário (`User.dashboardConfig`) + defaults por role | `schema.prisma`, `dashboard/page.tsx` | **M** |
| Seleção em massa + inline edit (campos seguros) | data-table-advanced | **M/L** |

**Ordem racional:** Fase 1 destrava percepção imediata; Fase 2 antes da 3 porque o drill-down e as saved views dependem de URL-state; Fase 4 depois da 3 porque as subtabs reusam o data-table; Fase 5 por último porque portlets clicáveis precisam de listagens filtráveis por URL para ter onde aterrissar.


---

## 16. Lacunas estruturais (crítica de completude)

1. **Schema sem histórico de migrations + script destrutivo de um comando** — não existe `prisma/migrations/` (só `prisma/migrations-manual/` com 1 SQL); o schema evolui por `db push` contra prod, e `package.json:18` define `"db:push:force": "prisma db push --force-reset"` — um keystroke com `DATABASE_URL` de prod apaga o banco inteiro, sem DDL revisável nem rollback reprodutível.

2. **Parser de extracto bancário é um LLM sem reconciliação aritmética** — `src/lib/services/extracto-parser.ts` manda o PDF ao modelo (`claude-sonnet-4-6`), extrai o JSON por regex (`extracto-parser.ts:110-116`) e modela montos como `z.number()` (float, violando a política decimal.js); `src/lib/actions/extractos-import.ts:299-300` persiste `saldoInicial/saldoFinal` direto sem validar `Σ(lineas) == saldoFinal − saldoInicial` — alucinação do modelo entra no ledger sem checagem.

3. **Cobertura de testes é ~100% Comex** — os 34 arquivos de `test/*.test.ts` cobrem só comex/divergencia/pago exterior/VEP; zero testes unitários/integração para ventas (CMV, entregas, reservas), asientos de venta/compra, CxC FIFO, reportes e fechamento de período — exatamente as dimensões onde a auditoria achou bugs críticos confirmados.

4. **"e2e" não exercita browser, UI nem auth** — os 5 specs de `e2e/*.spec.ts` chamam services direto contra Testcontainers ("NO necesitan browser ni el server Next levantado", `.github/workflows/ci.yml:130-133`); nenhum teste cobre login, o embarque-form de 2215 linhas, ou regressões visuais — os bugs de UI achados pelos auditores não têm rede de segurança.

5. **Zero observabilidade** — nenhum Sentry/logger estruturado no `src/` (grep vazio), apenas 94 `console.error` espalhados em `src/lib/actions` e `src/lib/services`; erros de produção na Vercel somem sem alerta, agregação nem trace — bugs como os de arredondamento são indetectáveis até alguém olhar o balance.

6. **Monitoramento de invariantes existe para stock, não para contabilidade** — `.github/workflows/validar-stock.yml` valida 6 invariantes diários contra prod (e abre issue ao falhar), mas nenhum job valida partida doble (Σdebe==Σhaber), saldos vs ledger ou mistura USD/ARS — a corrupção crítica de moeda achada pelos auditores rodaria meses sem disparar nada.

7. **~30 scripts ad-hoc de diag/fix em `prisma/` apontando para prod e duplicando lógica de serviço** — ex. `prisma/fix-recalcular-stock-actual.ts:5` admite "Replica exactamente la lógica de recalcularStockYCostoPromedio... no importable desde tsx" e carrega `.env.local` (prod) por default — drift entre cópia e serviço real significa que o script que "conserta" pode corromper com regra desatualizada.

8. **Evidencias de divergência em blobs públicos sem ciclo de vida** — `src/app/api/comex/divergencia/upload/route.ts:11-12,44,50`: blobs **públicos** com sufixo aleatório ("URL no adivinhable, no listable") para fotos/documentos comerciais, e `onUploadCompleted` é no-op — segurança por obscuridade + blobs órfãos permanentes se `registrarConferenciaAction` falhar após o upload.

9. **Action de import LLM sem rate-limit nem teto de custo** — `parsearExtractoPDF` (`extracto-parser.ts:119+`) chama a API Anthropic por request com PDFs de até N páginas; qualquer USER autenticado pode disparar gasto arbitrário de API (o auditor de CRM flagou isso no `crm-ai`, mas ninguém cobriu o caminho do extracto, que é o mais usado).

10. **Sem `middleware.ts`: proteção de sessão só no render do layout** — não existe middleware em `src/` nem na raiz; o guard é só `src/app/(dashboard)/layout.tsx:12` (`if (!session) redirect("/login")`) — navegação client-side entre páginas irmãs não re-executa o layout, e qualquer rota futura fora do grupo `(dashboard)` nasce sem guard central (agrava o achado de role-enforcement do auditor de segurança).

11. **i18n estrutural inexistente** — nenhuma lib de i18n no `package.json` e nenhum dicionário de strings; todos os textos são hardcoded em JSX — os ~37 achados de escrita-ui (pt/es misturados, voseo/usted, "Close") são sintomas de não haver camada estrutural, então cada PR novo reintroduz o problema.

12. **Índices parciais vivem fora do schema Prisma** — `prisma/add-partial-indexes-contenedor.ts` e `add-partial-indexes-despacho.ts` aplicam índices por script imperativo encadeado em `db:sync` (`package.json:25`); um `db push` direto de ambiente novo não os cria (e `db push` pode dropá-los), fazendo os ambientes divergirem silenciosamente do prod — agrava os achados de performance sobre índices ausentes.


---

## Roadmap consolidado (correções + otimizações + NetSuite)

A ordem combina risco contábil (estancar primeiro), fundação técnica e o redesign UI/UX. Esforços: S < 1 dia · M = 1-3 dias · L = 1-2 semanas.

### Onda 0 — Estancar o sangramento contábil (1 semana)
| Item | Arquivos | Esforço |
|---|---|---|
| Fix TC=`"1"` no extrato USD (exigir TC válido) | `extractos.ts:137` | S |
| **Decisão de convenção: ledger 100 % ARS** + espalhar `usdOrigen` nos 3 casos do switch + migração de asientos USD legados | `asiento-automatico.ts:763-925` + script | L |
| `monedaOrigen/montoOrigen` na línea DEBE do pago exterior | `pago-exterior.ts:277` | S |
| Replay de TRANSFERENCIA promediando custo | `stock.ts:913` | S |
| `revertirTransferenciaDespacho` → `recalcularStockYCostoPromedio` | `stock.ts:850` | S |
| D9: concluir/arquivar executa counters+stock+asiento de traslado; ubicación correta do ajuste | `divergencia-investigacion.ts:328,367` | M |
| Guards: entrega de venta ≠ EMITIDA; anulação genérica bloqueia asientos de venta/entrega/gasto fijo; compra exige BORRADOR; bloquear transferência com depósito ZPA | `entregas.ts`, `asientos.ts`, `compras.ts`, `transferencias.ts` | M |
| Saldos exterior: usar `movimiento.monto`/aplicaciones em vez de `debe` cru e de match por token | `cuentas-a-pagar.ts:1677,1696` | M |

### Onda 1 — Autorização, concorrência e fundação de dados (1-2 semanas)
| Item | Arquivos | Esforço |
|---|---|---|
| `requireRole(ADMIN)` em anular masivo, períodos, mover/cambiar fecha de asientos + guard na página /admin | actions + page | S |
| `auth()` em todas as actions mutadoras (helper padrão) + `middleware.ts` real | ~15 arquivos | M |
| Locks: `updateMany` condicional no VEP (pago duplo), emitir venta/compra, cerrarPeriodo em transação; lock otimista (updatedAt) em embarque/despacho/venta | vep-despacho, ventas, compras, periodos, embarques | M |
| Reserva/egreso de stock com update condicional (impede negativo) | `stock.ts`, `ventas.ts:786`, `entregas.ts` | M |
| **Adotar `prisma migrate`** (baseline do schema atual), remover `db:push:force`, trazer índices parciais para migrations | `prisma/` + `package.json` | M |
| Validação aritmética do parser de extracto (Σ líneas == saldoFinal − saldoInicial) + dedup contra movimentos manuais | `extracto-parser.ts`, `extractos.ts` | M |
| Job CI de invariantes contábeis (partida doble, moeda única por línea, 1.1.5.x ≥ 0) espelhando o validador de stock | `.github/workflows/` | M |

### Onda 2 — Arredondamento, reconciliação e correções altas restantes (2 semanas)
| Item | Esforço |
|---|---|
| Helper único de granularidade (round2 por unidade × true-up no último item) aplicado a: despacho legacy/cruzado, desconsolidación, cerrarCostos (sem round2 intermediário), VEP montoTotal, listarSimulaciones, Ley 25413 em Decimal | L |
| `validarInvariantePackingList` como gate do avanzar/arribo; reconciliação Σ FC×cant×TC vs débito 1.1.5.04 com sweep de resíduo | M |
| CMV numa base só (SPD do depósito reservado nas duas pontas) + bloqueio de emissão com costo 0 | M |
| Edição de embarque: preservar facturas com `despachoId`, somar EMITIDA no cifTotal, bloquear remoção de produto com packing list | M |
| Compra de mercadería → MovimientoStock + recalc (ou bloquear produto em compras) | M |
| Venta/compra desde pedido: percepción IIBB + IVA por alíquota real + transição/unique do pedido (anti dupla-faturação) | M |
| Fase 2 multi-contrapartida e intermediario; validação de préstamo USD em USD; FIFO Layer 4 com `pagadoFk`; anularEnTx desvincula GastoFijoRegistro | L |
| Numeração: max numérico em vez de count/ordenação lexicográfica (ventas, compras, gastos, despachos, transferencias) | S |

### Onda 3 — Performance (1-2 semanas, intercalável)
| Item | Esforço |
|---|---|
| Índices: `LineaAsiento(asientoId)`, `Venta(estado,fecha)`, `ItemEmbarque(embarqueId/productoId)`, `ItemVenta(ventaId/productoId)`, `MovimientoTesoreria(cuentaBancariaId,fecha)`, `Asiento(estado,fecha)` | S |
| CxP/aging com bounds + cache por request; compartilhar carga entre as 2 funções da página | M |
| Reportes/BI: groupBy SQL (date_trunc) em flujo, dashboard 6m, BI rankings; drill-down sob demanda no sumas y saldos | L |
| `unstable_cache` + `revalidateTag` para referências (cuentas, productos, depositos, provincias) | M |
| Paginação universal (asientos, movimientos, gastos, leads, productos) + take máximo + virtualização no DataTable | M |
| Snapshot/checkpoint de stock (replay só do delta); batch nos loops de ingresso (7 queries/item → 3 totais) | L |
| `<Suspense>` por seção em cuentas-a-pagar (12 fetches hoje bloqueiam tudo) | S |

### Onda 4 — Escrita e idioma (1 semana)
| Item | Esforço |
|---|---|
| Sweep pt→es: vendas→ventas, Cadastro→Registro, frete→flete, Lacre→Precinto, Conferencia→Verificación, Beneficiário→Beneficiario, Reverte→Revierte | S |
| Sweep en→es: Owner/Stage/Score→Responsable/Etapa/Puntaje, Default→Predeterminado, Close→Cerrar, Toggle Sidebar, template/override | S |
| Padronizar voseo (Agregá/Ingresá/Seleccioná) em validações e placeholders | M |
| `fmtMoney`/`fmtDate` em contabilidad (montos en-US) e nos client components com date-fns local (bug do dia anterior) | M |
| Unificar Débito/Crédito↔Entradas/Salidas nos extractos e Debe/Haber nos reportes; símbolo USD/ARS único via MoneyAmount | M |
| Catch-alls que vazam err.message do Prisma → fallback es | S |
| Glossário es-AR de termos (depósito/almacén, vincular, ítem) como referência de PR | S |

### Onda 5 — Vault Obsidian (2-3 dias)
| Item |
|---|
| Atualizar `plan-de-cuentas.md` (5 analíticas 1.1.5.x + tabela de diferencias de cambio 4.3.1/5.8.2 vs 4.5.1/5.5.3) |
| Reescrever `reglas-asientos.md` com os ~20 geradores (1 linha DEBE/HABER cada), marcando legacy |
| `importacion.md` + seção “Modelo Y (vigente)” espelhando `docs/fluxo-zona-primaria.md` (e atualizar os nomes 1.1.5.x no doc do repo) |
| Arquivar PRD v2 Flask com banner; STATE.md → snapshot substituível (mover histórico para 03-sessions); atualizar INDEX/CLAUDE.md (testes!) |
| Marcar supersedes cruzados (pago exterior 05-23 ↔ moneda funcional 05-26); deletar duplicado “ 1.md” e TERMINAL-TESTE.md |
| Criar workflows por módulo (ventas, stock dual, gastos) + glossário ZPA/DF/SPD/Modelo Y |

### Ondas 6-10 — Redesign UI/UX estilo NetSuite (detalhado na seção 9)
Fase 1 quick wins (ThemeProvider, ⌘K palette, status tokens, paginação asientos, dirty guard, MoneyInput es-AR, fix “Hoy” timezone) → Fase 2 topnav por centers + busca global de records + quick create + notificações → Fase 3 data-table-advanced (saved views, sort server, colunas, export CSV, nuqs) → Fase 4 record-shell (subtabs, audit trail sobre AuditLog, related-records, breadcrumb real) → Fase 5 dashboard de portlets clicáveis por papel.

### Transversais recomendados
- **Observabilidade:** Sentry (ou similar) + logger estruturado substituindo os 94 `console.error`; alertas para AsientoError e falhas de invariante.
- **Testes:** estender Vitest+Testcontainers para ventas/CMV/entregas, CxC/CxP FIFO, reportes e fechamento de período (onde estão os críticos confirmados); smoke E2E real de browser para login + forms gigantes.
- **Rate limit/custo de IA:** teto por usuário/dia nas actions de extracto-parser e crm-ai; delimitar dados de lead contra prompt injection.
- **Blobs:** tornar privados os uploads de divergencia (ou assinar URLs) e implementar `onUploadCompleted`/limpeza de órfãos.


---

## 17. Adendo (2026-06-11) — Análise dos commits pós-auditoria (PRs #190-#199)

> A auditoria rodou sobre o commit `376153d` (main de 29/05). Entre 09 e 11/06 main avançou com os PRs #190-#199 (+4.450/-484, 33 arquivos). Conclusões: **nenhum achado da auditoria foi resolvido** (retención RG 830 fecha parcialmente a lacuna ConceptoRG830); **13 achados novos** (1 alto: base da retención inclui IVA, divergindo da RG 830 art. 23); o balancete ARS/USD é só exibição (crítico nº 1 intacto) e **regrediu performance** (saldo inicial: groupBy → findMany do histórico completo), além de exibir linhas USD-cruas divididas por TC; o fix LEGACY_BUNDLED não resolveu os achados altos de facturas EMITIDA e trouxe 2 problemas médios próprios. O roadmap da seção anterior foi **substituído pelo Plano v2** (docs/plano-v2-2026-06-11.md), reorganizado pelas prioridades: simplificar processos, recriar workflows, completar pendências (entregas), corrigir erros, UI NetSuite.

# Retención RG 830 (#192-#198)

## Resumo
Os PRs #192-#196/#198 implementaram a retenção de Impuesto a las Ganancias (RG 830) no fluxo de pagamento da tesorería, atrás da flag RETENCION_GANANCIAS_ENABLED (default off). Há uma função pura de cálculo (mínimo não sujeito MENSAL acumulado por proveedor, alíquotas por concepto+condición INSCRIPTO/NO_INSCRIPTO, override por certificado de redução, monto fijo aplicado uma única vez ao cruzar o umbral) e uma camada de I/O que resolve proveedor 1:1 pela cuenta contábil, parâmetro fiscal vigente (tabela ParametroRetencion com vigência) e acumulado do mês via DEBEs TESORERIA, tudo dentro da transação do pago com pg_advisory_xact_lock por cuenta. O asiento gerado é DEBE proveedor (bruto) / HABER banco (neto) / HABER 2.1.3.07 RETENCIONES GANANCIAS A PAGAR; o MovimientoTesoreria grava o neto e nasce RetencionPracticada com snapshot, detalhe do cálculo, AuditLog e certificado RET-GAN-YYYY-NNNNNN, com PDF on-demand autenticado. Existe também retenção MANUAL (usuário digita o importe, qualquer proveedor, só PAGO ARS a um único proveedor), preview de simulação nos dois diálogos de pago, alerta "Retenciones por depositar (VEP)" com vencimento ARCA (+15 dias) em cuentas-a-pagar, avisos nos pagos batch e campos fiscais novos no cadastro de proveedor. A anulação do asiento de pago anula automaticamente a retenção PENDIENTE_ARCA, e há action de anulação restrita a ADMIN revalidado no banco. A base de cálculo adotada é o TOTAL da fatura (neto+IVA+IIBB), decisão de negócio documentada que diverge da RG 830 (base = neto sem IVA) — principal ressalva fiscal. Cobertura de testes boa: 21 unit da função pura + integração com Testcontainers (asiento, acumulado, flag off, anulação, roles) + testes do caminho manual.

## Implementações
- Função pura calcularRetencionGanancias (src/lib/services/retencion-ganancias.ts): cortocircuitos (no sujeto/EXENTO/MONOTRIBUTO/cert. exclusión vigente/sem concepto/sem parámetro), mínimo mensual acumulado, override de alíquota, ROUND_HALF_UP 2dp
- Camada I/O retencion-ganancias-pago.ts: resolução proveedor 1:1 por cuenta, parámetro vigente com tiebreak determinístico, acumulado mensual (Σ DEBE TESORERIA CONTABILIZADO no mês UTC), snapshot JSON congelado, registrarRetencionPracticada + AuditLog
- Integração em crearMovimientoTesoreriaAction: pg_advisory_xact_lock(cuentaId) anti-TOCTOU, asiento DEBE proveedor bruto / HABER banco neto / HABER 2.1.3.07, movimiento.monto = neto, tratamento P2002 da numeração
- Retenção MANUAL (construirRetencionManualParaPago + campo zod retencionGananciasManual): importe digitado, qualquer proveedor, só PAGO ARS a único proveedor identificável, alíquota implícita registrada
- Cuenta 2.1.3.07 RETENCIONES GANANCIAS A PAGAR no cuenta-registry + DIAS_VENCIMIENTO_RETENCION_ARCA=15
- Schema: enums CondicionGanancias/TipoRetencion/RetencionEstado, 5 campos fiscais no Proveedor, modelos ParametroRetencion (@@unique vigência) e RetencionPracticada (@unique certificado e movimiento); migração SQL aditiva + seed idempotente RG 830 (bienes 2%/10%, honorarios 6%/28% etc.)
- Actions: simularRetencionGananciasAction (preview), listarRetencionesPracticadas, anularRetencionGananciasAction (ADMIN revalidado contra DB, transição de estado + AuditLog)
- Certificado PDF on-demand (pdf-lib) em GET /api/retenciones/[id]/certificado com auth de sessão e Cache-Control no-store
- UI: preview automático + checkbox manual em pago-por-factura.tsx e movimiento-form.tsx (AsientoPreview de 3 linhas, saldo pendente do proveedor pós-bruto), alerta RetencionesPorDepositar com vencidas/próximas, avisos em embarque/saldos-batch-pago, card no detalhe do movimiento
- anularEnTx (asiento-automatico.ts:516-530) anula retenção PENDIENTE_ARCA junto com o asiento de pago (não toca PAGADA_ARCA)
- Feature flag isRetencionGananciasEnabled (features.ts:133) com pré-requisitos documentados; flag off = fluxo de pago intacto
- Testes: retencion-ganancias.test.ts (21 unit), test/retencion-ganancias-pago.test.ts (integração Testcontainers: asiento, acumulado em 2 pagos, flag off, COBRO, anulação, roles), test/retencion-ganancias-manual.test.ts

## Status dos achados da auditoria

- **[PARCIAL]** deducibleGanancias/ConceptoRG830 existem no schema sem nenhum fluxo de cálculo de retención
  - ConceptoRG830 agora alimenta um fluxo completo de retenção no pago (parâmetros, cálculo, asiento 2.1.3.07, certificado) — essa metade está resolvida. deducibleGanancias (NETO/TOTAL/NO_DEDUCIBLE do Gasto) segue persistido sem nenhum relatório de Ganancias que o consuma.
- **[NAO_AFETADO]** Fase 2 diferencia cambiaria não dispara em pago USD multi-contrapartida nem via intermediario
  - As mudanças em movimientos-tesoreria.ts são exclusivamente do ramo de retenção (ARS-only). O ramo multi-contrapartida (linhas 564-600) e pagarConIntermediarioAction (linhas 884-905) seguem usando crearAsientoManual sem calcularDiferenciaCambiariaPago e sem monedaOrigen/montoOrigen nas linhas de pasivo.
- **[NAO_AFETADO]** Validação prometida de appliedTo.montoArs == monto não existe no superRefine
  - O comentário em movimientos-tesoreria.ts:183 segue prometendo '(validado en superRefine)', mas o superRefine (linhas 228-282) só ganhou validações da retención manual (>0 e < total); a soma de appliedTo[].montoArs continua sem checagem contra linea.monto, em ambos os schemas.
- **[NAO_AFETADO]** gravarAplicacionesPago assume ordem das lineas DEBE por posição — frágil a linhas DEBE extras
  - A retenção adiciona apenas 2 linhas HABER (banco neto + 2.1.3.07) após as N DEBE das faturas, então o binding posicional não quebrou — o teste de integração confirma AplicacionPagoCompra = bruto. Porém o ramo novo (linha 542: 'Las N primeras líneas DEBE...') cria mais um caller dependente da convenção frágil, sem migrar para binding por id explícito.
- **[NAO_AFETADO]** Escrita: mistura voseo/usted e lusismos nas strings da UI
  - As strings novas da onda estão em voseo es-AR consistente e sem lusismos ('Reintentá el pago', 'pagalo por separado', 'Seleccioná', 'Depositá', 'generá el VEP', 'Inscripto/Monotributista'). O achado original permanece nas telas antigas não tocadas (ex.: 'Beneficiário/intermediário' continua em embarque-batch-pago/saldos-batch-pago).

## Novos achados

### [ALTA] Base da retenção = total da fatura COM IVA, divergindo da RG 830 (base = neto sem IVA)
- **Arquivo**: src/lib/services/retencion-ganancias.ts:10
- **Evidência**: `// Criterio de base (decisión del negocio): la base sujeta es el TOTAL de // la factura que se está pagando (neto + IVA + IIBB destacado), no el neto.`
- **Descrição**: A RG 830 (art. 23) exclui o IVA discriminado da base de retenção; o código usa o bruto pago (neto+IVA+IIBB), o que retém a mais ~21% de base sobre proveedores RI (ex.: fatura $121.000 c/ IVA → retém 2% de 121.000 em vez de 100.000). O acumulado mensal e o mínimo não sujeito também ficam inflados pelo IVA, antecipando o cruzamento do umbral. Está documentado como decisão de negócio, mas é exposição fiscal/comercial real.
- **Recomendação**: Validar com o contador; idealmente derivar o neto sem IVA via appliedTo (Compra/Gasto têm subtotal/iva) ou um fator configurável por concepto, e comparar mínimo/acumulado sobre base neta.

### [MEDIA] Estado PAGADA_ARCA é inalcançável — depósito ao fisco não atualiza a retenção
- **Arquivo**: src/lib/actions/retenciones.ts:119
- **Evidência**: `grep PAGADA_ARCA em src/: só comentário em asiento-automatico.ts:515 e label em certificado-retencion.ts:23 — nenhuma action/serviço seta o estado.`
- **Descrição**: Não existe fluxo que marque a retenção como depositada: pagar a 2.1.3.07 por movimiento manual não vincula nada, então o alerta 'Retenciones por depositar (VEP)' e a base do futuro SICORE ficam PENDIENTE_ARCA para sempre (com badge 'vencida' acumulando). O guard de anulação ('YA_PAGADA') protege um estado que nunca ocorre.
- **Recomendação**: Criar action 'marcar depositada' (idealmente vinculada ao movimiento de pago do VEP a ARCA, gerando o asiento DEBE 2.1.3.07 / HABER banco) que transicione PENDIENTE_ARCA→PAGADA_ARCA em lote por quinzena.

### [MEDIA] Numeração de certificado por count+1 quebra permanentemente se uma RetencionPracticada for deletada (onDelete: Cascade)
- **Arquivo**: src/lib/services/retencion-ganancias-pago.ts:314
- **Evidência**: `const count = await dbc.retencionPracticada.count({ where: { certificadoNumero: { startsWith: prefix } } }); return `${prefix}${String(count + 1)...` + schema: movimientoTesoreria ... onDelete: Cascade`
- **Descrição**: O número é derivado de count+1. Como RetencionPracticada tem onDelete: Cascade no movimientoTesoreriaId (e extractos.ts:364 deleta movimientos), a deleção de um registro intermediário faz count+1 colidir com um certificado existente — o P2002 vira erro permanente em TODOS os pagos com retenção do ano (o retry sugerido recalcula o mesmo número). Além disso, deletar em cascata um registro fiscal imutável apaga trilha de auditoria.
- **Recomendação**: Trocar Cascade por Restrict no FK e gerar o número por MAX(sufixo)+1 ou sequence dedicada por ano, em vez de count.

### [BAIXA] Acumulado mensal soma debe sem filtrar moneda do asiento — interage com o achado nº1 (ledger USD/ARS misto)
- **Arquivo**: src/lib/services/retencion-ganancias-pago.ts:115
- **Evidência**: `aggregate({ where: { cuentaId, debe: { gt: 0 }, asiento: { origen: "TESORERIA", estado: "CONTABILIZADO", fecha: {...} } }, _sum: { debe: true } }) — sem filtro de asiento.moneda`
- **Descrição**: Movimientos USD simples gravam debe em unidades USD (achado nº1 da auditoria); se a cuenta do proveedor receber um DEBE desses no mês, o acumulado mistura USD como se fosse ARS, subestimando a base e atrasando o cruzamento do mínimo. Também herda qualquer DEBE TESORERIA não-pagamento na mesma cuenta. Cenário improvável para proveedor doméstico sujeito, mas o cálculo fiscal fica acoplado ao bug estrutural do ledger.
- **Recomendação**: Filtrar asiento.moneda=ARS (ou converter por tipoCambio) no aggregate, e documentar a dependência do achado nº1.

### [BAIXA] Semântica oposta do campo de retenção manual entre os dois diálogos (bruto vs neto)
- **Arquivo**: src/app/(dashboard)/tesoreria/movimientos/nuevo/movimiento-form.tsx:331
- **Evidência**: `movimiento-form: 'el Monto que el usuario escribe es el NETO... la retención se SUMA' vs pago-por-factura: monto = total da fatura e 'Neto a pagar' = base − retImporte`
- **Descrição**: No movimiento-form o monto digitado é o NETO que sai do banco (a retenção é somada para formar o bruto enviado ao backend); no pago-por-factura o monto é o BRUTO da fatura (a retenção é descontada pelo backend). Mesmo rótulo 'Importe retenido (ARS)' com aritméticas opostas — operador que alterna entre as telas pode digitar o valor errado e pagar neto incorreto.
- **Recomendação**: Unificar a semântica (preferindo bruto = total da fatura) ou renomear os campos/ajudas para explicitar a direção do cálculo em cada tela.

### [BAIXA] Pago batch com UM proveedor sujeito aplica retenção automática sem preview no diálogo
- **Arquivo**: src/app/(dashboard)/tesoreria/saldos-proveedores/saldos-batch-pago.tsx:251
- **Evidência**: `saldos-batch-pago/embarque-batch-pago chamam crearMovimientoTesoreriaAction; o aviso amber só renderiza com seleccionados.length > 1`
- **Descrição**: Com a flag ligada, pagar UM proveedor sujeito pelos diálogos batch dispara a retenção automática no backend (todas as linhas na mesma cuenta), mas esses diálogos não têm preview nem aviso para seleção única — o usuário confirma um total e o banco debita o neto, descobrindo a retenção só no asiento/movimiento.
- **Recomendação**: Reusar simularRetencionGananciasAction nos batch quando a seleção colapsa em uma única cuenta de proveedor, exibindo o mesmo bloco amber do pago-por-factura.

### [BAIXA] Aritmética de dinheiro com float (Number) no caminho da retenção manual e no PDF
- **Arquivo**: src/app/(dashboard)/tesoreria/movimientos/nuevo/movimiento-form.tsx:422
- **Evidência**: `(Number(l.monto) + retImporteNum).toFixed(2) ... const brutoManual = totalCalculado + retImporteNum; e certificado-retencion.ts:66 Number(ret.base) - Number(ret.importeRetenido)`
- **Descrição**: O bruto enviado ao backend é calculado com float64 e toFixed(2), contrariando o padrão decimal.js do projeto (lição do 1ct: alinhar granularidade de arredondamento). Para valores de 2 casas o erro fica abaixo do meio centavo na prática, mas é o mesmo padrão que já causou divergência de 1ct em outras telas; no PDF o 'Neto pagado' também é derivado por float, podendo divergir do asiento.
- **Recomendação**: Usar Decimal (decimal.js) para compor bruto = neto + retención no submit e para o neto do certificado (ou persistir o neto na RetencionPracticada).

## Pendências da feature
- Flag RETENCION_GANANCIAS_ENABLED default off — ativação exige migração (SQL focado ou db push), seed pnpm tsx prisma/seed-parametros-retencion.ts e marcação dos proveedores sujeitos; o próprio seed avisa 'VERIFICAR/AJUSTAR con el contador' os mínimos/alíquotas
- Sem export SICORE/AFIP (F.997/F.2002): listarRetencionesPracticadas é só a 'base del reporte / SICORE'; não há tela /tesoreria/retenciones (a action até revalida esse path inexistente) nem arquivo de import para o aplicativo da ARCA
- Sem fluxo de depósito ao fisco: nenhum asiento guiado DEBE 2.1.3.07/HABER banco nem transição para PAGADA_ARCA (ver novo achado)
- Escala progressiva do Anexo VIII apenas aproximada: montoFijo aplicado uma única vez no pago que cruza o mínimo; o seed usa alíquota plana com montoFijo=0 (honorarios 6% plano em vez da escala real)
- Pagos via intermediario (pagarConIntermediarioAction) e via conciliação de extracto (aprobarLinea) não retêm nunca, mesmo proveedor sujeito — só o caminho crearMovimientoTesoreriaAction retém
- anularRetencionGananciasAction não reverte o asiento contábil do pago — o 'wiring automático pago↔retención' está documentado como fast-follow no próprio código
- Pagos multi-proveedor não retêm (v1 documentado); mitigação é só o aviso amber nos diálogos batch
- Vencimento ARCA fixo em fecha+15 dias corridos (DIAS_VENCIMIENTO_RETENCION_ARCA) — não segue o calendário quinzenal real do SICORE; comentário admite 'hasta parametrizarlo por régimen'
- MONOTRIBUTO não sofre retenção 'em v1' (cortocircuito) — regime de monotributistas excedidos (RG 4011) não tratado; retenções de IVA/SUSS/IIBB fora do escopo (enum TipoRetencion só GANANCIAS)
- Colisão de numeração de certificado sob concorrência é tratada como erro com reintento manual ('volumen bajo, riesgo aceptable en v1'), não com retry automático

---

# Balancete ARS/USD (#190)

## Resumo
O PR #190 (commit 0e34d63) dá ao Balance de Sumas y Saldos o mesmo toggle ARS/USD dos demais relatórios. O serviço getBalanceSumasYSaldos passou a aceitar tcParaUsd e a emitir saldoInicialUsd/debeUsd/haberUsd/saldoFinalUsd por cuenta e por línea. "Invariante a TC" significa: linhas USD-natas (monedaOrigen=USD com montoOrigen, infra do PR #174) usam o montoOrigen histórico como fato — o saldo USD de pasivos USD-natos não muda quando o TC do dia muda; linhas ARS-natas são convertidas por ARS÷TC apenas como display. O TC vem de getCotizacionParaFecha(fechaHasta) na page.tsx e só é passado quando moneda=USD. O roll-up em SINTÉTICAS soma os campos USD dos filhos (null se algum filho é null). A UI seleciona ARS ou *Usd via pickMoney por coluna, exibindo "—" quando null. É feature 100% de exibição: nada muda no write-time do ledger. De carona, o PR corrige o default de fecha do Gasto de flete em ventas.ts (fecha da venta em vez de new Date()).

## Implementações
- getBalanceSumasYSaldos aceita tcParaUsd e emite saldoInicialUsd/debeUsd/haberUsd/saldoFinalUsd por cuenta e por línea (balance-sumas-saldos.ts:89-99)
- usdPart: linha USD-nata usa montoOrigen como fato invariante; linha ARS-nata converte ARS÷TC; null sem TC (balance-sumas-saldos.ts:172-180)
- Saldo inicial agora carrega monedaOrigen/montoOrigen das linhas prévias para compor saldoInicialUsd (balance-sumas-saldos.ts:116-140)
- Roll-up USD em SINTÉTICAS soma filhos; pai vira null se qualquer filho USD é null (balance-sumas-saldos.ts:351-382)
- page.tsx lê ?moneda= + monedaPreferida da sessão, busca cotización da fechaHasta e passa tcParaUsd + tcInfo ao MonedaToggle (page.tsx:55-63,106)
- balance-tree-table recebe prop moneda e seleciona ARS ou campo *Usd via pickMoney; null exibe '—' (balance-tree-table.tsx:59-61,137-178)
- Drill-down por línea ganhou debeUsd/haberUsd/saldoAcumuladoUsd no payload (balance-sumas-saldos.ts:19-21,282-295)
- Fix carona fora do balancete: Gasto de flete da venda usa fecha da venta como default em vez de new Date() (src/lib/actions/ventas.ts)

## Status dos achados da auditoria

- **[NAO_AFETADO]** CRÍTICO: asientos USD gravam debe/haber em USD cru e relatórios somam como ARS
  - Raiz write-time intacta: o diff de asiento-automatico.ts entre 376153d e origin/main só adiciona anulação de retención RG 830 e marcação LEGACY_BUNDLED (#195/#199); usdOrigen segue sem ser aplicado nas linhas COBRO/PAGO/TRANSFERENCIA. O PR #190 é só display: adiciona colunas USD, mas a coluna ARS continua somando USD cru como pesos, e o toggle USD trata essas linhas (sem monedaOrigen) como ARS-natas, dividindo-as por TC (ver novo achado).
- **[PIOROU]** Balance de sumas y saldos carrega todas as lineas do período com join de asiento (drill-down no payload)
  - A query do período segue findMany sem take com join de asiento e drill-down embutido (balance-sumas-saldos.ts:141-166), agora com +3 strings USD por línea no payload. Pior: o saldo inicial trocou groupBy SQL (_sum por cuentaId) por findMany de TODAS as linhas anteriores a fechaDesde (balance-sumas-saldos.ts:116-131) para ler monedaOrigen/montoOrigen — todo o histórico do ledger é materializado em JS a cada render.
- **[NAO_AFETADO]** Crédito/Débito vs Debe/Haber e ordem invertida no balance-tree-table
  - Labels e ordem preservados na versão origin/main: coluna 'Crédito' (=haber, balance-tree-table.tsx:145) continua ANTES de 'Débito' (=debe, l.160), divergindo do padrão Debe/Haber do cuenta-tree-table dos relatórios vizinhos.
- **[NAO_AFETADO]** Balance General com fechaDesde não cuadra (resultado acumulado pré-desde fora do PN)
  - src/lib/services/reportes/balance-general.ts e reportes/shared.ts não têm nenhum diff entre 376153d e origin/main; o PR #190 só tocou o balancete (relatório distinto).

## Novos achados

### [MEDIA] Saldo inicial regrediu de groupBy SQL para findMany do histórico completo
- **Arquivo**: src/lib/services/balance-sumas-saldos.ts:117
- **Evidência**: `db.lineaAsiento.findMany({ where: { asiento: { estado: CONTABILIZADO, fecha: { lt: filter.fechaDesde } } }, select: { cuentaId, debe, haber, monedaOrigen, montoOrigen } }) — antes era groupBy com _sum`
- **Descrição**: Para compor saldoInicialUsd, o PR trocou a agregação no banco por carregar todas as linhas anteriores a fechaDesde em JS. Como o default da page é mês-corrente, cada render do balancete (force-dynamic) materializa o ledger histórico inteiro — custo cresce sem limite com o tempo, na maior tabela do banco (que ainda carece de índice em asientoId segundo a auditoria).
- **Recomendação**: Voltar a agregar no banco: dois groupBy por cuentaId (um para componentes USD-natos somando montoOrigen condicionado a debe>0/haber>0, outro para o resto somando debe/haber) ou uma query raw com SUM(CASE WHEN monedaOrigen='USD'...).

### [MEDIA] Linhas USD-cruas sem monedaOrigen são divididas por TC no toggle USD
- **Arquivo**: src/lib/services/balance-sumas-saldos.ts:172
- **Evidência**: `usdPart: if (monedaOrigen === 'USD' && montoOrigen) return toDecimal(montoOrigen); if (tc) return ars.div(tc); — selects não trazem asiento.moneda, impossível detectar USD cru`
- **Descrição**: As linhas do achado crítico nº1 (COBRO/PAGO USD não-Fase2, gravadas com debe/haber em USD cru e SEM monedaOrigen) caem no branch ARS-nata: USD 100 a TC 1200 aparece como USD 0,08 na view USD (e como ARS 100 na view ARS). O toggle herda a corrupção e gera um número duplamente errado, com aparência de dado confiável ao lado de saldos USD-natos corretos.
- **Recomendação**: Incluir asiento.moneda nos selects e marcar usdConocido=false (ou usar debe/haber direto como USD) para linhas de asientos moneda=USD sem monedaOrigen, até a migração do ledger para convenção 100% ARS.

### [BAIXA] pruneBalanceSinSaldo só testa campos ARS — conta com saldo USD não-zero pode sumir na view USD
- **Arquivo**: src/lib/services/balance-sumas-saldos.ts:64
- **Evidência**: `const isZero = (n) => parseFloat(n.saldoInicial)===0 && parseFloat(n.debe)===0 && parseFloat(n.haber)===0 && parseFloat(n.saldoFinal)===0; — nenhum campo *Usd verificado`
- **Descrição**: Com 'ocultar sin saldo' ativo na view USD, uma conta cujo saldo ARS zera (debe=haber e saldoInicial/Final 0) mas cujo saldo USD invariante não zera (componentes USD-natos a TCs distintos) é podada da árvore, ocultando saldo USD residual. Caso de borda, mas exatamente o tipo de resíduo que o saldo invariante existe para revelar.
- **Recomendação**: Quando moneda=USD, incluir os campos *Usd no isZero (ou podar com base na moneda ativa passada como parâmetro).

### [BAIXA] Sem cotización, drill-down mostra USD por línea mas agregados ficam '—'
- **Arquivo**: src/lib/services/balance-sumas-saldos.ts:177
- **Evidência**: `usdPart retorna montoOrigen mesmo com tc=null (l.177), gerando debeUsd/haberUsd por línea; mas usdConocido é inicializado tc !== null (l.197, l.244), zerando os agregados da cuenta`
- **Descrição**: Se moneda=USD e não há cotización para a fechaHasta (page.tsx:60-61 manda tcParaUsd=null), as linhas USD-natas no drill-down exibem debeUsd/haberUsd reais enquanto saldoAcumuladoUsd e todos os totais da cuenta exibem '—' — mistura visual inconsistente na mesma tabela.
- **Recomendação**: Uniformizar: com tc=null, ou suprimir também os campos por línea, ou emitir os agregados das contas 100% USD-natas (que são conhecidos sem TC).

## Pendências da feature
- Raiz do ledger misto segue aberta: convenção 100% ARS não migrada, usdOrigen continua nunca aplicado em COBRO/PAGO/TRANSFERENCIA (asiento-automatico.ts) — o toggle é só leitura
- Toggle chegou apenas ao balancete neste PR (balance-general, estado-resultados, libro-diario, libro-mayor e BI já o tinham); flujo de caja continua particionando por asiento.moneda, sem toggle equivalente
- Labels Crédito/Débito e ordem invertida (Crédito antes de Débito) não foram padronizados para Debe/Haber, divergindo dos relatórios vizinhos
- Nenhum teste foi adicionado para getBalanceSumasYSaldos com tcParaUsd (USD-nato vs ARS÷TC, roll-up null, saldo inicial USD)
- Sem take/paginação nem drill-down sob demanda — payload de líneas (agora com 3 campos USD extras) segue inteiro no client
- Data do TC segue em ISO yyyy-MM-dd no MonedaToggle (page.tsx:70) e no drill-down (balance-tree-table.tsx:91), achado de formato da auditoria persiste

---

# Motor de asientos + misc (#193-#199)

## Resumo
Os PRs #193-#199 (fora da retención propriamente) trouxeram quatro mudanças residuais ao escopo analisado. Em asiento-automatico.ts, o PR #199 adicionou o marking LEGACY_BUNDLED: ao criar o asiento de despacho (legacy e cruzado), as facturas DESPACHO em BORRADOR que foram bundleadas no asiento passam a LEGACY_BUNDLED (sem asientoId, pois a coluna é @unique e reservada para EMITIDA), para que CxP "Por embarque" (que filtra EMITIDA/LEGACY_BUNDLED) as exiba. A onda de retención também tocou o motor: anularEnTx agora anula retenciones PENDIENTE_ARCA vinculadas aos movimentos do asiento antes de desvinculá-los (PAGADA_ARCA fica intocada). O PR #197 criou src/lib/empresa.ts (EMPRESA com razón social default "SUNSET TIRES CORPORATION SAS" e CUIT/domicilio via env), consumido pelo gerador de PDF do certificado RG 830 (certificado-retencion.ts:106-111); o #199 corrigiu a metadata do layout para "S.A.S.". Em ventas.ts, upsertFleteGasto passou a espelhar a fecha da venta quando a factura de flete não tem data (antes usava new Date()), mantendo o gasto no mesmo período contábil. As demais mudanças são UI/infra da retención: card RG 830 no detalhe do movimento com download de certificado, flag retencionGananciasEnabled passada ao form de novo movimento, seção RG 830 no form de proveedor, e package.json com pdf-lib, script db:seed-retenciones e bumps de tooling. Nenhum dos cinco achados da auditoria relacionados ao motor foi resolvido por esses PRs.

## Implementações
- asiento-automatico.ts: crearAsientoDespacho e crearAsientoDespachoCruzado marcam facturas DESPACHO BORRADOR bundleadas como LEGACY_BUNDLED após criar o asiento (origin/main :2591-2602 e :2939-2950), sem atribuir asientoId
- asiento-automatico.ts: anularEnTx anula retenciones RG 830 PENDIENTE_ARCA→ANULADA dos movimentos vinculados antes de desvincular (origin/main :508-531); PAGADA_ARCA exige correção manual
- src/lib/empresa.ts (novo, #197): EMPRESA server-only com razonSocial default 'SUNSET TIRES CORPORATION SAS' e cuit/domicilio via env — usado em src/lib/services/certificado-retencion.ts:106-111 (PDF do certificado RG 830)
- src/app/layout.tsx: metadata description corrigida de 'Sunset Tires Corporation SA' para 'Sunset Tires Corporation S.A.S.' (#199)
- src/lib/actions/ventas.ts: upsertFleteGasto recebe fechaVenta e usa-a como fallback quando fleteFactura.fechaFactura está vazia (antes new Date()), alinhando o período contábil do gasto de flete ao da venta (:515-526, :739)
- tesoreria/movimientos/[id]/page.tsx: card 'Retención Ganancias (RG 830)' com certificado, base, alícuota, importe, vencimento ARCA e botão de download do PDF (:241-282)
- tesoreria/movimientos/nuevo/page.tsx: passa retencionGananciasEnabled (flag RETENCION_GANANCIAS_ENABLED, default off) ao MovimientoForm
- proveedor-form-dialog.tsx: seção RG 830 — checkbox sujetoRetencionGanancias, condicionGanancias, alícuota override, certificado de exclusão e vigência
- package.json: dep pdf-lib ^1.17.1, script db:seed-retenciones, bumps biome 2.4.16 e eslint-config-next 16.2.9

## Status dos achados da auditoria

- **[NAO_AFETADO]** Despacho legacy credita 1.1.5.02 com custos de facturas ZP que nunca entraram na conta (filtro estado !== ANULADA inclui EMITIDA)
  - O filtro permanece idêntico em origin/main asiento-automatico.ts:2347-2349 (`f.momento === "ZONA_PRIMARIA" && f.estado !== "ANULADA"`) e segue alimentando costoEnTransitoTotalArs (:2364-2367). O fix LEGACY_BUNDLED do #199 só atua sobre facturas DESPACHO (momento !== ZONA_PRIMARIA) e apenas muda o estado delas após o asiento — não toca o cálculo do crédito de 1.1.5.02 nem reclassifica EMITIDA.
- **[NAO_AFETADO]** Facturas DESPACHO EMITIDA não capitalizam no despacho cruzado nem são reclassificadas (filtro BORRADOR||LEGACY_BUNDLED em :2687 de 376153d)
  - O filtro segue igual em origin/main :2723-2728 (BORRADOR || LEGACY_BUNDLED); EMITIDA continuam fora do helper de costo landed (:2752-2759) e não há reclassificação análoga à de crearAsientoArriboComex. O bloco novo (:2939-2950) só marca BORRADOR→LEGACY_BUNDLED depois do asiento, sem alterar quais facturas entram.
- **[NAO_AFETADO]** Asientos de venta/compra/entrega gravados com origen MANUAL
  - origin/main mantém AsientoOrigen.MANUAL em crearAsientoVenta (:3211), crearAsientoEntrega (:3298) e crearAsientoCompra (:3442). Nenhum PR do escopo tocou esses geradores.
- **[NAO_AFETADO]** usdOrigen construída e nunca usada (:770 de 376153d)
  - Em origin/main a variável está em :792-799 e o grep no arquivo inteiro retorna apenas a declaração — segue sem ser espalhada nas linhas dos casos COBRO/PAGO/TRANSFERENCIA de crearAsientoMovimientoTesoreria.
- **[NAO_AFETADO]** crearAsientoVenta soma cheques sem filtrar ANULADO
  - O select segue `chequesRecibidos: { select: { importe: true } }` sem filtro de estado (origin/main :3005-3007) e totalCheques soma tudo (:3061-3064). A mudança de ventas.ts foi exclusivamente a fecha do gasto de flete (upsertFleteGasto) — não toca cheques.

## Novos achados

### [MEDIA] Facturas BORRADOR sem linhas viram LEGACY_BUNDLED sem terem sido contabilizadas
- **Arquivo**: src/lib/services/asiento-automatico.ts:2597
- **Evidência**: `Booking pula facturas vazias: `if (factura.lineas.length === 0) continue;` (:2503 legacy, :2853 cruzado), mas `bundleablesIds = facturasDespacho.filter((f) => f.estado === "BORRADOR")` (:2597 e :2945) inclui todas.`
- **Descrição**: Uma factura DESPACHO em BORRADOR sem linhas (mas com IVA/IIBB/otros no header) não gera nenhuma linha no asiento — nem o HABER ao proveedor — porém é marcada LEGACY_BUNDLED. Resultado: aparece em CxP 'Por embarque' como dívida sem contrapartida contábil e fica permanentemente bloqueada para emissão standalone (crearAsientoEmbarqueCosto lança erro para LEGACY_BUNDLED em :3662-3666).
- **Recomendação**: Excluir do marking as facturas com lineas.length === 0 (ou total contabilizado igual a zero), reutilizando o mesmo critério do loop de booking.

### [MEDIA] Anulação do asiento de despacho não reverte LEGACY_BUNDLED para BORRADOR
- **Arquivo**: src/lib/services/asiento-automatico.ts:554
- **Evidência**: `anularEnTx só toca embarqueCosto via vínculo: `where: { asientoId }, data: { asientoId: null, estado: "ANULADA" }` (:554-557); facturas LEGACY_BUNDLED não têm asientoId por design do #199 (:2594-2596) e não há detach de despacho.asientoId.`
- **Descrição**: Se o asiento do despacho for anulado pela rota genérica, as facturas que o #199 flipou para LEGACY_BUNDLED permanecem nesse estado: CxP 'Por embarque' continua exibindo a dívida cuja contrapartida foi anulada, e elas não podem ser re-emitidas standalone nem voltam a BORRADOR. Antes do fix, BORRADOR permanecia BORRADOR e o estado era consistente após anulação.
- **Recomendação**: Em anularEnTx (ou num anularAsientoDespacho dedicado), reverter LEGACY_BUNDLED→BORRADOR das facturas DESPACHO do despacho cujo asiento foi anulado, idealmente registrando o despachoId/asientoId de bundling para rastrear o vínculo.

## Pendências da feature
- Flag RETENCION_GANANCIAS_ENABLED default off (src/lib/features.ts:135-137); ativação real exige env, db push, seed via pnpm db:seed-retenciones e marcação dos proveedores sujeitos
- EMPRESA_CUIT e EMPRESA_DOMICILIO sem default (src/lib/empresa.ts:9-10) — o certificado RG 830 sai com 'CUIT: —' até configurar as envs (certificado-retencion.ts:108)
- Retenciones PAGADA_ARCA não são anuladas automaticamente quando o asiento de pago é anulado — comentário em asiento-automatico.ts:512-517 documenta que exigem correção manual por admin
- Retención automática limitada a PAGO em ARS a um único proveedor (doc da flag em features.ts:121-125); pagos USD e batch ficam fora do cálculo automático
- O fix LEGACY_BUNDLED não abordou o achado ALTA do despacho legacy (filtro estado !== ANULADA em :2347-2349 incluindo EMITIDA no crédito de 1.1.5.02) nem a reclassificação de EMITIDA no cruzado — ambos seguem em aberto

---
