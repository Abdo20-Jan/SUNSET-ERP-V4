# PR-011 — Máscara de Custo/Margem (RBAC) · Notas de implementação

> Wave 1. **Retrofit** de visibilidade: faz custo/margem/valorização obedecerem a permissão sobre
> páginas existentes, **consumindo** PR-006 (motor `hasPermission` + catálogo) e PR-007
> (`PermissionGate`). **Não recalcula nada** — apenas (a) **STRIP no payload BE** (CRIT-10: o
> servidor não devolve o valor sem a chave) e (b) **máscara FE** (`—` / oculto). **Aditivo e
> backward-compatible:** com `RBAC_ENABLED` OFF (default) ou perfis default, renderiza **tudo**
> idêntico a hoje. Não toca `schema.prisma`/migrations, nem o motor RBAC, nem auth/JWT/sessão, nem
> nenhum motor de cálculo (CRIT-04..09). Regras-fonte: **G-10 / CRIT-01/02/10**, ANEXO A.2.

## Por que existe
Custo, margem e valorização de estoque eram serializados no payload e renderizados para **qualquer**
usuário autenticado. PR-006/007 deram o motor e o `PermissionGate`, mas nada gateava esses valores.
Uma **varredura de completude** (`costoPromedio`/`costoUnitario`/`margen`/`utilidad`/`valorado`)
achou que o mesmo `costoPromedio` vazava também por superfícies fora das 3 enumeradas (export NS-3,
prefill de compras, snapshot CMV de entregas, agregados de BI). Por decisão do dono, **todas** foram
fechadas neste PR para não deixar bypass.

## Chaves novas — `src/lib/permisos-catalog.ts` (DATA, sem schema)
Notação de ponto (house style). Constantes `PERMISOS.*`; só a `clave` é persistida/exibida.

| Constante | clave | dimensão | superfície |
|---|---|---|---|
| `VER_COSTO` | `costos.ver` | CAMPO | custo unitário / CMV |
| `VER_MARGEN` | `margenes.ver` | CAMPO | margem / rentabilidade |
| `VER_COSTO_STOCK` | `stock.verCosto` | INFORMACION | valorização de estoque |
| `VER_COSTO_LANDED` | `costos.verLanded` | CAMPO | valor bonded FOB/landed |
| `VER_PRECIO_MINIMO` | `precios.verMinimo` | CAMPO | reservada (sem campo no schema) |

**Load-bearing:** as 5 entram em `USER_BASE_CLAVES`. Sem isso, com RBAC OFF `isAdminScopedKey` as
trataria como admin-scoped e `hasPermission` devolveria `false` para não-admin → custo sumiria para
todos hoje (**regressão**). Sendo base: RBAC OFF ⇒ visíveis a todo ativo; RBAC ON + seed default ⇒
`grantClaves(USER, …, USER_BASE_CLAVES)` concede ao perfil USER. A máscara só morde com perfil
**custom** que omita a chave. `prisma/seed.ts` **não muda** (é dirigido pelo catálogo; o log passa de
15 → 20 permisos). Tabela `Permiso` já existe desde PR-006.

## Mecanismo compartilhado — `src/lib/permisos-masking.ts` (novo, `server-only`)
`puedeVerCosto()` / `puedeVerMargen()` / `puedeVerCostoStock()` / `puedeVerCostoLanded()` — wrappers
finos (complexidade 1) sobre `hasPermission(PERMISOS.X)`. `maskField(allowed, value)` puro. O strip
acontece **no caller** (action/server component), nunca dentro de `bi.ts`/`services/*`. FE reusa o
`PermissionGate`/`useHasPermission` do PR-007 e o snapshot `session.user.permisos` (shape inalterado).

## Superfície × chave × local do strip BE × FE
**Custo unitário — `costos.ver`** (tipo `string → string | null` aditivo):

