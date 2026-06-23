# 08 — Mapa de Proteção da Lógica de Negócio

> **Princípio absoluto (ANEXO C / G-09 / CRIT-04..09):** Backend e motores de cálculo **preservados**. Este trabalho é **UI/UX apenas**. Nenhum arquivo abaixo deve ser modificado em sua lógica sem o protocolo de aprovação (PO + Diretor + spec + golden files + code review). A UI **chama** os serviços/actions existentes; nunca recalcula.

## Zonas protegidas

### 1. 🔴 Comex — Rateio / Landed Cost (G-09 / CRIT-04..09)
- **Arquivos:** [despacho-parcial.ts](../../src/lib/services/despacho-parcial.ts), [contenedor.ts](../../src/lib/services/contenedor.ts), [comex.ts](../../src/lib/services/comex.ts), [desconsolidacion.ts](../../src/lib/services/desconsolidacion.ts), [embarque-zpa.ts](../../src/lib/services/embarque-zpa.ts), [simulacion-importacion.ts](../../src/lib/services/simulacion-importacion.ts), [divergencia-investigacion.ts](../../src/lib/services/divergencia-investigacion.ts).
- **O que faz:** rateio proporcional FOB/base FC por peças, arredondamento no último item (fecha 100%), custo contábil (sem IVA) vs gerencial (com IVA, valora estoque), despacho parcial/cruzado.
- **Testes atuais:** `costo-landed-despacho`, `despacho-parcial`, `capitaliza-vs-gasto`, `crear-costo-despacho-cruzado`, `despacho-cruzado-capitalizacion-stock`, `anular-despacho-cruzado`, `cerrar-costos-contenedor`, `validar-invariantes-comex`, `asiento-comex`, `arribo-comex`, `comex-revertir-zp-guard`.
- **Do-not-touch:** função/fatores/base/algoritmo de arredondamento. Simulação = **MESMA função real** (CRIT-06), read-only. Δ > USD 0,01 bloqueia fechamento (CRIT-07).
- **Regressão antes de UI:** **golden files** (memória, custo contábil/gerencial, asiento, entrada de estoque idênticos) — **CRIT-05, obrigatório antes de CX-05/CX-06**.

### 2. 🔴 Margem de Vendas / CMV (G-10 / CRIT-01..03)
- **Arquivos:** [stock.ts](../../src/lib/services/stock.ts), [backfill-cmv.ts](../../src/lib/services/backfill-cmv.ts), [asiento-automatico.ts](../../src/lib/services/asiento-automatico.ts) (motor, ~maior arquivo), `venta-split-categoria` (split Ventas/CMV por categoria).
- **O que faz:** custo unitário CMV, margem = (preço líq. − custo autorizado)/preço; split de venda/CMV.
- **Testes atuais:** `backfill-cmv`, `cmv-puente-entrega-cierre`, `venta-split-categoria`, `venta-costo-cero-guard`, `venta-flete-gasto`.
- **Do-not-touch:** cálculo de custo/margem. A UI **exibe** margem por item+total %/valor, **oculta por permissão** (não recalcula, não inventa custo).
- **Regressão antes de UI:** teste "vendedor sem permissão não recebe custo/margem no payload" + valores de margem inalterados.

### 3. 🔴 Valoração de Estoque / Stock por despacho-lote (CRIT-09)
- **Arquivos:** [stock.ts](../../src/lib/services/stock.ts), [stock-recalc.ts](../../src/lib/services/stock-recalc.ts), [stock-helpers.ts](../../src/lib/services/stock-helpers.ts), [embarque-zpa.ts](../../src/lib/services/embarque-zpa.ts).
- **O que faz:** stock dual (nacional/zona primária), FIFO por despacho, recálculo/replay.
- **Testes atuais:** `stock-recalc-replay`, `stock-replay-transferencia`, `stock-aduanero-segmentado`, `compra-estoque`, `anular-transferencia-recalc`, `transferencia-bloquea-zona-primaria`.
- **Do-not-touch:** FIFO/valoração/replay. INV-01/02 só **exibe** colunas (custo por permissão).

### 4. 🔴 Motor Contábil / Plano de Contas ULTRA (CRIT-14 / OD-14)
- **Arquivos:** [asiento-automatico.ts](../../src/lib/services/asiento-automatico.ts), [cuenta-auto.ts](../../src/lib/services/cuenta-auto.ts), [cuenta-registry.ts](../../src/lib/services/cuenta-registry.ts), [plan-de-cuentas.ts](../../src/lib/services/plan-de-cuentas.ts), [prefijos-plan.ts](../../src/lib/services/prefijos-plan.ts), [cuenta-naturaleza.ts](../../src/lib/services/cuenta-naturaleza.ts), [balance-sumas-saldos.ts](../../src/lib/services/balance-sumas-saldos.ts).
- **O que faz:** geração automática de asientos, registry do plano ULTRA (9 classes), naturaleza, balance.
- **Testes atuais:** `plan-de-cuentas`, `guard-registry-plan`, `cuenta-naturaleza`, `balance-naturaleza-regularizadora`, `balance-rubro-eecc`, `balance-reclasificar-saldos-a-favor`, `anular-asiento-guard`, `periodos-admin-guard`.
- **Do-not-touch:** **usar sempre refs simbólicas do registry ULTRA**, nunca códigos v4.1 literais (OD-14). CONT-01/02/03/04 e CX-06 só exibem.

