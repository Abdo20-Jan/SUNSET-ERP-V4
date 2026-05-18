# Fluxo de Importações pela Zona Primária

Este documento descreve o fluxo end-to-end de importações no Sunset ERP v4, desde o embarque em trânsito até a chegada na Zona Primária (ZP) e os despachos parciais de nacionalização.

## Visão Geral

O sistema suporta **dois paradigmas** que convivem no mesmo schema:

1. **Modular (recomendado)** — asiento de Zona Primária + N asientos de despacho parcial. Permite nacionalizar a mercadoria em etapas, com stock ingressando proporcionalmente.
2. **Monolítico (legacy)** — um único asiento de cierre que nacionaliza tudo de uma vez e ingressa o stock total.

A escolha entre os dois é determinada pelo usuário no momento de finalizar o embarque. Ambos resultam em mercadoria em depósito ao final, mas o modular é o único que reflete realidade operacional de despachos escalonados.

---

## 1. Modelos Prisma

Todos definidos em [prisma/schema.prisma](../prisma/schema.prisma).

### 1.1. Enums

| Enum | Linha | Valores |
|---|---|---|
| `EmbarqueEstado` | 76 | `BORRADOR` → `EN_TRANSITO` → `EN_PUERTO` → `EN_ZONA_PRIMARIA` → `EN_ADUANA` → `DESPACHADO` → `EN_DEPOSITO` → `CERRADO` |
| `MomentoCosto` | 92 | `ZONA_PRIMARIA` \| `DESPACHO` |
| `DespachoEstado` | 100 | `BORRADOR` → `CONTABILIZADO` \| `ANULADO` |
| `TipoCostoEmbarque` | 106 | `FLETE_INTERNACIONAL`, `FLETE_NACIONAL`, `SEGURO_MARITIMO`, `GASTOS_PORTUARIOS`, `HONORARIOS_DESPACHANTE`, `OPERADOR_LOGISTICO`, `ALMACENAJE`, `DEVOLUCION_CONTENEDOR`, `AGENTE_DE_CARGAS` |
| `EmbarqueCostoEstado` | 547 | `BORRADOR` \| `EMITIDA` \| `ANULADA` \| `LEGACY_BUNDLED` |

### 1.2. Modelos principais

#### `Embarque` ([linha 429](../prisma/schema.prisma#L429))

Header da importação. Campos relevantes:

- `codigo` — identificador legível (ex: `EMB-2025-001`).
- `estado` — `EmbarqueEstado`.
- `proveedorId` — proveedor exterior.
- `moneda`, `tipoCambio` — moeda original e TC.
- Transporte: `nombreBuque`, `lineaMaritima`, `fechaEmpaque`, `fechaSalida`, `fechaLlegada`, `lugarTransbordo`, `fechaTransbordo`.
- Valores comerciais: `fobTotal`, `cifTotal`, `valorFleteOrigen`, `valorSeguroOrigen`.
- Tributos: `die`, `tasaEstadistica`, `arancelSim`, `iva`, `ivaAdicional`, `ganancias`, `iibb`.
- **Rastreamento contábil dos dois fluxos:**
  - `asientoId` (1:1) — asiento de cierre **monolítico**.
  - `asientoZonaPrimariaId` (1:1) — asiento de **Zona Primária** (modular).
  - `fechaCierre`, `fechaZonaPrimaria`.
- `depositoDestinoId` — depósito destino.

#### `EmbarqueCosto` ([linha 493](../prisma/schema.prisma#L493))

Factura de proveedor local (gastos de nacionalização) associada a um embarque:

- `momento` — `ZONA_PRIMARIA` (contabilizado na confirmação da ZP) ou `DESPACHO` (contabilizado em cada despacho parcial).
- `estado` — controla quando o asiento individual é gerado.
- `despachoId` — opcional, linka a factura a um despacho específico.
- `asientoId` — asiento individual emitido quando `estado === "EMITIDA"`.
- `lineas` (`EmbarqueCostoLinea[]`) — detalhe dos conceitos de gasto.

