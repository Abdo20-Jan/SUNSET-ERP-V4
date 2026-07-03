# IMPLEMENTATION NOTES — PR-027 · INV-01 · Inventario · Estoque Geral

**Worklist canónica producto×depósito** (Wave 2 · worklist-migration · criticidade alta).
Migra `inventario/` (tabs por depósito + matriz + 3 tabelas laterais) para a
EnterpriseDataGrid canônica: **1 linha por producto×depósito** desde
`StockPorDeposito`, colunas OD-04 com backing, toggle "Por depósito", views
data-backed, custo gated por `VER_COSTO_STOCK` (server-side), alertas e export
auditado. **UI-only + read-only**: engines de stock intocados, nada recomputado,
sem schema, sem chave de permissão nova.

Nota de numeração: o roadmap do repo não tem entrada "PR-027" — INV-01 consta
como PR-017/PR-INV (`10_PR_ROADMAP.md:58,100`); a numeração real das notas já
derivou (esta série vai em PR-027).

---

## 1. Canon OD-04 (11 colunas) vs shipped

| # OD-04 | Coluna canônica | Status | Fonte / motivo |
|---|---|---|---|
| 1 | Produto | ✅ shipped (frozen) | `Producto.nombre` (+marca em subtexto). **Sem EntityLink**: não existe rota de ficha de produto (lista+diálogo apenas) — não se inventa rota. |
| 2 | Medida | ✅ shipped | `Producto.medida` |
| 3 | Marca | ✅ shipped | `Producto.marca` |
| 4 | SKU | ✅ shipped (frozen) | `Producto.codigo` |
| 5 | Depósito | ✅ shipped (frozen) | `Deposito.nombre` via relação; `EntityLink` → `/maestros/depositos/[id]` (rota existe); badge "Fiscal" |
| 6 | Físico | ✅ shipped | `StockPorDeposito.cantidadFisica` |
| 7 | Disponível | ✅ shipped (derivada) | `cantidadFisica − cantidadReservada` (§3) |
| 8 | Reservado | ✅ shipped | `StockPorDeposito.cantidadReservada` — **correção ao enunciado do PR**: a coluna TEM backing (é exibida hoje na matriz); o que não tem backing é a *view* [Reservado] (breakdown por pedido não é armazenado) |
| 9 | Em conferência | ❌ OMITIDA | sem modelo de conteo físico (só conferência de desconsolidação de contêiner, outro grão) |
| 10 | Em trânsito (transferências) | ❌ OMITIDA | `TransferenciaEstado = {CONFIRMADA, ANULADA}` — transferências são atômicas, não existe estado EN_TRANSITO; o "en tránsito" comex entra via Futuro Comex + view [En tránsito] |
| 11 | Bloqueado | ❌ OMITIDA | nenhum flag de bloqueio em SPD; `UnidadEstadoAduanero.BLOQUEADA` é inerte (D1-bis, `UnidadInventario` vazia) |

**Colunas extra do OD-04 (seção 4):**

| Coluna | Status | Fonte |
|---|---|---|
| Despachos ativos | ✅ shipped | count DISTINCT `despachoId` de `ItemDespacho` com `despacho.estado = BORRADOR`, por produto. **Proxy interino**: sem link (página por-despacho é INV-02/PR-037) |
| Custo gerencial | ✅ shipped **gated** | `StockPorDeposito.costoPromedio` ARMAZENADO (nunca recalculado). Sem `VER_COSTO_STOCK` a coluna **NÃO EXISTE** (§5) |
| Futuro Comex (ETA≤90d, badge F) | ✅ shipped | reuso verbatim de `listarEnTransito` + `listarEnProduccion` (queries da página velha) + corte 90d em helper puro; breakdown de **2 buckets** ("En producción / En tránsito") — "Embarcado" não é separável do modelo. O resumo carrega TAMBÉM os totais **sem corte** (`enTransitoTotal`/`enProduccionTotal`, semântica das tabs velhas); pipeline 100% além de 90d aparece em cinza ("+N >90d") |
| Em fiscal (separado do Disponível) | ✅ shipped | Σ físico do produto em depósitos fiscais (**`tipo = ZONA_PRIMARIA` SOMENTE** — espelho exato da partição do engine: `replayStockNacional` nunca lê `subtipo`; assim `totalFisicoNacional` = semântica de `stockActual`), derivado in-memory das próprias linhas SPD; tooltip breakdown por depósito |

