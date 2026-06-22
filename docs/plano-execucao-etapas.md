---
tipo: plano-execucao
projeto: sunset-erp-v4
data: 2026-06-11
status: vigente
---

# Execução do Plano v2 em Etapas (checkpoint a cada ~100k tokens)

> Quebra do [[02-roadmap-consolidado|Plano v2]] em etapas executáveis, cada uma dimensionada para ≤ ~100k tokens de janela de contexto. **Esta nota é o estado vivo da execução**: marcar ☑ ao concluir, anotar PR e desvios na coluna Resultado.

## Protocolo por etapa (ritual obrigatório)

1. **Início**: partir de `origin/main` atualizado → branch novo (`fix/...` ou `feat/...`). Reler ESTA nota + a memória do Claude antes de codar.
2. **Implementar**: ler só os arquivos da etapa; testes junto (Vitest/Testcontainers onde houver infra); `pnpm biome:ci` + `pnpm typecheck` + `pnpm test` antes de finalizar.
3. **Git**: commit atômico + push + PR (1 etapa = 1 PR; mergear antes da próxima quando possível).
4. **Obsidian**: marcar a etapa aqui (☑ + nº do PR + desvios em 1 linha); se houve decisão nova → ADR em 04-decisions; lição recorrente → memória do Claude.
5. **Compactar** a conversa (usuário roda /compact).
6. **Retomar**: a próxima sessão começa relendo esta nota (seção "Estado") + MEMORY.md → próxima etapa ☐.

**Orçamento por etapa:** S ≈ 40-60k tokens · M ≈ 60-90k · L ≈ 90-110k (se estourar, dividir e registrar aqui).

## Estado

> ⚠️ **Esta seção e vários checkboxes ☐ abaixo ficaram MUITO desatualizados.** O **git é a fonte da verdade**.
> Reconciliação completa (2026-06-22) na nota do vault **`pendencias a corrigir`**.