#### `ItemEmbarque` ([linha 571](../prisma/schema.prisma#L571))

Produto da carga, com `cantidad`, `precioUnitarioFob`, e `costoUnitario` calculado por rateio na contabilização.

#### `Despacho` ([linha 597](../prisma/schema.prisma#L597))

Nacionalização parcial ou total:

- `codigo` (ex: `AR-250915-006-D1`).
- `numeroOM` — número do despacho oficializado.
- `tipoCambio` — TC oficializado do despacho (pode diferir do TC do embarque).
- Tributos do despacho (`die`, `tasaEstadistica`, etc) — valores parciais específicos desta nacionalização.
- `asientoId` (1:1) — asiento gerado ao contabilizar.

#### `ItemDespacho` ([linha 629](../prisma/schema.prisma#L629))

Consumo de uma porção de `ItemEmbarque` num despacho. Garante unicidade `@@unique([despachoId, itemEmbarqueId])`.

---

## 2. Fluxo Modular (recomendado)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. CRIAR EMBARQUE (guardarEmbarqueAction)                           │
│    → Estado BORRADOR                                                │
│    → Salvar FOB, items, transporte, tributos sugeridos              │
│    → Sem contabilização                                             │
└─────────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. ADICIONAR FACTURAS momento=ZONA_PRIMARIA                         │
│    (emitirEmbarqueCostoFacturaAction com momento ZP)                │
│    → frete origem, gastos portuários, etc                           │
└─────────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. CONFIRMAR ZONA PRIMÁRIA (confirmarZonaPrimariaAction)            │
│    → Gera asiento ZP:                                               │
│        DEBE  1.1.5.02 Mercaderías en Tránsito                       │
│              (FOB ARS + flete/seguro origem + Σ facturas ZP)        │
│        HABER Proveedor Exterior + proveedores facturas ZP +         │
│              créditos IVA/IIBB                                      │
│    → Estado vira EN_ZONA_PRIMARIA                                   │
│    → asientoZonaPrimariaId persistido                               │
│    → NÃO ingressa stock ainda                                       │
└─────────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. CRIAR DESPACHOS PARCIAIS (crearDespachoAction) [repetir N vezes] │
│    → Cada despacho:                                                 │
│        - Selecionar ItemEmbarque[] com cantidades ≤ remanente       │
│        - Linkar facturas momento=DESPACHO (opcional)                │
│        - Especificar tributos parciais (DIE, TE, Arancel, IVA…)     │
│        - TC oficializado do despacho                                │
│    → Despacho em BORRADOR                                           │
└─────────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. CONTABILIZAR DESPACHO (contabilizarDespachoAction)               │
│    → Gera asiento Despacho:                                         │
│        DEBE  1.1.5.01 Mercaderías (porção rateada)                  │
│              + 5.7.1.01/02/03 (DIE/TE/Arancel)                      │
│              + 1.1.4.04/05/06/07 (créditos IVA/IIBB/Ganancias)      │
│        HABER 1.1.5.02 (redução proporcional)                        │
│              + proveedores facturas DESPACHO                        │
│              + 2.1.5.x / 2.1.3.x (Aduana — pasivos tributos)        │
│    → Aplica MovimientoStock proporcional (stock disponível)         │
│    → Despacho vira CONTABILIZADO                                    │
└─────────────────────────────────────────────────────────────────────┘
```

Repetir passos 4-5 até despachar 100% da mercadoria.

---

## 3. Fluxo Monolítico (legacy)

```
1. Criar embarque (guardarEmbarqueAction) — idem modular
2. Adicionar facturas (qualquer momento)
3. Cerrar y Contabilizar (cerrarYContabilizarEmbarqueAction)
   → Asiento ÚNICO de nacionalização:
       DEBE  1.1.5.01 (todas as mercaderías) + tributos + créditos
       HABER Proveedor exterior + proveedores logísticos + Aduana
   → Estado CERRADO
   → Aplica MovimientoStock para 100% dos items
