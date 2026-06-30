# IMPLEMENTATION_NOTES — PR-023 (CX-05 Despachos + CX-06 Costos/Rateio)

> Wave 2 · record-migration + cost-UI · criticidade MÁXIMA · **esta é a PR CRIT-05**.
> Split em quatro unidades sequenciais: **PR-023-pre** (golden) → PR-023a (record) → PR-023b (costos) → PR-023c (memoria).
> Branch base: limpo de `origin/main`. **Nada commitado** (commit/merge só por instrução explícita do dono).

---

## Preflight & CRIT-05 gate

- **CRIT-05 GATE → CASO (a): a engine NÃO muda.** `calcularCostoLandedDespacho`
  (`src/lib/services/despacho-parcial.ts:853`) já retorna a memória completa por SKU (`porItem[]` com
  `costoFcUnitarioArs`, `capitalizablesItemArs`, `costoTotalArs`, `costoUnitarioLandedArs` + `costoUnitarioLandedPorItem`
  + os totais `nacionalizadoArs`/`tributosCapitalizablesArs`/`facturasCapitalizablesArs`/`capitalizablesArs`/
  `costoTotalArs`). participación % é derivável; o ajuste de redondeo (último item absorve o resíduo) e a base (FOB,
  com fallback por cantidad quando FOB total = 0) já estão na função. → A memória é **UI read-only pura** sobre a saída
  existente. **Nenhum arquivo da engine/actions foi tocado.**

- **Nuance resolvida:** `obtenerDespachoPorId` não chama a engine nem expõe `costoFCUnitario`, e `actions/despachos.ts`
  é proibido de modificar. Logo a memória/simular usam uma **função read-only NOVA** (`despacho-memoria.ts`) que relê
  as mesmas linhas e chama a MESMA engine.

## Decisões do dono (resolvidas)

- **D-1 · Permissão:** memória (view + export) usa o existente **`VER_COSTO_LANDED`** (`"costos.verLanded"`).
  Sem chaves novas, sem schema/seed. `reopen_costo_comex` permanece ausente → reabertura deferida.
- **D-2 · Golden:** **fixtures sintéticos determinísticos** (Testcontainers), sem dependência de produção.
- **D-3 · Costo gerencial (com IVA):** **omitido**. Nenhuma função o computa (`grep gerencial/valorizar` = 0); só
  existe o **contable (sem IVA)**. Computá-lo na UI seria reimplementar a engine → fora de escopo (eventual PR de
  engine sob protocolo CRIT-04).

---

## ✅ PR-023-pre — Golden regression (CRIT-05) — **IMPLEMENTADO E VERDE**

### Arquivos
- **NOVO (read-only, aditivo):** `src/lib/services/despacho-memoria.ts` — `obtenerMemoriaDespacho(despachoId)`.
  Relê o despacho com o **mesmo `select`** que `contabilizarDespachoAction` (`despachos.ts:506-573`):
  `tipoCambio/die/tasaEstadistica/arancelSim`, `items{ id, cantidad, itemContenedor{ productoId, costoFCUnitario } }`,
  `costos{ where momento≠ZONA_PRIMARIA & estado∈[BORRADOR,LEGACY_BUNDLED], tipoCambio, lineas{ subtotal } }`,
  + `embarque.tipoCambio`. Monta `CostoLandedInput` **idêntico** e chama `calcularCostoLandedDespacho` **read-only,
  zero write**. Fork: cruzado → memória de rateio; legacy (sem `itemContenedor`) → `tipo: "LEGACY"` (sem rateio).
- **NOVO:** `test/comex-despacho-memoria.golden.test.ts` — golden consolidado (Testcontainers + `serializeGolden`).

### Cobertura do golden (5 arquétipos)
| # | Arquétipo | Congela |
|---|-----------|---------|
| A | Cruzado total simple (caso verbatim 70/30, DIE 20) → A=84000 / B=36000 | memória + asiento (120000/100000/20000) + stock |
| B | Cruzado parcial + factura DESPACHO (30 de 60; landed 18166.67) | memória + asiento (DEBE 545000, crédito fiscal) + stock |
| C | Cruzado TC decimal 1399.5, 3 ítems, resíduo no último (D4) | memória + asiento (DIE 2474665.88 / Tasa 464004.23 / Arancel 13995) + stock |
| E | Legacy (sem itemContenedor) | `obtenerMemoriaDespacho → tipo "LEGACY"` |
| F | Fallback FOB=0 (muestras) → rateio por cantidad | saída da engine (pure-fn read-only) |