- **Realidade (git):** **FASE A completa** (E1–E7, incl. E4a/b/c/d) · FASE B/C com E8/E10/E11/E13/E16/E18 mergeadas + Ondas A–E · **FASE F (UI NetSuite) majoritariamente entregue** (NS-1…NS-4, overviews por center, dark mode, ⌘K, data-table-advanced, export CSV/XLSX, record-shell + audit-trail).
- **Pendentes reais:** E14 · E19 · E20 · E21 · E12 (resto) · E22–E29 (estrutural + docs) · E40–E43 (portlets, sweep es-AR, performance, observabilidade) · faixas backend TRACK-B1/B2/B3 · cauda de BI (RECPAM, forecast 13s, ROIC/EVA/WACC, score, alertas).
- **Higiene aberta:** PR #311 (BI reconciliação razão↔subledger) + 11 PRs do dependabot.
- **Branch base:** origin/main (atual). *(Histórico: o plano nasceu em `afe7780` pós-#201.)*

---

## FASE A — ⭐ Pago Exterior USD invariante (regra canônica: ARS muda, USD nunca)

| ☐ | Etapa | Conteúdo | Arquivos-chave | Tam. | Resultado |
|---|---|---|---|---|---|
| ☑ | **E1** | PE.1+PE.2: `monedaOrigen/montoOrigen/tipoCambioOrigen` na línea DEBE do pago exterior + saldos exterior por montoOrigen/aplicaciones (matar leitura de debe cru) + testes | pago-exterior.ts:277, cuentas-a-pagar.ts:1650-1700 | M | **PR #200** (merged `29fa473`) — helper compartilhado `getPagosUsdPorCuenta`/`pagadoUsdParaFactura` (montoOrigen → fallback legacy 1-DEBE=mov.monto / multi-DEBE=USD cru; AplicacionPago* layer 0 com prorrateio, tokens só fallback); action e vista usam o mesmo algoritmo; +6 testes serviço, 264 verdes; review adversarial incorporada |
| ☑ | **E2** | PE.5: TC real obrigatório no extrato USD (fix ternário `"1":"1"`, cotización ou input na UI de revisão) + teste | extractos.ts:137, lineas-review.tsx | S | **PR #201** — ARS→TC=1; extranjera→TC manual (dialog, parsing es-AR) → `getCotizacionParaFecha(fecha, tx)` → erro claro (línea PENDIENTE); asiento herda TC real; +6 testes (270 verdes); review: dialog inicia vazio (default = cotización por fecha) |
| ☑ | **E3** | PE.4: COBRO/PAGO/TRANSFERENCIA USD gravam ARS (monto×TC) usando a `usdOrigen` pronta; bloquear línea com moeda ≠ ARS no motor | asiento-automatico.ts:763-925 | M | **PR #202** — guard `MONEDA_INVALIDA` no motor (moneda≠ARS e TC≠1); caso simples + Ley 25413 convertem a ARS c/ metadata (split 33/67 sobre ARS); path Ley 25413 duplicado do extracto removido (tudo via motor); pago exterior header ARS/1; multi-contrapartida/intermediario por parcela round 2 + banco = Σ exata; gasto fijo + transferencias c/ metadata (achados do review adversarial, 8 agentes); saldo bancário na moneda da cuenta (`calcularSaldosCuentasBancariasEnMonedaCuenta`: USD = Σ±montoOrigen + fallback legado cru) em cuentas/dashboard/BI; asiento manual só ARS; +8 testes (278 verdes) |
| ☑ | **E4** | PE.3: Fase 2 (dif. cambiaria) em pago multi-contrapartida e intermediario + fix validação de préstamo USD (validar em USD, não TC do dia) | movimientos-tesoreria.ts:344,409,671 | M/L | **PRs #250 (E4a multi-contrapartida) · #252 (E4b intermediario) · #255 (E4c single) · #257 (E4d préstamo USD validar/exhibir)** |
| ☑ | **E5** | PE.6: relatórios USD só de montoOrigen (nunca ÷TC; sem metadata = "—") + balancete: saldo inicial de volta a groupBy SQL + prune considera campos USD | balance-sumas-saldos.ts:64,117,172 | M | **PR #249** (balancete USD por lado + saldo inicial groupBy + prune-USD) |
| ☑ | **E6** | PE.7: script de migração de asientos USD legados (uma vez, com dry-run) + validador de invariante no CI (moeda única ARS, saldo USD = Σ montoOrigen, partida doble) espelhando validar-stock.yml | prisma/scripts + .github/workflows | L | **PR #258** (validador de invariante del ledger en CI) |
| ☑ | **E7** | PE.8: teste E2E ciclo canônico (factura USD 25.000 TC 1.200 → pago TC 1.300 → saldo USD 0, pérdida 2.500.000, balancete invariante) + smoke dos 4 paths de pago | test/ | M | **PR #259** (ciclo canónico de pago exterior USD + smoke 4 paths) |

## FASE B — Correções críticas restantes + fundação

| ☐ | Etapa | Conteúdo | Arquivos-chave | Tam. | Resultado |
|---|---|---|---|---|---|
| ☐ | **E8** | Stock: replay TRANSFERENCIA promedia custo + revertirTransferenciaDespacho recalcula Producto + anular transferência recalcula | stock.ts:850,913, transferencias.ts:199 | M | |
| ☐ | **E9** | Guards de bypass: anulação genérica bloqueia asientos de venta/entrega/cierre/gasto fijo; confirm de entrega exige venta EMITIDA; emitir compra/venta exige BORRADOR; bloquear transferência manual com depósito ZPA | asientos.ts:110, entregas.ts:269, compras.ts:366, ventas.ts:820, transferencias.ts:136 | M | |
| ☐ | **E10** | D9 completo: concluir/arquivar aplica counters+stock+asiento traslado; ubicación correta do ajuste; sem netear FALTA×SOBRA entre SKUs | divergencia-investigacion.ts:318-406 | M | |
| ☐ | **E11** | Auth: requireRole(ADMIN) (anular masivo, períodos, mover/fecha asientos, página /admin) + auth() em todas as actions mutadoras + middleware.ts | ~15 actions, novo authz helper | M | |
| ☐ | **E12** | Concorrência single-shot: VEP pago (embarque+despacho), emitir venta/compra, aprobarLinea, cerrarPeriodo em tx; reserva/egreso de stock com update condicional (sem negativo) | vep-*.ts, ventas.ts, compras.ts, periodos.ts, stock.ts, extractos.ts | M/L | |
| ☐ | **E13** | Fundação de dados: prisma migrate baseline + remover `db:push:force` + índices (LineaAsiento.asientoId, Venta(estado,fecha), ItemEmbarque, ItemVenta, MovimientoTesoreria, Asiento(estado,fecha)) + índices parciais para migrations | prisma/, package.json | M | |
| ☐ | **E14** | Pós-#199: LEGACY_BUNDLED (excluir factura vazia; reverter na anulação) + retención: numeração por MAX + FK Restrict + semântica única bruto/neto + acumulado filtra moneda ARS | asiento-automatico.ts:2597, retencion-ganancias-pago.ts:115,314, movimiento-form | M | |

## FASE C — Completar pendências (entrega dos pneus primeiro)

| ☐ | Etapa | Conteúdo | Tam. | Resultado |
|---|---|---|---|---|
| ☐ | **E15** | **Entregas 1**: tab/botão "Entregas" no detalhe da venta (matar rota órfã) + contador pendentes na lista + painel no dashboard | M | |
| ☐ | **E16** | **Entregas 2**: depósito resolvido e persistido na emissão (fim do mismatch null) + stockActual decrementa no egreso NACIONAL + liberação de reserva pelo depósito persistido | M | |
| ☐ | **E17** | **CMV base única**: emissão usa SPD do depósito reservado (mesma base da entrega); bloquear emissão com costo 0; 1.1.5.03 reconcilia | M/L | |
| ☐ | **E18** | Recepção de compra: EMITIDA→RECIBIDA + MovimientoStock ingreso + recalc costoPromedio (ou bloquear produto em compras — decidir) | M | |
| ☐ | **E19** | Retención fechamento v1: depósito ARCA (asiento DEBE 2.1.3.07/HABER banco + PENDIENTE_ARCA→PAGADA_ARCA em lote), tela /tesoreria/retenciones, preview nos batch c/ 1 proveedor; base com/sem IVA = decisão do contador (ADR) | L | |
| ☐ | **E20** | Pedidos: mapa de transições válidas (venta+compra) + anti dupla-faturação (unique/check) + venta desde pedido herda percepción IIBB e alíquotas reais | M | |
| ☐ | **E21** | VEP: cron VENCIDO + estado ANULADO em vez de delete (trail) + bloquear contabilizar despacho com tributos zerados + alinhar granularidade montoTotal | S/M | |

## FASE D — Simplificação estrutural

| ☐ | Etapa | Conteúdo | Tam. | Resultado |
|---|---|---|---|---|
| ☐ | **E22** | Helpers únicos: numeração MAX+1 (ventas, compras, gastos, entregas, transferencias, despachos, pedidos, certificados) + arredondamento round2-unitário+true-up aplicado aos 7 pontos da lição do 1ct | M/L | |
| ☐ | **E23** | Aposentar comex legacy: bloquear novos embarques pelo caminho monolítico (todos via Modelo Y) + reclassificação ZP EMITIDA no legacy remanescente + plano de extinção (ADR) | L | |
| ☐ | **E24** | Estados derivados: EmbarqueEstado logístico separado dos marcos contábeis (asientoZonaPrimariaId/asientoId); helper transicionar() com mapa por entidade | M/L | |
| ☐ | **E25** | Reversões que faltam: anulación de desconsolidación + cancelarContenedor + reabertura de embarque dedicada (sem bypass por asientos UI) | L | |
| ☐ | **E26** | CxP fonte única: AplicacionPago para embarqueFob + token-matching vira fallback só de legado + FIFO Layer 4 com pagadoFk + ratear match multi-factura | L | |

## FASE E — Workflows recriados + documentação

| ☐ | Etapa | Conteúdo | Tam. | Resultado |
|---|---|---|---|---|
| ☐ | **E27** | Guards de ordem comex: desconsolidar/nacionalizar exigem arribo confirmado; revertir ZP bloqueado com desconsolidación; validarInvariantePackingList como gate | M | |
| ☐ | **E28** | Fluxogramas mermaid dos 4 fluxos + atualizar docs/fluxo-zona-primaria.md + reescrever 02-workflows do vault (importacion Modelo Y, ventas, compras, tesorería) + glossário | M | |
| ☐ | **E29** | Vault de referência: plan-de-cuentas (1.1.5.x + dif. cambiarias), reglas-asientos (~20 geradores), STATE snapshot, INDEX, arquivar PRD v2, supersedes, deletar lixo | M | |

## FASE F — UI NetSuite

| ☐ | Etapa | Conteúdo | Tam. | Resultado |
|---|---|---|---|---|
| ☐ | **E30** | Quick wins 1: ThemeProvider+dark mode+toggle, status tokens + StatusBadge semântico (embarques/ventas/despachos/asientos) | M | |
| ☐ | **E31** | Quick wins 2: MoneyInput es-AR (vírgula), dirty guard (embarque/venta/compra), fix "Hoy" timezone ART, Cmd+S no embarque-form | M | |
| ☐ | **E32** | ⌘K command palette (navegação + ações rápidas; records via prefixos) + item "Mi perfil" no user-menu | M | |
| ☐ | **E33** | Paginação universal + take máximo (asientos, movimientos, gastos, leads, productos c/ busca server) + error.tsx padrão por módulo | M | |
| ☐ | **E34** | Topnav por 7 centers + mega-menu; hubs viram overview; breadcrumb melhorado | L | |
| ☐ | **E35** | Busca global de records (server action multi-entidade) + quick create "+" + notification center (reminders) | M/L | |
| ☐ | **E36** | data-table-advanced: sort server, colunas configuráveis, contagem, filtros na URL (nuqs) + migração asientos/ventas/embarques | L | |
| ☐ | **E37** | Saved views (model SavedView) + export CSV/XLSX (listagens + reportes) + FilterBar único | L | |
| ☐ | **E38** | record-shell piloto (embarque): header status + botão primário contextual + subtabs (Facturas/Contenedores/Costos/Despachos/Asientos/Auditoría) + audit trail UI sobre AuditLog | L | |
| ☐ | **E39** | record-shell rollout: venta (tab Entregas!), asiento, cliente/proveedor + related-records ("criado a partir de/gerou") + breadcrumb com código real | L | |
| ☐ | **E40** | Dashboard de portlets: reminders clicáveis, KPIs com drill-down, config por usuário/papel | L | |
| ☐ | **E41** | Sweep de escrita es-AR: pt/en→es (vendas, Cadastro, frete, Lacre, Beneficiário, Owner/Stage, Close...), voseo, Debe/Haber, formatos moeda/data, fmtMoney/fmtDate na contabilidad | M | |
| ☐ | **E42** | Performance de reportes: groupBy SQL (flujo, dashboard, BI), cache de referências (unstable_cache+tags), Suspense em cuentas-a-pagar, snapshot de stock | L | |
| ☐ | **E43** | Observabilidade: Sentry + logger estruturado (94 console.error) + rate limit IA (extracto-parser, crm-ai) + blobs privados + validação aritmética do parser de extracto | M/L | |

---

## Regras de ouro da execução
- Nunca pular o ritual (git → obsidian → compactar → reler memória)
- Achou bug novo fora do escopo da etapa? **Anotar aqui** (seção abaixo) e seguir — não expandir a etapa
- Decisão de negócio necessária (ex.: base da retención, aposentar legacy)? ADR curto em 04-decisions + perguntar ao usuário se bloqueante
- Testes sempre na mesma etapa do código

## Descobertas fora de escopo (anotar durante execução)
- **(E1)** `getSaldosExteriorPorProveedor` não filtra `EmbarqueCosto.estado` — costo ANULADA/BORRADOR ainda conta como deuda USD (candidato: E14 ou junto da E26)
- **(E1)** `pagarFacturaExteriorAction` NÃO gera diferencia cambiaria automática no pago (asiento 2 líneas; residual ARS fica na cuenta do proveedor) — a regra canônica exige pérdida/ganancia em ARS no pago. Incluir na **E4** (junto da Fase 2 multi-contrapartida) ou etapa própria antes da E7
- **(E1)** Token-matching legado: pago batch cujа descripción menciona 2+ códigos de embarque desconta o valor cheio em cada FOB virtual (sem âncora estrutural não há prorrateio) — resolve-se na E26 (AplicacionPago para embarqueFob)
- **(E1)** Prorrateio de split multi-factura pode deixar resíduo USD 0,01 visível na vista (tolerância da action = 0.005) — edge raro, observar
- **(E1)** Ambiente local: `pdf-lib` faltava no node_modules (rodar `pnpm install` pós-PRs retención); pasta untracked `bmad-method/` polui `pnpm typecheck` local (CI não afetado)
- **(E3)** `flujo-caja.ts:101,119` filtra asientos por `asiento.moneda` — o flujo USD não verá os asientos novos (ARS c/ metadata) até a **E5**; até lá o flujo de caja USD mostra só legados. Confirmado pelo review adversarial; a E5 deve trocar o filtro para `monedaOrigen` por línea
- **(E3)** Pago USD multi-contrapartida com `appliedTo`: o `montoArs` da aplicación é comparado com `monto` (USD) no superRefine — semântica ambígua em pagos USD (já mapeado p/ E26; reforço)
- **(E3)** Gasto fijo USD não tem suite própria de testes (fix da conversão ARS coberto só pelo guard do motor + typecheck) — candidato a teste na E7 (smoke dos paths de pago) ou E14