**Filas "pipeline" sintéticas (paridade com as tabs velhas — fix de review):**
as tabs En tránsito/En producción eram *product-level*; um SKU **sem posição
viva em SPD** mas com unidades no pipeline (primeira importação, produto
zerado com reposição na água) sumiria da página. O serviço sintetiza 1 linha
por produto nesse caso: depósito rotulado "En tránsito / producción" (sem
ficha navegável), quantidades físicas = 0, `ultimoMovimiento = null`, custo
`null`, pipeline em `futuroComex`. Metadados via **1 query batched** só pelos
ids faltantes (zero N+1). A **vista [En tránsito] filtra pelo total SEM corte**
(item genuinamente na água com ETA > 90d continua visível — semântica da tab
velha); o corte de 90d é exclusivo da COLUNA/vista Futuro Comex (OD-04).
Travado por teste (`p4:pipeline`).

Extra não-canônica adicionada: **Últ. movimiento** (`SPD.ultimoMovimiento`) e
**Alerta** (badge da severidade máxima) — backing dos badges/views de alerta
exigidos pela spec (QA "alert badges show").

**Views**: [Bajo mínimo] (`stockMinimo>0 && Σ físico NACIONAL < mínimo`),
[Negativos] (`físico<0 || disponible<0`), [En tránsito], [En fiscal],
[Futuro Comex], [Sin movimiento Xd] (`?dias=` whitelist {30,60,90,180}, default
90). **Omitidas sem backing**: [Divergencias] (divergência só existe no
pipeline bonded de contêiner), [Bloqueado], [Reservado].

**Filtros (subconjunto data-backed dos 7)**: busca rápida
(SKU/nome/marca/medida/depósito) + chips Depósito · Marca · Medida · Alerta.
Omitidos: **Status** (sem estados por linha), **Despacho** (grão é INV-02),
**Categoria pipeline** (não é campo de linha). O form `?q=` server da página
velha foi substituído pela busca client do grid.

**Hover mini-ficha** → expansão de linha (`renderExpanded`): alertas ativas,
totais do produto, breakdown fiscal, Futuro Comex e custo médio (só com
permissão). "Último despacho consumido" omitido (sem modelo vivo, D1-bis).

## 2. Fonte-da-verdade e a coluna "Total" abandonada

`Producto.stockActual` é agregado **legacy** = Σ `cantidadFisica` apenas de
depósitos NACIONAL (código: `replayStockNacional`, `stock-recalc.ts`;
comentário `schema.prisma:1943-1952`). A matriz velha misturava fontes: células
por depósito de SPD + coluna "Total" de `stockActual`. O worklist usa
**exclusivamente SPD** (grão exato producto×depósito); `stockActual` não
aparece em lugar nenhum. O KPI "Σ físico" soma TODOS os depósitos (rotulado) —
mudança de semântica intencional vs o "Total" antigo. A semântica NACIONAL-only
sobrevive em `totalFisicoNacional` (base do bajo mínimo), derivada das linhas —
sem ler o campo legacy.

## 3. Fórmula do Disponível (documentada)

```
disponible = cantidadFisica − cantidadReservada        // por linha SPD
```

É EXATAMENTE a fórmula da matriz atual (`inventario-matrix.tsx`, célula
"Disp.") e a mesma do engine (`validarDisponible` em `stock-helpers.ts`,
apenas ESPELHADA — jamais invocada). O termo canônico "− em conferência" é
estruturalmente 0 (sem modelo); a fórmula completa do OD-04 fica
`física − reservada − conferência(=0 até existir modelo)`. Pode ser negativa —
exibida como está (badge critical), nunca clampada.

## 4. Mapa coluna → fonte (queries batched, zero N+1)

`listarInventarioWorklist(verCosto)` dispara **5 fetches em um `Promise.all`**
(4 sem permissão de custo) + 1 query condicional de metadados pipeline:

1. `stockPorDeposito.findMany` — select estreito **SEM costo** (produto:
   codigo/nombre/marca/medida/stockMinimo; depósito: nombre/tipo), where
   `producto.activo && deposito.activo && (física≠0 || reservada≠0)`, cap
   10.000, `orderBy (codigo, depósito)`. O filtro `deposito.activo` espelha a
   página velha (a matriz só renderizava depósitos ativos; um depósito
   soft-deleted com estoque residual fica fora — anomalia documentada).