```

Útil em embarques simples (sem despachos parciais), porém **não recomendado** para novos casos — o fluxo modular tem melhor rastreabilidade e suporta nacionalização escalonada.

---

## 4. Asientos Contábeis

Lógica em [src/lib/services/asiento-automatico.ts](../src/lib/services/asiento-automatico.ts):

| Função | Linha | Asiento gerado |
|---|---|---|
| `crearAsientoEmbarque` | [862](../src/lib/services/asiento-automatico.ts#L862) | Cierre monolítico |
| `crearAsientoZonaPrimaria` | [1163](../src/lib/services/asiento-automatico.ts#L1163) | Zona Primária |
| `crearAsientoDespacho` | [1393](../src/lib/services/asiento-automatico.ts#L1393) | Despacho parcial |
| `crearAsientoEmbarqueCosto` | [2362](../src/lib/services/asiento-automatico.ts#L2362) | Factura individual de gasto |

### Plano de Contas

Definido em [src/lib/services/cuenta-registry.ts:171](../src/lib/services/cuenta-registry.ts#L171) (`EMBARQUE_CODIGOS`):

**Ativos:**
- `1.1.5.01` Mercaderías (em depósito)
- `1.1.5.02` Mercaderías en Tránsito (em ZP, sem stock)
- `1.1.4.04` IVA Crédito Importação
- `1.1.4.05` IVA Adicional Crédito
- `1.1.4.06` IIBB Crédito Importação
- `1.1.4.07` Ganancias Crédito
- `1.1.4.01` IVA Crédito Compras
- `1.1.4.11` IIBB Crédito Compras

**Egressos (tributos):**
- `5.7.1.01` DIE
- `5.7.1.02` Tasa Estadística
- `5.7.1.03` Arancel SIM

**Pasivos (Aduana e proveedores):**
- `2.1.5.01` DIE por pagar
- `2.1.5.02` Tasa Estadística por pagar
- `2.1.5.03` Arancel SIM por pagar
- `2.1.5.04` IVA Importação por pagar
- `2.1.3.02` IIBB por pagar
- `2.1.3.03` Ganancias por pagar
- `2.1.1.02` Proveedor Exterior (fallback)

### Rateio de custos

[`calcularRateioEmbarque`](../src/lib/services/comex.ts#L110) distribui o custo total (FOB + flete/seguro origem + facturas + tributos egreso) entre items proporcionalmente ao FOB. IVA/IIBB/Ganancias ficam como créditos e **não** são rateados.

---

## 5. Stock

Funções em [src/lib/services/stock.ts](../src/lib/services/stock.ts):

| Função | Linha | Propósito |
|---|---|---|
| `aplicarIngresoEmbarque` | [44](../src/lib/services/stock.ts#L44) | Ingresso monolítico (cierre legacy) |
| `aplicarIngresoDespacho` | [136](../src/lib/services/stock.ts#L136) | Ingresso por despacho parcial (linkado a `ItemDespacho`) |
| `revertirIngresoDespacho` | [190](../src/lib/services/stock.ts#L190) | Reverte ingressos ao anular despacho |
| `recalcularStockYCostoPromedio` | [257](../src/lib/services/stock.ts#L257) | Recalcula costo promedio ponderado |

O `MovimientoStock` gerado por despacho parcial fica linkado a `ItemDespacho.id`, permitindo reversão limpa ao anular o despacho.

---

## 6. UI

Rotas em [src/app/(dashboard)/comex/embarques/](../src/app/(dashboard)/comex/embarques/):

| Rota | Página |
|---|---|
| `/comex/embarques` | Lista com filtros e abas por estado |
| `/comex/embarques/nuevo` | Criar |
| `/comex/embarques/[id]` | Editar + dialogs ZP/Reverter/Cierre |
| `/comex/embarques/[id]/despachos` | Listar/criar despachos parciais |

Componente principal: [`EmbarqueForm`](../src/app/(dashboard)/comex/embarques/_components/embarque-form.tsx) (compartilhado entre nuevo/editar). Dialogs contábeis em [`cerrar-embarque-dialog.tsx`](../src/app/(dashboard)/comex/embarques/_components/cerrar-embarque-dialog.tsx).

---

## 7. Validações e Restrições

### Confirmar ZP
- Embarque deve existir.
- Não ter `asientoZonaPrimariaId` (não confirmado já).
- Não ter `asientoId` (não cerrado monoliticamente).
- Ter FOB > 0 OU pelo menos uma factura `momento=ZONA_PRIMARIA`.

### Criar Despacho
- Embarque deve ter `asientoZonaPrimariaId` (ZP confirmada).
- Embarque não pode ter `asientoId` (modular ≠ monolítico).
- Cada `ItemDespacho.cantidad ≤ ItemEmbarque.cantidad - Σ(já despachado)`.
- Facturas linkadas devem ser `momento=DESPACHO` e não estar linkadas a outro despacho ativo.

### Contabilizar Despacho
- Despacho em `BORRADOR`.
- Embarque tem `depositoDestinoId` ativo.
- Despacho tem ≥ 1 `ItemDespacho`.

### Reverter ZP
- Embarque tem `asientoZonaPrimariaId`.
- Embarque não tem `asientoId`.
- Nota: não afeta stock (ZP não gera movimentos de stock).

---

## 8. Fluxograma de Estados

```
                    ┌──────────┐
                    │ BORRADOR │
                    └────┬─────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ EN_TRANSITO  │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  EN_PUERTO   │
                  └──────┬───────┘
                         │
                   confirmarZP
                         │
                         ▼
                ┌────────────────────┐
                │ EN_ZONA_PRIMARIA   │
                └──┬──────────────┬──┘
                   │              │
            despachos          cierre
            parciais           monolítico
                   │              │
                   ▼              ▼
            ┌────────────┐   ┌──────────┐
            │ EN_ADUANA  │   │  CERRADO │
            └─────┬──────┘   └──────────┘
                  │
                  ▼
            ┌──────────────┐
            │ DESPACHADO   │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │ EN_DEPOSITO  │
            └──────────────┘
