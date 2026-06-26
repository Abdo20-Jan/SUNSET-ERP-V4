# PR-016 — Fix CRIT-06: simulación Comex consome a função real (read-only)

**Branch:** `pr-016-fix-simulacion-rateio` · **Base:** `main` (`e8ee2e39`, inclui PR-014 #340)
**Onda:** PROTECTED ZONE (CRIT-04..09). Segue o protocolo **CRIT-04/05**: golden files PRIMEIRO, motor de
rateio do **despacho** byte-idêntico, e a ÚNICA mudança de comportamento permitida é a **simulación
alinhar-se à função real** (CRIT-06). Aprovação do dono (PO/Diretor) registrada nesta sessão.

> Refs: [[09_COMEX_RATEIO_DO_NOT_TOUCH]] (G-09), [[reports/CRITICAL_RULES_INVENTORY]] (CRIT-04/05/06/09),
> [[pages/CX-06_Comex_Costos_Rateio]].

---

## Correção da moldura da task (descoberta da auditoria)

A task original mandava a simulación consumir **`calcularCostoLandedDespacho`**. A auditoria mostrou que
esse é o motor do **domínio DESPACHO** (usa `costoFCUnitario`, TC de despacho separado, facturas DESPACHO)
— **outro domínio**. A regra real (CRIT-06 / CX-06 Q&A funcional #3) diz apenas: *"a simulación usa a
MESMA função real de cálculo; não há função separada; read-only"*, **sem nomear** uma função.

| Função | Domínio | Quem usa |
|---|---|---|
| `calcularCostoLandedDespacho` (`despacho-parcial.ts`) | DESPACHO parcial cruzado | `despachos.ts` (stock), `asiento-automatico.ts` (asiento) |
| `calcularRateioEmbarque` (`comex.ts`) | EMBARQUE (pré-importação) | `embarques.ts` (ingresso de stock REAL) **e** `calcularResumenSimulacion` |
| `calcularResumenSimulacion` (`simulacion-importacion.ts`) | Simulación (= embarque + créditos/margens) | form/detalhe da simulación |

O módulo `/comex/simulaciones` é **embarque-level**; seu serviço `calcularResumenSimulacion` **já consome**
o motor canônico correto (`calcularRateioEmbarque`, o mesmo do fluxo real de embarque). Logo o form/detalhe
**já eram** CRIT-06-compliant. O verdadeiro furo estava só em **`listarSimulaciones()`**.

**Decisão (aprovada):** rotear `listarSimulaciones()` por `calcularResumenSimulacion` e **NÃO** tocar
`calcularCostoLandedDespacho`/`despacho-parcial.ts`. Forçar a função de despacho exigiria fabricar inputs
de outro domínio e **perderia** flete/seguro origen, créditos fiscais e margens — distorcendo a simulación.

---

## O bug (CRIT-06)

`listarSimulaciones()` (linhas ~83-107, antigas) reimplementava um **agregado inline** do custo
nacionalizado, **sem chamar motor canônico** e com arredondamento **single-step** (um `round2` só no
final). O detalhe (`calcularResumenSimulacion`) arredonda **por parcela** (`round2` em FOB, cada tributo,
cada costo). Resultado: **lista e detalhe divergiam por centavos** para a mesma simulación → "simulação
diverge do efetivo".

### Evidência numérica (fixture do teste de regressão)
TC=1399.5; `die=tasa=arancel=0.01`; 1 custo logístico=0.01; FOB=1.00:

| | Antigo (lista, inline) | Canônico (detalhe / agora a lista) |
|---|---|---|
| Fórmula | `1399.5 + 0.01·1399.5 + 0.03·1399.5` (round final) | `round2(1399.50 + round2(13.995) + round2(round2(13.995)·3))` |
| `costoTotalNacionalizado` | **`1455.48`** | **`1455.50`** |

A regressão `test/listar-simulaciones.test.ts` falhava com `expected '1455.48' to be '1455.50'` **antes**
do fix e passa **depois** (lista == detalhe).

---

## Golden files PRIMEIRO (CRIT-05)

Travam a saída ATUAL byte a byte (`serializeGolden` → Decimal/Map → string, `toEqual`). Criados e
**verdes antes** de qualquer edição de produção. Como os motores não foram tocados, **continuam verdes
depois** — prova de byte-identidade.

| Arquivo | Trava | Prova |
|---|---|---|
| `test/golden-costo-landed-despacho.test.ts` | `calcularCostoLandedDespacho` (custo + porItem + Map) | **Despacho byte-idêntico** |
| `test/golden-rateio-embarque.test.ts` | `calcularRateioEmbarque` (motor que a simulación consome) | Motor de embarque intocado |
| `test/golden-resumen-simulacion.test.ts` | `calcularResumenSimulacion` (resultado completo: custo + créditos + margens) | Serviço da simulación intocado |
| `test/listar-simulaciones.test.ts` (integração) | invariante **lista == detalhe** | red→green da correção |
| `test/golden-serialize.ts` | helper de serialização (não-teste) | — |

**Asiento do despacho (byte-idêntico):** o caminho não é tocado; comprovado adicionalmente pelos testes de
integração já existentes (`asiento-despacho-cruzado.test.ts`, `despacho-cruzado-capitalizacion-stock.test.ts`)
e pelos validadores de invariantes (`db:validar-asientos`, `db:validar-stock`).

> Exemplo verbatim do DO_NOT_TOUCH travado no golden #1: FOB 70/30, capitalizáveis 20 → A=84000, B=36000,
> total 120000 (reconciliação ao centavo no último item).

---

## Mudança (a correção)

`src/lib/actions/simulaciones-importacion.ts`:
- **`listarSimulaciones()`**: deletado o agregado inline; agora monta `SimulacionInput` (helper puro
  `simulacionInputDeRegistro`, tudo como string igual ao detalhe) e chama `calcularResumenSimulacion`.
  - `fobTotal` ← `resumen.fobTotal.toFixed(2)`
  - `costoTotalNacionalizado` ← `resumen.costoTotalNacionalizadoArs.toFixed(2)` (agora == detalhe)
- Query: `include` (LISTA_INCLUDE) — já trazia os escalares; ajuste mínimo: `moneda` no `select` de `costos`.
- **Read-only:** continua sendo só uma query; **não** persiste asiento/movimento/stock.
- **UI sem mudança:** `simulaciones-table.tsx` lê os mesmos campos (`fobTotal`, `costoTotalNacionalizado`);
  `page.tsx` só repassa as rows.

**Mudança de output documentada:** onde a lista divergia do detalhe por arredondamento, agora exibe o custo
nacionalizado canônico (idêntico ao detalhe). Diferença típica ≤ ~0,02 ARS por simulación com TC decimal.

---

## Garantia byte-idêntica (despacho)

`calcularCostoLandedDespacho` e seus callers (`despachos.ts`, `asiento-automatico.ts`, `stock.ts`),
`calcularRateioEmbarque` e `calcularResumenSimulacion` **não foram editados**. Golden #1-3 + suíte Comex +
validadores comprovam que custo, asiento e estoque do despacho permanecem byte-idênticos.

## Não-objetivos
Não alterou lógica/fatores/base/arredondamento do rateio; nada de persistência nova na simulación; nada de
schema/migrations/auth/permissões; nada de outros motores (posting/inventário/margem); nenhuma página não
relacionada; nenhum botão "Simular" novo na ficha de despacho.

## Validação
`pnpm prisma generate · typecheck · build · biome:ci · test` + `db:validar-asientos` · `db:validar-stock`.