### Âncoras provadas (não só congeladas)
1. **Byte-estabilidade read-only:** memória ANTES de contabilizar (BORRADOR, caminho do "Simular") ≡ memória DEPOIS
   (CONTABILIZADO) — exceto o campo `estado` (metadado). Garantido porque o filtro de faturas é
   `estado∈[BORRADOR,LEGACY_BUNDLED]` e a contabilização migra BORRADOR→LEGACY_BUNDLED (`asiento-automatico.ts:3160`),
   então a mesma fatura é relida nos dois momentos.
2. **memória ≡ persistido:** `landed.porItem[i].costoUnitarioLandedArs` ≡ `ItemDespacho.costoUnitario` ≡ custo da
   entrada de stock NACIONAL.
3. **memória ≡ asiento:** `landed.costoTotalArs` ≡ DEBE 1.1.7.01; e Σ DEBE ≡ Σ HABER (partida dobrada).

### Evidência de validação (executada localmente, Docker/Testcontainers)
```
typecheck (tsc --noEmit) ............................. OK (0 erros)
biome check (arquivos novos) ......................... OK (formatado)
vitest test/comex-despacho-memoria.golden.test.ts .... 5 passed
Regressão engine (8 suítes, 47 testes) ............... 47 passed
  · comex-despacho-memoria.golden ......... 5
  · golden-costo-landed-despacho .......... 2
  · costo-landed-despacho ................. 6
  · golden-rateio-embarque ................ 1
  · despacho-cruzado-capitalizacion-stock . 5
  · asiento-despacho-cruzado .............. 2
  · despacho-parcial ...................... 17
  · validar-invariantes-comex ............. 9
```
**Golden verde ANTES de qualquer UI de custo (CX-06 funcional 2).** Os goldens existentes da engine permanecem
byte-idênticos (sem diff) → engine intocada.

> Nota: `pnpm db:validar-stock` / `pnpm db:validar-asientos` validam um DB **vivo** (DATABASE_URL); a lógica de
> invariantes já é exercida via Testcontainers em `validar-invariantes-comex.test.ts` (9 passed). Os scripts
> standalone devem rodar em CI / contra um DB semeado — **nunca contra produção**.

---

## ⏳ PR-023a/b/c — planejado (a construir após PR-023-pre mergeado)

### PR-023a · Despacho RECORD (CX-05)
- `…/despachos/[despachoId]/page.tsx` — RecordLayout + AdaptiveRecordHeader + RecordTabs
  (Resumen/Items/Tributos/Facturas/Costos/Asiento/Documentos/Auditoría), via `obtenerDespachoPorId` (existente).
- Hospeda **verbatim** os componentes existentes (`despacho-actions`, `crear-despacho-form`,
  `despacho-cruzado-matriz`, `despacho-cruzado-tributos`) em `FloatingWorkWindow`/seções — payloads byte-idênticos.
- Aditivo: cada linha da lista (`…/despachos/page.tsx`) vira `EntityLink`/chevron → ficha.

### PR-023b · Costos worklist (CX-06)
- `costos-worklist.tsx` read-only: 6 seções + Clasificación + cash-out vs custo; tabela densa via
  `EnterpriseDataGrid`. Colunas de custo **gated/omitidas** server-side sem `VER_COSTO_LANDED` (omitir, não "—").
- Gerencial **omitido** (D-3).

### PR-023c · MemoriaCalculoWindow + Simular
- `memoria-calculo-window.tsx` (FWW read-only) + `simular-despacho.tsx` consomem `obtenerMemoriaDespacho`
  (já entregue em pre). Display por SKU (participación/alocado/unitario) + base usada + badge da função + linha de
  arredondamento. **Renderiza os valores da engine; nunca recomputa na UI.**
- Action wrapper `src/lib/actions/despacho-memoria.ts` aplica masking (`puedeVerCostoLanded()` → senão OMITE os
  campos monetários). Vendedor/Consulta nunca veem memória. **Simular não escreve nada** (read-only).
- Export gated por `VER_COSTO_LANDED`; auditado via PR-010 se presente (senão omitir audit + flag).

## Non-goals (deferidos)
Reabertura/recontabilización (versionamento + dupla aprovação + SLA + asiento reverso — exige approvals engine +
schema); scheduler provisorio→final; PDF firma/hash; export-audit se PR-010 ausente; chaves novas de permissão;
**costo gerencial** (D-3); qualquer mudança de engine/rateio.

## Rollback
PR-023-pre é puramente aditivo (1 serviço read-only + 1 teste) → reverter = remover os dois arquivos. UI (a/b/c) =
restaurar a rota despachos só-lista (remover `[despachoId]/` + reverter o `EntityLink` aditivo).