2. `fetchCostos()` — **só executa com `VER_COSTO_STOCK`** (§5). Usa o MESMO
   where + **MESMO orderBy** + take da base: se o cap for atingido, os dois
   subconjuntos truncados ficam alinhados (LIMIT sem ORDER BY seria
   arbitrário no Postgres) — travado por teste.
3. `listarEnTransito()` — reuso VERBATIM da query da tab velha.
4. `listarEnProduccion()` — idem.
5. `itemDespacho.findMany` (estado BORRADOR, select 2 campos).
6. `producto.findMany({ id: { in: faltantes } })` — SÓ quando há produtos
   pipeline-only (§1), batched pelos ids.

Derivações = Maps in-memory sobre esses resultados (helpers puros ≤ 8 CCN):
`agregadosPorProducto` (fiscal + total nacional), `indexarFuturoComex` (corte
hoy+90d; **itens sem data INCLUÍDOS**), `indexarDespachos` (distinct),
`derivarAlerta` (negativo > bajo_minimo > sin_movimiento≥90d), `proyectarFila`.

"Sin movimiento" usa `SPD.ultimoMovimiento` (zero query extra; **não** se faz
groupBy em `MovimientoStock` — sem índice por fecha). Caveat best-effort: o
branch de update de `recalcularSPDPorProducto` não atualiza `ultimoMovimiento`
após replay → o badge pode ficar stale; aceito e documentado (o fix tocaria o
engine intocável).

## 5. Prova do gate `VER_COSTO_STOCK` (server-side, consume-or-omit)

- **Serviço**: o custo viaja numa **query separada** (`fetchCostos`) que sem a
  permissão **NI SE EJECUTA** — o valor não sai do SQL (endurecimento vs o
  `stripCostosMatriz` pós-fetch da action antiga; mesma garantia CRIT-10).
  Toda fila leva `costoPromedio: null`. Espelho do padrão "query separada"
  do PR-024.
- **Grid**: `buildInventarioColumns({verCosto})` → `return verCosto
  ? [...base, costo] : base` — a coluna **não é construída** (jamais "—").
- **Export**: `exportarInventarioWorklist` re-chequeia `puedeVerCostoStock()`
  server-side (nunca confia no cliente) e `buildColumnas(verCosto)` omite a
  coluna do arquivo; o evento de auditoria registra as colunas efetivas.
- **Trabado por teste**: `test/inventario-worklist.test.ts` (a query de costos
  não executa; select da base sem `costoPromedio`; filas null) e
  `test/inventario-export.test.ts` (header sem "Costo promedio"; projeção
  pedida com `false`).
- Boolean PRE-resolvido no caller (page/action via `puedeVerCostoStock()`); o
  serviço nunca importa permisos/auth (convenção fin-cxc/PR-026).

Export: a página não tem permissão de acesso própria (quantidades visíveis a
toda sessão — espelho da página atual), então a action exige **sessão**
(`requireSessionUser`, FK-safe p/ o evento) + re-check de custo. **Zero chaves
novas** (restrição do PR; a permissão autônoma `export_excel` do
05_WORKLIST_PATTERN segue como desvio já aceito pela série — PR-026 usa o
mesmo shape sessão+re-check).

## 6. Paridade com a matriz velha (evidência)

- Cada célula (producto, depósito) visível hoje aparece com números idênticos:
  `fisico = cantidadFisica`, `reservado = cantidadReservada`,
  `disponible = física − reservada` — trabado por
  `test/inventario-worklist.test.ts` ("paridad con la matriz vieja") sobre
  fixture de 6 células (3 produtos × 3 depósitos, incl. fiscal e negativos).
- **Superset documentado** (não é divergência de valor): o worklist inclui
  posições com física **negativa ou só reserva** (`≠ 0`), que a matriz
  escondia (`gt: 0`), para a view [Negativos] ser honesta; e não corta em 100
  produtos (cap defensivo 10.000).
- A coluna "Total" (stockActual) não tem equivalente no novo grão (§2).
- Toggle `?agrupar=deposito` = reordenação pura server-side (o grid NÃO tem
  grouping — `getGroupedRowModel` não é importado): mesmo multiset de ids e
  mesmos totais, trabado por teste ("presentación pura"). Sem group headers
  visuais (limite do grid, aceito).

