# PR-020 — CX-02 Comex Worklist de Processos — Implementation Notes

Migração da worklist de **Embarques** do Comex (`/comex/embarques`) da tabela TanStack crua para o
`EnterpriseDataGrid` (PR-003), seguindo o padrão PR-017 (worklist) + PR-010 (export auditado). **Read +
navegação + export auditado**; nenhuma mutação inline; **motor de rateio/despacho/custo intocado** (G-09 /
CRIT-04..09). Custo atrás do gate PR-011.

## Arquivos

**Criados**
- `src/lib/services/comex-worklist-derivaciones.ts` — helpers puros (sem `server-only`, sem I/O): `deriveEtaTono`,
  `fobEnUsd`, `deriveStatusCosto/Pago/Bloqueo`, `tonoContenedor`, mapas de tono, e as **vistas** (`VISTAS`,
  `parseVista`, `resolverVistaFiltro`). `now` é sempre injetado (determinístico, sem mismatch de hidratação).
- `src/lib/actions/embarques-export.ts` — server action `exportarEmbarques` (só lê + serializa + audita + gate).
- `_components/embarques-chips.tsx` — `TonoChip` + `ContainerChip` (tono local; não modifica `StatusBadge`).
- `_components/embarques-columns.tsx` — `buildEmbarquesColumns({verCosto})` data-driven + cell-renderers nomeados.
- `_components/embarques-expanded-row.tsx` — expand display-only (containers, facturas locales, acciones, costo gated).
- `_components/embarques-views-bar.tsx` — vistas + moneda server-driven (URL).
- `_components/embarques-export-button.tsx` — dropdown CSV/XLSX (mirror `AuditoriaExportButton`).
- `_components/embarques-worklist.tsx` — wrapper do `EnterpriseDataGrid`.

**Modificados**
- `src/lib/actions/embarques.ts` — `listarEmbarques` estendido (ADITIVO, só leitura): tipo `EmbarqueWorklistRow`,
  filtros por vista/moneda, includes/selects estreitos, `_sum(items.cantidad)`, derivações no servidor.
- `page.tsx` — parse `?vista`, resolve `verCosto`+`tc`, monta views-bar + worklist.

**Removidos** — `embarques-table.tsx`, `embarques-tabs.tsx`, `embarques-filters.tsx` (substituídos).

## Colunas (5 congeladas + 12 canônicas)

Congeladas: Processo (EntityLink→record), Proveedor (EntityLink→ficha), Status (`StatusBadge`), ETA (cor),
FOB/CFR (USD). Canônicas: PI/Proforma, Commercial Invoice, Containers (chips), Cant. neumáticos, Puerto,
Próxima acción, Responsable, Status costo, Status documentos, Status pago, Última actualización, Bloqueo, +
**Costo Total** (gated).

## Decisões

- **Gate de custo = `VER_COSTO_LANDED`** (`costos.verLanded` — "costo + flete + impuestos de importación" = o
  `costoTotal` landed). O catálogo de permissões **não tem** `ver_costo_comex`; reusamos a chave existente mais
  precisa (não tocamos o modelo de permissões). Enforcement em 3 pontos: (a) DOM — `costoTotal` vai `null` do
  servidor quando `!verCosto`; (b) export — coluna Costo dropada no servidor sob o mesmo gate; (c) expand — bloco
  Costo só com `verCosto`; o resumo de seleção **nunca** soma custo (só FOB comercial).
- **FOB/CFR sempre USD** convertendo pelo **`tipoCambio` do próprio embarque** (USD-nativo passa direto;
  ARS-nativo ÷ TC). Display puro; mesma base no export. O antigo toggle `?pres` foi removido (frozen col = USD fixo).
- **Status best-effort** (rotulados, derivados no servidor de `costos.{estado,fechaVencimiento}` — **sem** campos
  monetários): Status costo (Estimado/Provisionado/Facturado/Cerrado) e Status pago ("Al día/Vencido — local").
  Bloqueo deriva só de factura local vencida.
- **Export server-driven** (mirror PR-010): reproduz `?vista`+`?moneda`; a busca rápida in-grid **não** entra no
  arquivo (legenda visível no menu de export). Cap de export = `WORKLIST_MAX` (2000).

## Gaps sinalizados (sem schema, Fase 1)

- **PI / Proforma** e **Commercial Invoice** — não há model de fatura comercial externa; `EmbarqueCosto` são
  faturas **locais** de nacionalização. Colunas mostram `—`; o expand rotula a mini-tabela como "facturas locales".
- **Puerto** — sem porto de destino explícito; usamos `lugarIncoterm` como proxy.
- **Responsable** e **usuário em "Última actualización"** — sem `userId` no `Embarque` (Fase 1) → `—`. A coluna
  Última actualización mostra a data (`updatedAt`) + `—` para usuário.
- **Próxima acción** — sem campo; decisão explícita de **não derivar** (evita implicar workflow) → `—`. Edição
  pertence ao record CX-03 (PR-021).
- **Status documentos** — sem modelo de tracking documental → `—` (não derivado, para não implicar completude).
- **Status pago / Bloqueo** — best-effort: só refletem **gastos locais** (`EmbarqueCosto` EMITIDA vencida); **não**
  refletem a dívida exterior FOB nem pagamentos parciais (`AplicacionPagoEmbarqueCosto`); "Pagado" do spec não é
  derivável sem dados de pagamento (4 de 5 tiers de Status costo).
- **Vistas** `Documentos pendientes`, `En producción`, `Cancelados` — **desabilitadas** (sem dado/estado no schema;
  o enum `EmbarqueEstado` não tem `CANCELADO`). Hint explicativo no botão.
- **Containers no expand** — chips mostram nº + estado; cantidad/depósito por container **não** são carregados
  (manter payload estreito); deep-link de container individual adiado (sem rota standalone).
- **Permissão de export Comex** — o catálogo não tem chave de `EXPORTACION` para Comex (≠ `auditoria.exportar`).
  Interino: ação **autenticada + auditada** (`requireSessionUser`) com gate de **custo** por `VER_COSTO_LANDED`.
  **Owed**: criar uma permissão dedicada de export Comex (paralela a `AUDITORIA_EXPORTAR`) em follow-up que toque o
  catálogo — não equiparar "ver custo" a "pode exportar o registro de processos".
- **Total vs cap** — `total` do header é o count do servidor; as linhas carregadas e o export são limitados a
  `WORKLIST_MAX` (2000). Acima disso, paginação server-driven seria necessária (follow-up).

## Anti-regressão (G-09)

`listarEmbarques`/`exportarEmbarques` são **só leitura**: `findMany`+`count`+`groupBy`+`.map()` e serialização. A
superfície de import do export é restrita a leitura+serialização+auditoria — **nunca** `services/comex`,
`asiento-automatico` ou `stock` (o motor). Os includes novos têm comentário "read-only worklist projection — never
consumed by rateio/despacho/asiento". Nenhuma mudança em `schema.prisma`, migrations, auth/JWT/session ou modelo de
permissões.
