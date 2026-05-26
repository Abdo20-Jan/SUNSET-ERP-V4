# Fluxo de Zona Primária — Contenedores, Desconsolidación e Despacho Cruzado

Este documento descreve o desenho **Comex ZPA** (zona primária aduaneira) do Sunset ERP v4: o
ciclo físico-aduaneiro de um **contenedor** desde a fábrica até a nacionalização, os asientos
contábeis de cada transição, o despacho parcial cruzado (por `itemContenedor`) e a investigação
formal de divergência (D9).

Toda essa funcionalidade vive atrás da feature flag **`CONTENEDOR_DESCONSOLIDACION_ENABLED`**
([`src/lib/features.ts:88`](../src/lib/features.ts#L88)). As tabelas são **aditivas** e ficam
órfãs (rollback = `DROP` seguro) enquanto a flag está `off`. O fluxo legacy de embarque
(monolítico / modular por `itemEmbarque`) está documentado em sua própria seção do código e
**convive** com este; o despacho cruzado é o caminho novo quando a flag está ligada.

> **Convenção de moeda:** todos os asientos são em ARS. Custos de mercadoria são valuados via
> `costoFCUnitario` (USD, 4 decimais) × `tipoCambio` do embarque. Tributos do despacho usam o TC
> **oficializado** do despacho (que pode diferir do TC do embarque).

---

## Plano de contas (subcontas de Bienes de Cambio)

Definição em [`COMEX_ZPA_CODIGOS`](../src/lib/services/cuenta-registry.ts#L286) e
[`EMBARQUE_CODIGOS`](../src/lib/services/cuenta-registry.ts#L171). Cuentas criadas lazy via
`getOrCreateCuenta` na primeira utilização.

| Código | Nome | Papel no fluxo |
|---|---|---|
| `1.1.5.01` | MERCADERÍAS | Mercadoria **nacionalizada**, em depósito, disponível para venda |
| `1.1.5.02` | MERCADERÍAS EN TRÁNSITO | Custo em trânsito (FOB + origem + ZP) — **preservada** do fluxo legacy |
| `1.1.5.04` | MERCADERÍAS EN ZONA PRIMARIA ADUANERA | Mercadoria chegada ao porto/ZPA, ainda não nacionalizada |
| `1.1.5.05` | MERCADERÍAS EN DEPÓSITO FISCAL | Mercadoria trasladada ao depósito fiscal (DF) |
| `5.9.2.01` | PÉRDIDAS LOGÍSTICAS Y FALTANTES DE INVENTARIO | D9 — falta sem responsável (perda) |
| `4.9.1.01` | INGRESOS POR DIFERENCIA DE INVENTARIO | D9 — sobra sem responsável (ingresso) |

As novas subcontas (`1.1.5.04`, `1.1.5.05`) foram inseridas em um range "vago" do plano,
**preservando** a `1.1.5.02` EN TRÁNSITO já usada pelo legacy (ver ADR D5).

### Helpers de asiento (subcontas)

[`crearAsientoTransferenciaSubcuenta`](../src/lib/services/asiento-automatico.ts#L1436) gera os
asientos de **transferência de custo entre subcontas** segundo o `flujo`
([`FlujoSubcuentaComex`](../src/lib/services/asiento-automatico.ts#L1390)):

| Flujo | DEBE | HABER | Quando |
|---|---|---|---|
| `ARRIBO_ZONA_PRIMARIA` | `1.1.5.04` | `1.1.5.02` | Chegada ao porto (tránsito → ZPA) |
| `TRASLADO_DEPOSITO_FISCAL` | `1.1.5.05` | `1.1.5.04` | Traslado ZPA → DF |
| `NACIONALIZACION_VIA_DF` | `1.1.5.01` | `1.1.5.05` | Nacionalização desde o DF |
| `NACIONALIZACION_DIRECTA` | `1.1.5.01` | `1.1.5.04` | Nacionalização direta no porto (sem DF) |

> **Incerteza (verificada no código):** dos quatro flujos definidos, apenas
> `TRASLADO_DEPOSITO_FISCAL` (usado por [`desconsolidar`](../src/lib/services/desconsolidacion.ts#L99))
> e `NACIONALIZACION_VIA_DF` (usado por
> [`crearAsientoDespachoCruzado`](../src/lib/services/asiento-automatico.ts#L2031)) estão de fato
> cabeados em serviços/actions hoje. `ARRIBO_ZONA_PRIMARIA` e `NACIONALIZACION_DIRECTA` existem no
> helper e nos testes, mas **ainda não têm uma action/serviço que os dispare** (grep só os encontra
> em `asiento-automatico.ts`). Os Workflows 1-passo-chegada e 2 abaixo descrevem o asiento que o
> helper produz; o gatilho operacional (transição de estado do contenedor que chama o helper)
> ainda não está implementado no momento desta documentação.

---

## Máquina de estados do `Contenedor`

Enum [`ContenedorEstado`](../prisma/schema.prisma#L217). O estado do contenedor reflete tanto a
posição física-aduaneira quanto o progresso de despacho.

```
                         BORRADOR
                            │ (packing list / dados de carga)
                            ▼
                       EN_TRANSITO
                            │ (chegada ao porto)
                            ▼
                     ARRIBADO_PUERTO
                            │ (ingresso ZPA)  ── asiento ARRIBO_ZONA_PRIMARIA
                            ▼                     DEBE 1.1.5.04 / HABER 1.1.5.02
                    EN_ZONA_PRIMARIA
                   ╱                ╲
   (traslado DF)  ╱                  ╲  (nacionalização direta no porto)
                 ▼                    ▼  asiento NACIONALIZACION_DIRECTA
   TRASLADO_DEPOSITO_FISCAL      NACIONALIZADO_DIRECTO   DEBE 1.1.5.01 / HABER 1.1.5.04
                 │
                 ▼
        EN_DEPOSITO_FISCAL
                 │ desconsolidar()  (conferência física)
        ┌────────┴───────────┐
        │ físico = declarado │ físico ≠ declarado
        ▼                    ▼
   DESCONSOLIDADO     AGUARDANDO_INVESTIGACAO ──(concluir D9)──► DESCONSOLIDADO
   asiento TRASLADO_DF        (asiento de traslado e stock BLOQUEADOS no gate)
   (DEBE 1.1.5.05 /
    HABER 1.1.5.04)
        │
        │ despacho cruzado (recomputarEstadoContenedor)
   ┌────┴─────────────────┐
   ▼                      ▼
PARCIALMENTE_DESPACHADO  TOTALMENTE_DESPACHADO

  CANCELADO  ← cancelamento administrativo (fora dos estados de ciclo de despacho)
```

> **Nota sobre `recomputarEstadoContenedor`** (PR 4.4,
> [`despacho-parcial.ts:345`](../src/lib/services/despacho-parcial.ts#L345)): só transiciona entre
> `DESCONSOLIDADO`, `PARCIALMENTE_DESPACHADO` e `TOTALMENTE_DESPACHADO` (set
> `ESTADOS_CICLO_DESPACHO`). Outros estados (`AGUARDANDO_INVESTIGACAO`, `EN_DEPOSITO_FISCAL`,
> `CANCELADO`) **não** são pisados (ver ADR D7).

---

## Modelos Prisma (núcleo)

| Modelo | Linha | Papel |
|---|---|---|
| [`Contenedor`](../prisma/schema.prisma#L837) | 837 | Contenedor físico (uuid) dentro de um embarque; carrega estado + datas + depósitos + precintos |
| [`ItemContenedor`](../prisma/schema.prisma#L885) | 885 | Linha do packing list (SKU × contenedor); carrega os **counters** do modelo lazy |
| [`Desconsolidacion`](../prisma/schema.prisma#L926) | 926 | Evento 1:1 com o contenedor; header da conferência física |
| [`DivergenciaInvestigacion`](../prisma/schema.prisma#L1024) | 1024 | Investigação D9, 1:1 com a desconsolidación |
| [`DivergenciaItem`](../prisma/schema.prisma#L1059) | 1059 | Detalhe por SKU (físico vs declarado + valor impactado USD) |
| [`DespachoBorrador`](../prisma/schema.prisma#L1004) | 1004 | Borrador server-side do despacho cruzado; persiste `payloadDiff` + `countsTrabados` |
| [`ItemDespacho`](../prisma/schema.prisma#L794) | 794 | Linha de despacho; `contenedorId`/`itemContenedorId` = linha **cruzada**; ambos null = **legacy** |
| [`VepDespacho`](../prisma/schema.prisma#L1608) | 1608 | Volante Electrónico de Pago (1:1 com despacho); agrupa tributos aduaneiros |
| [`UnidadInventario`](../prisma/schema.prisma#L954) | 954 | Unidade individual (D1-bis); **schema criado, tabela vazia em prod** (lazy) |

### Counters do `ItemContenedor`

O dia a dia opera sobre três contadores inteiros, sem materializar `UnidadInventario`:

```
cantidadDisponible + cantidadEnDespacho + cantidadDespachada == cantidadFisica
```

Invariante validada (post-desconsolidación). `cantidadDeclarada` é o packing list; `cantidadFisica`
é o que a conferência registrou.

---

## Workflow 1 — Importação via Depósito Fiscal

Fluxo completo: **fábrica → porto → ZPA → DF → desconsolidación → despacho/nacionalização**.

```
1. CRIAR CONTENEDOR + PACKING LIST                    estado: BORRADOR
   crearContenedorAction / actualizarPackingListAction
   → ItemContenedor por SKU (cantidadDeclarada)
   → optimistic locking por ItemContenedor.version (P0-3)

2. EN_TRANSITO → ARRIBADO_PUERTO → EN_ZONA_PRIMARIA   (transições físicas)
   Chegada ao porto / ingresso ZPA.
   Asiento de arribo (flujo ARRIBO_ZONA_PRIMARIA):
       DEBE  1.1.5.04 Mercaderías en Zona Primaria   (costo em trânsito)
       HABER 1.1.5.02 Mercaderías en Tránsito         (mesmo)

3. EN_ZONA_PRIMARIA → TRASLADO_DEPOSITO_FISCAL → EN_DEPOSITO_FISCAL
   Traslado físico ao depósito fiscal.

4. DESCONSOLIDAR (desconsolidar())                    EN_DEPOSITO_FISCAL → DESCONSOLIDADO
   - Conferência física: cantidadFisica por SKU.
   - Grava cantidadFisica em TODOS os ItemContenedor.
   - SE físico == declarado em todos os SKU:
       → counters: cantidadDisponible := cantidadFisica
       → MovimientoStock INGRESO consolidado por SKU
       → asiento de traslado (flujo TRASLADO_DEPOSITO_FISCAL):
             DEBE  1.1.5.05 Mercaderías en Depósito Fiscal
             HABER 1.1.5.04 Mercaderías en Zona Primaria
       → estado DESCONSOLIDADO
   - SE físico != declarado em algum SKU (gate D9):
       → estado AGUARDANDO_INVESTIGACAO
       → asiento e stock BLOQUEADOS (ver Workflow 4)

5. DESPACHAR (despacho cruzado)                       → PARCIALMENTE / TOTALMENTE_DESPACHADO
   Nacionalização desde o DF (ver Workflow 3).
   Asiento de nacionalização (flujo NACIONALIZACION_VIA_DF):
       DEBE  1.1.5.01 Mercaderías
       HABER 1.1.5.05 Mercaderías en Depósito Fiscal
   + linhas de tributos / créditos + VEP.
```

**Serviço-chave:** [`desconsolidar`](../src/lib/services/desconsolidacion.ts#L99). É atômico (D4):
ou grava counters + stock + asiento, ou bloqueia tudo no gate de divergência. O `MovimientoStock`
de ingresso é **consolidado por SKU** (não por unidade — modelo lazy D1-bis).

---

## Workflow 2 — Nacionalização direta no porto (sem Depósito Fiscal)

Quando não há passagem por DF, a mercadoria é nacionalizada direto desde a ZPA.

```
EN_ZONA_PRIMARIA ──(nacionalização)──► NACIONALIZADO_DIRECTO
   Asiento (flujo NACIONALIZACION_DIRECTA):
       DEBE  1.1.5.01 Mercaderías
       HABER 1.1.5.04 Mercaderías en Zona Primaria
```

Mesma mecânica do Workflow 1, **pulando** as etapas 3-4 (traslado DF + desconsolidación). A subconta
de origem da nacionalização é `1.1.5.04` em vez de `1.1.5.05`.

> **Incerteza:** ver a nota na seção "Helpers de asiento" — o flujo `NACIONALIZACION_DIRECTA` está
> definido no helper mas ainda não tem gatilho de action/serviço cabeado. Este workflow descreve o
> asiento-alvo do desenho; a transição operacional para `NACIONALIZADO_DIRECTO` ainda não está
> implementada no momento desta documentação.

---

## Workflow 3 — Despacho parcial cruzado

O despacho cruzado consome porções de **`itemContenedor`** (não de `itemEmbarque`), permitindo
nacionalizar por lote/contenedor. Fluxo: **borrador → trava counters single-shot → contabilizar →
asiento + VEP**, com anulação reversível e cron de cleanup de borradores vencidos.

Serviço: [`despacho-parcial.ts`](../src/lib/services/despacho-parcial.ts). Actions:
[`despachos.ts`](../src/lib/actions/despachos.ts).

```
1. crearBorrador()                          DespachoBorrador EN_EDICION → CONFIRMADO_TRABA_COUNTS
   - Consolida linhas por itemContenedorId (ordenadas por id → evita deadlock).
   - Para cada linha: decrementarDisponibleSingleShot(... "EN_DESPACHO")
       UPDATE ItemContenedor
         SET cantidadDisponible -= q, cantidadEnDespacho += q
         WHERE id = ? AND cantidadDisponible >= q
       → 0 filas afetadas = SALDO_INSUFICIENTE (≈409) — oversell evitado.
   - Persiste countsTrabados (JSON) p/ reversão exata na expiração.

2. contabilizarBorrador() / contabilizar despacho     Despacho → CONTABILIZADO
   - crearAsientoDespachoCruzado:
       DEBE  1.1.5.01 Mercaderías     (costoFCUnitario × cantidad × TC embarque)
       HABER 1.1.5.05 Mercaderías en Depósito Fiscal   (mesmo — flujo NACIONALIZACION_VIA_DF)
       + tributos (DIE/Tasa/Arancel) e créditos (IVA/IIBB/Ganancias)
       + pasivos Aduana
   - materializarDespachoCruzado: counter cantidadEnDespacho → cantidadDespachada;
     MovimientoStock; recomputarEstadoContenedor (PARCIALMENTE / TOTALMENTE_DESPACHADO).
   - crearOActualizarVepDespacho: VEP 1:1 com a soma dos tributos em ARS (TC do despacho).

3. ANULAR despacho                                    Despacho → ANULADO
   - Reverte counters e MovimientoStock.
   - VepDespacho marcado ANULADO (não eliminado — preserva trail).
   - Recomputa estado do contenedor.
```

### Trava single-shot (`EN_DESPACHO`)

A defesa contra oversell **não** usa lock pessimista: é um `UPDATE` condicional único
([`decrementarDisponibleSingleShot`](../src/lib/services/despacho-parcial.ts#L446)). Se `0` filas
forem afetadas, o saldo era insuficiente → erro `SALDO_INSUFICIENTE`. Ver ADR D8.

### VEP (Volante Electrónico de Pago)

[`crearOActualizarVepDespacho`](../src/lib/actions/despachos.ts#L865): relação **1:1** com o
despacho. `montoTotal` = DIE + Tasa + Arancel + IVA + IVA Adic. + IIBB + Ganancias, × TC do
despacho. Estado `GENERADO → PAGADO` (via `pagarVepDespachoAction`, Tesorería) ou `VENCIDO`.
Idempotente: re-contabilizar atualiza o `montoTotal` do VEP em `GENERADO` (upsert).

### Cron de cleanup de borradores vencidos

[`/api/cron/cleanup-despachos-borrador`](../src/app/api/cron/cleanup-despachos-borrador/route.ts)
roda diariamente (`vercel.json`: `0 3 * * *`), autenticado por `Authorization: Bearer ${CRON_SECRET}`.
Chama [`expirarBorradoresVencidos`](../src/lib/services/despacho-parcial.ts). A expiração (P0-4) é
single-shot: marca `EXPIRADO` (`updateMany ... WHERE estadoActual != EXPIRADO`) **antes** de liberar
os counters trabados (`countsTrabados`), garantindo idempotência — se `count === 0`, outra transação
já liberou.

> **Nota:** no plano Hobby do Vercel o cron é diário (não há cadência sub-diária). O TTL do borrador
> (`expiresAt`) é definido em `crearBorrador` via `BORRADOR_TTL_MS`.

---

## Workflow 4 — Divergência formal (D9)

Quando a conferência física diverge do declarado, **não** se faz ajuste mecânico: abre-se uma
**investigação** com tratamento contábil dependente da causa-raíz. Serviço:
[`divergencia-investigacion.ts`](../src/lib/services/divergencia-investigacion.ts).

```
desconsolidar() detecta físico ≠ declarado
        │
        ▼
AGUARDANDO_INVESTIGACAO   (asiento de traslado + stock ficam BLOQUEADOS)
        │  abrirInvestigacion()  → DivergenciaInvestigacion EM_ANALISE (+ DivergenciaItem por SKU)
        │  registrarConferenciaFisica()  → peso real, lacres, evidências
        │  diagnosticarCausa()  → causa-raíz + responsável (validação de coerência)
        ▼
concluirInvestigacion()
   - netoUSD = Σ valorImpactadoUSD;  montoARS = |netoUSD| × TC embarque
   - tipo = netoUSD < 0 ? FALTA : SOBRA
   - ubicacion = DF se há depositoFiscalId, senão ZONA_PRIMARIA
   - crearAsientoDivergencia (asiento de ajuste)
   - estado CONCLUIDA;  contenedor → DESCONSOLIDADO
```

### Asiento de ajuste por causa
([`crearAsientoDivergencia`](../src/lib/services/asiento-automatico.ts#L1512)). A subconta de stock
é `1.1.5.05` (DF) ou `1.1.5.04` (ZPA) conforme `ubicacion`.

| Caso | DEBE | HABER |
|---|---|---|
| **SOBRA** | subconta stock (`1.1.5.04`/`1.1.5.05`) | `4.9.1.01` Ingresos por diferencia |
| **FALTA** sem responsável (`NAO_IDENTIFICADA`) | `5.9.2.01` Pérdidas logísticas | subconta stock |
| **FALTA** com responsável | `cuentaPorCobrarId` (a cobrar) | subconta stock |

> **Incerteza / desvio do plano:** a linha "a cobrar" da falta com responsável **não** é uma conta
> fixa `1.1.2.x` — o serviço exige um `cuentaPorCobrarId` passado pelo caller
> ([`crearAsientoDivergencia`](../src/lib/services/asiento-automatico.ts#L1571)). Em
> `concluirInvestigacion`, esse parâmetro é obrigatório quando `tipo === FALTA` e a causa ≠
> `NAO_IDENTIFICADA` (erro `CUENTA_REQUERIDA`). A `1.1.2.x` é a categoria contábil esperada para
> créditos a cobrar, mas o código não a hardcoda.

### Diagnóstico de causa (validações)
[`diagnosticarCausa`](../src/lib/services/divergencia-investigacion.ts#L213) valida coerência
causa↔responsável (`RESP_ESPERADA`):
- `DEPOSITARIO` exige responsável (não `NENHUM`).
- `SINISTRO_SEGURADO` exige `polizaSeguro`.
- Enums: [`DivergenciaCausa`](../prisma/schema.prisma#L256), [`DivergenciaResp`](../prisma/schema.prisma#L264).

---

## ADRs (decisões de desenho)

Formato curto: **decisão / contexto / consequência**.

### D1-bis — `UnidadInventario` lazy/dormente (recall adiado)
- **Decisão:** o schema de `UnidadInventario` é criado, mas a **tabela fica vazia em prod**. O dia a
  dia opera sobre os counters de `ItemContenedor`. Materialização on-demand via helper futuro
  (`materializarUnidades`), governada pela flag `UNIDAD_INVENTARIO_TRACKING_ENABLED`.
- **Contexto:** rastreio por unidade individual só é necessário para recall/garantia — recurso
  adiado para "muito futuramente". Materializar N unidades por item seria custoso sem demanda.
- **Consequência:** stock e despachos operam por contador (inteiro), não por unidade. O campo `dot`
  fica reservado para carga manual futura (garantia/sinistro), não coletado hoje. Schema pronto
  permite ligar o recall sem migração disruptiva.

### D2 — Counters em `ItemContenedor`
- **Decisão:** três contadores (`cantidadDisponible`, `cantidadEnDespacho`, `cantidadDespachada`) na
  linha do packing list, com invariante `disponible + enDespacho + despachada == cantidadFisica`.
- **Contexto:** consequência direta de D1-bis — sem unidades materializadas, o saldo despachável
  precisa de um agregado por SKU×contenedor.
- **Consequência:** transições de despacho são `UPDATE` de inteiros (baratos, atômicos). O estado do
  contenedor é **recomputado** a partir desses counters (ver D7).

### D3 — Custo FC fechado no gate de custos
- **Decisão:** `costoFCUnitario` (USD, 4 decimais) é populado ao fechar custos do contenedor (via
  `calcularRateioZonaPrimaria`). A nacionalização exige `costoFCUnitario != null`.
- **Contexto:** o asiento de nacionalização precisa de um custo unitário estável para valuar a
  transferência de subconta.
- **Consequência:** [`crearAsientoDespachoCruzado`](../src/lib/services/asiento-automatico.ts#L2031)
  lança `DOMINIO_INVALIDO` se o item não tem FC ("cerrá costos antes de nacionalizar"). 4 decimais
  alinham com `precioUnitario`.

### D4 — Desconsolidación atômica
- **Decisão:** [`desconsolidar`](../src/lib/services/desconsolidacion.ts#L99) é uma transação única:
  ou aplica counters + `MovimientoStock` consolidado + asiento de traslado, ou bloqueia tudo no gate
  de divergência. Só desde `EN_DEPOSITO_FISCAL`; idempotente contra re-desconsolidación.
- **Contexto:** evita estados parciais (stock movido sem asiento, etc.).
- **Consequência:** `MovimientoStock` de ingresso é **consolidado por SKU** (não por unidade,
  coerente com D1-bis). Divergência → `AGUARDANDO_INVESTIGACAO` sem efeito contábil/estoque.

### D5 — Subcontas contábeis novas preservando `1.1.5.02`
- **Decisão:** adicionar `1.1.5.04` (ZONA PRIMARIA) e `1.1.5.05` (DEPÓSITO FISCAL) num range vago,
  **mantendo** `1.1.5.02` EN TRÁNSITO já usada pelo legacy. Transferências entre subcontas via
  [`crearAsientoTransferenciaSubcuenta`](../src/lib/services/asiento-automatico.ts#L1436).
- **Contexto:** o fluxo ZPA precisa rastrear a mercadoria em cada estação aduaneira sem quebrar o
  fluxo de embarque legacy que já contabiliza em `1.1.5.02`/`1.1.5.01`.
- **Consequência:** os dois paradigmas convivem; o custo "viaja" 1.1.5.02 → 04 → 05 → 01 (ou
  04 → 01 direto). Cuentas criadas lazy via `getOrCreateCuenta`.

### D6 — Grão do despacho cruzado por `itemContenedorId` (índices parciais + CHECK)
- **Decisão:** `ItemDespacho` ganha `contenedorId`/`itemContenedorId` nullable. Linha **legacy** =
  ambos `null` (1 por `(despacho, itemEmbarque)`); linha **cruzada** = ambos setados (N por
  `itemEmbarque`, uma por `itemContenedor`). Unicidade implementada como **dois índices PARCIAIS**
  em SQL raw + CHECK `((contenedorId IS NULL) = (itemContenedorId IS NULL))`.
- **Contexto:** `@@unique` do Prisma não suporta `WHERE`; precisa-se de regras distintas para legacy
  vs cruzado e de coerência entre as duas FKs.
- **Consequência:** split por lote/contenedor possível; legacy e cruzado coexistem na mesma tabela
  sem colisão. Índices parciais em [`prisma/add-partial-indexes-despacho.ts`](../prisma/add-partial-indexes-despacho.ts).

### D7 — Estado do `Contenedor` recomputado por counters
- **Decisão:** [`recomputarEstadoContenedor`](../src/lib/services/despacho-parcial.ts#L345) deriva o
  estado de despacho dos counters: sem despachado → `DESCONSOLIDADO`; com saldo → `PARCIALMENTE_DESPACHADO`;
  saldo zero → `TOTALMENTE_DESPACHADO`. Só transiciona dentro de `ESTADOS_CICLO_DESPACHO`.
- **Contexto:** o estado é uma projeção dos counters; mantê-lo manual divergiria da realidade.
- **Consequência:** idempotente (só escreve se mudou). **Não** pisa `AGUARDANDO_INVESTIGACAO`,
  `EN_DEPOSITO_FISCAL` nem `CANCELADO` — estados fora do ciclo de despacho são preservados.

### D8 — Trava single-shot (`UPDATE` condicional) para bloqueio `EN_DESPACHO`
- **Decisão:** a reserva de saldo no borrador é um `UPDATE ... WHERE cantidadDisponible >= q` único
  (sem lock pessimista). `0` filas → `SALDO_INSUFICIENTE`. Counters trabados persistidos em
  `DespachoBorrador.countsTrabados` para reversão exata.
- **Contexto:** sob concorrência, dois borradores poderiam vender o mesmo saldo. Lock pessimista
  seria caro e propenso a deadlock.
- **Consequência:** oversell impossível por construção do `WHERE`. Linhas ordenadas por `id` para
  evitar deadlock entre transações. Expiração (P0-4) também é single-shot (marca `EXPIRADO` antes de
  liberar). Optimistic locking adicional via `version` (P0-3 no `ItemContenedor`; borrador também).

### D9 — Divergência como investigação (não ajuste mecânico)
- **Decisão:** físico ≠ declarado abre [`DivergenciaInvestigacion`](../prisma/schema.prisma#L1024)
  (1:1 com a desconsolidación). Ciclo `EM_ANALISE → CONCLUIDA | ARQUIVADA`. O asiento de ajuste
  depende da **causa-raíz** e do **sentido** (FALTA/SOBRA): perda (`5.9.2.01`), sobra (`4.9.1.01`),
  ou a cobrar (`cuentaPorCobrarId` do responsável).
- **Contexto:** uma diferença pode ter tratamentos contábeis distintos (perda, ganho, crédito contra
  fornecedor/transportador/seguradora). Ajuste automático mascararia responsabilidade.
- **Consequência:** o contenedor fica `AGUARDANDO_INVESTIGACAO` com asiento/estoque **bloqueados**
  até concluir. Valuação USD→ARS pelo TC do embarque. Validação de coerência causa↔responsável em
  `diagnosticarCausa`. A `cuentaPorCobrarId` é exigida (não hardcodada) — ver incerteza no Workflow 4.

---

## Onde encontrar cada coisa

| Pergunta | Local |
|---|---|
| Enum de estados do contenedor | [`ContenedorEstado`](../prisma/schema.prisma#L217) |
| Counters e invariante | [`ItemContenedor`](../prisma/schema.prisma#L885) |
| Criar/editar packing list | [`crearContenedor` / `actualizarPackingList`](../src/lib/services/contenedor.ts#L190) |
| Desconsolidación + gate D9 | [`desconsolidar`](../src/lib/services/desconsolidacion.ts#L99) |
| Investigação de divergência | [`divergencia-investigacion.ts`](../src/lib/services/divergencia-investigacion.ts) |
| Transferência entre subcontas | [`crearAsientoTransferenciaSubcuenta`](../src/lib/services/asiento-automatico.ts#L1436) |
| Asiento de divergência (D9) | [`crearAsientoDivergencia`](../src/lib/services/asiento-automatico.ts#L1512) |
| Asiento do despacho cruzado | [`crearAsientoDespachoCruzado`](../src/lib/services/asiento-automatico.ts#L2031) |
| Borrador + trava single-shot | [`despacho-parcial.ts`](../src/lib/services/despacho-parcial.ts) |
| VEP do despacho | [`crearOActualizarVepDespacho`](../src/lib/actions/despachos.ts#L865) |
| Cron de cleanup | [`/api/cron/cleanup-despachos-borrador`](../src/app/api/cron/cleanup-despachos-borrador/route.ts) |
| Feature flag | [`isContenedorDesconsolidacionEnabled`](../src/lib/features.ts#L88) |
| UI desconsolidación / investigação | `comex/contenedores/[id]/desconsolidacion`, `.../investigacion` |
| UI despacho cruzado | `comex/embarques/[id]/despachos` (matriz cruzada) |