## 7. Engines untouched / nothing recomputed (prova)

- `git diff --name-only` do PR: **zero** linhas em `stock.ts`,
  `stock-recalc.ts`, `stock-helpers.ts`, `embarque-zpa.ts`, actions de
  movimientos, transferencias, asientos, engine de contenedor, motor de rateio
  comex, `enterprise-data-grid.tsx`, schema/migrations, permissões
  (catálogo/resolver/seed).
- O serviço novo importa apenas: `db` (2 findMany read-only),
  `listarEnTransito`/`listarEnProduccion` (queries read-only já existentes) e
  enums gerados. Nenhum import de engine — verificável por grep.
- `costoPromedio` é o valor armazenado pelo engine; o serviço só o converte a
  string (serialização RSC). Nada é recalculado.
- Fluxo de transferencias byte-idêntico (nenhum arquivo tocado; link mantido).

## 8. Arquivos

**Criados**
- `src/lib/services/inventario-worklist.ts` — projeção + helpers de vista.
- `src/app/(dashboard)/inventario/_components/inventario-columns.tsx`
- `src/app/(dashboard)/inventario/_components/inventario-worklist.tsx`
- `src/app/(dashboard)/inventario/_components/inventario-export-button.tsx`
  (espelho de `fin-cxc-export-button.tsx`; separado do wrapper pela convenção
  da série + gate Codacy)
- `src/lib/actions/inventario-export.ts` — export auditado (adição justificada
  à lista do enunciado: o objetivo C exige export auditado e o padrão da série
  é action dedicada).
- `test/inventario-worklist.test.ts`, `test/inventario-export.test.ts`
  (vitest puro com `vi.mock` — padrão REAL das séries 025/026; **não**
  Testcontainers, correção ao enunciado).
- Este documento.

**Modificado**
- `src/app/(dashboard)/inventario/page.tsx` — único tracked modificado.

**Não tocados (deliberado)**
- `nav-config.ts`/`nav-model.ts`: `nav-model.ts` já tem
  `{ label: "Stock general", href: "/inventario", pageCode: "INV-01" }` —
  nenhum fix necessário.
- `_components/{inventario-tabs,inventario-matrix,en-produccion-table,`
  `en-transito-table,stock-aduanero-table}.tsx`: ficam **órfãos** (sem
  referência) — remoção em PR de cleanup; deletar quebraria o rollback
  trivial. `listarMatrizInventario`/`listarStockAduanero` seguem exportadas
  (a última cobre o detalhe por contenedor, grão INV-02).

**Rollback** = revert de `page.tsx` (tabs+matriz voltam intactos).

## 9. Não-objetivos (defer)

Reservado como view/breakdown por pedido; Em conferência/conteo físico;
Bloqueado geral + [Bloqueado]; [Divergencias] geral; ajuste manual de stock
(`adjust_stock` não existe; approvals — PR dedicado); INV-02 estoque por
despacho/lote (PR-037); LOG-01; devoluções; mudanças FIFO/CMV; schema; chaves
novas; endurecimento CSV-injection de `src/lib/export/csv.ts` (dívida conhecida
PR-026 §10 — fora do escopo behavior-preserving).

URLs antigas `?tab=`/`?q=` são ignoradas silenciosamente (sem quebra).

## 10. Review multi-agente do diff (aplicado antes de fechar)

4 lentes (correção, exposição de dados, conformidade, convenções) + verificação
adversarial por finding (21 brutos → 19 dedup). **Confirmados e corrigidos**:

1. *(major)* Produtos pipeline-only invisíveis + vista [En tránsito] herdava o
   corte de 90d → filas sintéticas + `enTransitoTotal`/`enProduccionTotal` sem
   corte (§1), travado por teste.
2. `DateBadge` (semântica de vencimento) pintava toda a coluna "Últ.
   movimiento" de vermelho → data neutra (`fmtDateOrDash`); o sinal de
   inatividade é o badge "Sin movimiento" (≥90d).
3. `fetchCostos` sem `orderBy` com `take` → subconjunto arbitrário acima do
   cap → mesmo `orderBy` da base (§4.2) + teste.