```

> **Nota:** As transições entre `EN_TRANSITO`, `EN_PUERTO`, `EN_ADUANA`, `DESPACHADO`, `EN_DEPOSITO` são **manuais** hoje (selecionadas pelo usuário no form). Apenas `EN_ZONA_PRIMARIA` é definida automaticamente ao confirmar ZP, e `CERRADO` ao executar o cierre monolítico.

---

## 9. Onde Encontrar Cada Coisa

| Pergunta | Local |
|---|---|
| "Como é o asiento de ZP?" | [crearAsientoZonaPrimaria](../src/lib/services/asiento-automatico.ts#L1163) |
| "Como é o asiento de despacho?" | [crearAsientoDespacho](../src/lib/services/asiento-automatico.ts#L1393) |
| "Como o rateio distribui custos?" | [calcularRateioEmbarque](../src/lib/services/comex.ts#L110) |
| "Quais alíquotas padrão?" | [calcularTributosSugeridos](../src/lib/services/comex.ts#L48) |
| "Como criar um embarque?" | [guardarEmbarqueAction](../src/lib/actions/embarques.ts#L551) |
| "Como criar um despacho?" | [crearDespachoAction](../src/lib/actions/despachos.ts#L215) |
| "Como funcionam estados do MovimientoStock?" | [aplicarIngresoDespacho](../src/lib/services/stock.ts#L136) |

---

## 10. Convenções Contábeis

- **Moeda do asiento:** sempre ARS, convertido via TC do embarque (para FOB) ou TC da factura (para custos).
- **Tributos do despacho:** convertidos via TC oficializado do despacho (que pode diferir do TC do embarque).
- **Diferenças cambiais:** atualmente não são tratadas explicitamente — resíduo permanece em `1.1.5.02`. Decisão pendente sobre tratamento conforme normativa.
- **DEBE = HABER:** garantido por validações em `crearAsiento*`. Quebra desse invariante lança erro `DESBALANCEADO`.