### 5. 🔴 Tesouraria / Finanças (separação C.4 #7)
- **Arquivos:** [cuentas-a-pagar.ts](../../src/lib/services/cuentas-a-pagar.ts), [cuentas-a-cobrar.ts](../../src/lib/services/cuentas-a-cobrar.ts), [prestamo.ts](../../src/lib/services/prestamo.ts), [historico-pagos.ts](../../src/lib/services/historico-pagos.ts), [extracto-bancario.ts](../../src/lib/services/extracto-bancario.ts), [extracto-parser.ts](../../src/lib/services/extracto-parser.ts), `actions/anticipos-proveedor.ts`, `actions/movimientos-tesoreria.ts`.
- **Testes atuais:** `anticipo-proveedor-*`, `pago-exterior-action`, `historico-pagos`(via actions), `extracto-aprobar-linea-tc`.
- **Do-not-touch:** **Finanças programa, Tesouraria executa**; toda baixa vem da Tesouraria. UI respeita a separação.

### 6. 🔴 Moeda / Política USD (CRIT-13 / OD-13)
- **Arquivos:** [reportes/revaluacion.ts](../../src/lib/services/reportes/revaluacion.ts), [reportes/shared.ts](../../src/lib/services/reportes/shared.ts), diferença cambiária nas actions de tesouraria, `guard-tipocambio-usd`.
- **Testes atuais:** `diferencia-cambiaria-fase2/intermediario/multi`, `revaluacion`, `balance-sumas-saldos-usd`, `saldos-exterior-usd`, `guard-tipocambio-usd`, `tesoreria-usd-libro-ars`.
- **Do-not-touch:** apresentação USD ao **TC de fechamento** + diferença cambial em linha; moeda nativa na partida. **11 TC = legado** (não implementar).

### 7. 🔴 Permissões / Auth
- **Arquivos:** [auth.ts](../../src/lib/auth.ts), [auth.config.ts](../../src/lib/auth.config.ts), [auth-guard.ts](../../src/lib/auth-guard.ts).
- **Testes atuais:** `auth-guard`, `auth-config-authorized`, `periodos-admin-guard`.
- **Nota:** esta zona **será estendida** (não substituída) na fundação de permissão (PR-005) — preservar os guards atuais e o padrão de revalidar role na DB.

### 8. 🟠 Emissão de Documentos / Relatórios
- **Arquivos:** [certificado-retencion.ts](../../src/lib/services/certificado-retencion.ts) (pdf-lib), [reportes/](../../src/lib/services/reportes/) (balance-general, estado-resultados-rt9, flujo-caja, libro-diario, libro-mayor), `api/retenciones/[id]/certificado/route.ts`, `api/comex/divergencia/upload/route.ts`.
- **Testes atuais:** `estado-resultados-rt9`, `flujo-caja`, `flujo-caja-config`, `salud-balancete`.
- **Do-not-touch:** geração dos números/relatórios. UI adiciona **permissão de export + auditoria** por cima.

## Regras do-not-touch (resumo)
1. Não refatorar cálculos: rateio, custo contábil/gerencial, FIFO de despacho, CMV, revaluação, asientos.
2. Comex rateio intocável → **golden tests antes** de qualquer UI de custo.
3. Auditoria imutável e permanente.
4. Permissão no FE **e** BE.
5. Refs simbólicas do registry ULTRA (nunca v4.1).
6. Apresentação USD ao TC de fechamento.

## Testes de regressão necessários antes de tocar UI sensível
| Antes de mexer em… | Teste mínimo |
|---|---|
| CX-05 / CX-06 (custo/rateio) | **golden files** de memória/custo/asiento/estoque (CRIT-05) + `validar-invariantes-comex` verde |
| COM-02/03/04 (margem) | margem inalterada + payload sem custo p/ vendedor sem permissão |
| INV-01/02 | valores de estoque inalterados (`stock-recalc-replay`) |
| CONT-* | asientos/balance inalterados (`balance-*`, `plan-de-cuentas`, `guard-registry-plan`) |
| Tesouraria | `anticipo-*`, `pago-exterior-action`, `tesoreria-usd-libro-ars` verdes |
| Qualquer página com USD | `revaluacion`, `*usd*` verdes |

> A suíte atual (~80 specs) é o **escudo de regressão** durante a reconstrução de UI: rodar `pnpm test` (e `pnpm test:e2e` quando tocar Comex/contábil) deve permanecer 100% verde em cada PR.