| Superfície | Função (file) | FE |
|---|---|---|
| COM-02 Venta (piloto) | `listarProductosParaVenta` `actions/ventas.ts` | `venta-form.tsx`: bloco rentabilidad línea + footer "Margen neto" (`verCosto`/`verMargen`) |
| Maestro · custo | `obtenerProductoCosto` `actions/productos.ts` | `producto-form-dialog` já mostra `—` |
| Export NS-3 | `listarProductosParaExport` (+ `listarProductos`) via `mapProductoRow(p, verCosto)` | CSV/XLSX |
| Compras · prefill | `listarProductosParaCompra` `actions/compras.ts` | `compra-form` prefill `?? ""` |
| Pedidos-compra · prefill | `listarProductosParaPedidoCompra` `actions/pedidos-compra.ts` | `pedido-compra-form` prefill `?? ""` |
| Entregas · snapshot CMV | `listarEntregasDeVenta` `actions/entregas.ts` → `items[].costoUnitario:null` | latente (não exibido) |

**Margem — `margenes.ver`** (strip no caller, fora de `bi.ts`):

| Superfície | Local do strip | FE |
|---|---|---|
| BI rentabilidad (KPIs+cascada+dimensionais) | novo `bi/_tabs/rentabilidad-strip.ts` aplicado em `rentabilidad-tab.tsx` | indicadores `—` (null-safe `moneyN`/`pctN`/`accN`); séries vazias |
| COM-02 margem (derivada client-side) | protegida pelo strip de custo (#1) + `verMargen` FE | sub-linhas Neto%/utilidadNeta |
| BI resumen · margenBruto/Pct | gate no server component `resumen-tab.tsx` | KPI `—` |
| BI giro · CMV do período | gate no server component `giro-tab.tsx` | insumo `—` |

**Valorização — `stock.verCosto`** (e `costos.verLanded` p/ bonded):

| Superfície | Local do strip | FE |
|---|---|---|
| Inventário · matriz | `listarMatrizInventario` `actions/inventario.ts` (produto + depósito) | BE-only (não exibido) |
| BI stock · valorações NACIONAL | gate em `stock-tab.tsx` (`valorado`, charts `porDeposito`/`topProductosValor`, `slowMovers[].valor`) | charts vazios + `—` |
| BI stock · bonded `valorUsd` | `BondedSection` sob `costos.verLanded` | `—` |
| BI resumen · stockValorado / BI giro · inventario | gate nos server components | KPI/insumo `—` |

> Charts client recebem array **vazio** quando negado (o número cru não cruza); valores
> server-rendered viram `—`. `inputs.ventas`/quantidades/aging/contadores ficam visíveis.

## Backward-compat (prova)
- RBAC OFF (default prod): 5 chaves base ⇒ `hasPermission`=true p/ todo ativo; FE
  `permisos===undefined` ⇒ mostra tudo. Sem strip, sem máscara, **idêntico a hoje**.
- RBAC ON + seed default: USER e ADMIN recebem as 5 ⇒ inerte.

## Motores intactos (prova)
Nenhuma edição em `bi.ts`/`bi-lucro.ts`/`bi-giro.ts`, `services/reportes/*`, `asiento-automatico.ts`,
`stock*.ts`, `backfill-cmv.ts`, comex despacho/landed, `retencion-ganancias*`, `simulacion-importacion`
(calculadora client-side). O strip lê o objeto já computado e omite campos no caller.

## Testes (CRIT-10) — `test/*-masking.test.ts` (6 arquivos, unit, sem Docker)
- `permisos-masking`: wrappers delegam à clave correta; `maskField`; **invariante** das 5 chaves em
  `USER_BASE_CLAVES` + `isAdminScopedKey` false (zero regressão).
- `bi-rentabilidad-masking`: `stripAnalisisLucro` esvazia margem e **preserva `inputs.ventas`** (guarda
  do split — DRE/saldo não é mascarado aqui).
- `ventas-costo-masking` / `productos-costo-masking` / `inventario-costo-masking`: negado ⇒ valor
  `null`; concedido/OFF ⇒ valor real; campos não sensíveis intactos.

## Fora de escopo / PR-011b
- **Saldo/DRE** (`saldos.ver`, `reportes.verDreBalance`): reportes Estado de Resultados / Balance e
  tesorería saldos (incl. CxP), dashboard saldos. Reusam este mesmo mecanismo.
- `precios.verMinimo`: reservada (não há campo `precioMinimo` no schema).
- Comex despacho/landed engine, posting/CMV, aprovações (PR-012).