4. `esDepositoFiscal` usava `subtipo ≠ null` → divergia da partição do engine
   (tipo-only) → critério `tipo === ZONA_PRIMARIA` somente (§1).
5. `WHERE_STOCK_VIVO` não filtrava `deposito.activo` → depósitos inativos
   ressurgiam (a matriz velha só mostrava ativos) → filtro adicionado (§4.1).
6. Mini-ficha "Alertas" omitia "Sin movimiento" quando havia alerta mais
   severa (o ladder de `r.alerta` mascarava) → re-derivação de TODAS as
   alertas ativas dos campos crus.
7. CCN > 8 (lizard 1.23, motor do Codacy): `proyectarFila` 15 e
   `InventarioFilaExpand` 11 → split em sub-helpers/sub-blocos; medição final:
   **138 funções, zero acima de 8** (`uvx lizard -l typescript -C 8`).

**Refutados (sem ação)**: reset de paginação ao trocar vista (o autoReset do
TanStack cobre — verificado empiricamente); biome nos arquivos de teste (o
`biome:ci` do CI é escopado a `src/`).

## 11. Validação (executada em 2026-07-02/03, DB local descartável)

- `pnpm prisma generate` ✅ · `pnpm typecheck` ✅ · `pnpm build` ✅
- `pnpm biome:ci` ✅ (0 erros; 48 warnings pré-existentes = idênticos ao main
  pristine, verificado por stash-control) · `pnpm lint` (eslint) ✅ exit 0
- `pnpm test` ✅ **1284/1284 → 1285/1285 pós-fixes** (168/169 arquivos; inclui
  os 14 novos: 9 worklist + 5 export)
- Lizard CCN ≤ 8 em 100% das funções novas ✅
- **`pnpm db:validar-stock` + `pnpm db:validar-asientos` ✅ antes E depois do
  QA** (Postgres 18 descartável porta 55432; fixture respeita as invariantes
  1-3 — por isso [Negativos] não é exercitável em DB validador-verde: o caminho
  negativo fica travado pelos testes unitários).

## 12. QA manual (Postgres descartável + dev server :3027, login admin/admin123 — NUNCA prod)

Fixture: 3 produtos em {NACIONAL, ZONA PRIMARIA ADUANEIRA} (4 células SPD:
100/20, 300/0 c/ `ultimoMovimiento` 2026-01-01, 40/0, 25/25; invariantes do
validador respeitadas) + QA-1004 pipeline-only (embarque EN_TRANSITO ETA+30d,
504 un, sem SPD).

1. ✅ Grid densa 1 linha/producto×depósito; frozen Producto/SKU/Depósito;
   **números idênticos à fixture** (100/80/20 · 300/300/0 · 40/40/0 · 25/0/25);
   KPIs Σ465 · 3 productos · 0 negativos · 1 bajo mínimo.
2. ✅ Views: [Bajo mínimo] 2 filas QA-1001 · [En fiscal] 2 · [Sin movimiento
   90d/180d] 1 (182 dias) · [Negativos] vazio (correto) · toggle "Por
   depósito" reagrupa contíguo sem mudar o conjunto.
3. ✅ **Gate ao vivo nos DOIS sentidos**: sessão com JWT stale (user
   inexistente ⇒ `hasPermission` false) → coluna Costo **inexistente** e
   payload RSC com `"costoPromedio":null` e **zero** ocorrências de
   123.45/119.00/95.50/"Costo" no HTML inteiro; login fresco (admin) → coluna
   "Costo prom." com 123,45/119,00/95,50 + custo na mini-ficha. (Com RBAC off
   não há usuário válido sem a chave — design PR-011; o caminho determinístico
   está travado pelos testes.)
4. ✅ Export CSV da vista [Bajo mínimo] → arquivo com exatamente as 2 filas da
   vista + coluna de custo (sessão com permissão); evento **EXPORTACION** no
   `AuditLog` (pagina=inventario, nFilas=2, filtros {vista,dias,agrupar},
   colunas efetivas) e visível em `/sistema/auditoria`.
5. ✅ Fila pipeline ao vivo: QA-1004 na vista [En tránsito] com depósito
   sintético "En tránsito / producción", quantidades 0, badge F 504.
6. ✅ Transferencias renderiza intacta (fluxo não tocado); EntityLink de
   depósito navega à ficha real; zero erros de console/server.
