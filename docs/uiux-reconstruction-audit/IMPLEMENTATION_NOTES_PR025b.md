# IMPLEMENTATION NOTES — PR-025b · Tesorería TES-02 · Pagos (slice 025b-1)

> Onda 2 (adoção de padrões por módulo). UI-only, behavior-preserving. Slice 2 do
> guarda-chuva PR-025 (025a = TES-01 Bancos, mergeado #364). **Split aprovado pelo dono**:
> **025b-1** (este) = worklists pagos-historial + saldos-proveedores + gate `VER_SALDO` +
> 2 drawers→FWW (anticipo/préstamo) · **025b-2** (futuro) = 4 dialogs de negócio da CxP→FWW
> (`PagarVepDialog`, `PagarRefuerzoVepDialog`, `PagarVepDespachoDialog`, `PagoFacturaDialog`).
> Base: branch limpo de `origin/main` (`3e6b6901`).

## Decisões do dono (aprovação do plano, 2026-07-01 — defaults adotados)

1. Sem `VER_SALDO` em `saldos-proveedores` → **página inteira omitida** (aviso restrito
   server-side): todo o conteúdo é agregado de saldo e o batch é saldo-driven.
2. **Bypass residual documentado** (rollout em etapas — ver seção própria).
3. **Split em 2 PRs** (este é o 025b-1; CxP dialogs→FWW ficam para o 025b-2).
4. **Export auditado DEFERIDO** (espelho 025a; `exportSurface={false}` nos 2 grids).
5. Árvore suja `.codacy/codacy.yaml` descartada antes do branch (artefato da Codacy CLI).

## Mapa superfície → serviço/action (READ/CALL verbatim, motor intocado)

| Superfície | Lê (READ) | Chama (CALL, payload byte-idêntico) |
|---|---|---|
| `/tesoreria/pagos-historial` worklist | `getHistoricoPagos(filtros URL)` — já row-shaped, **sem projeção nova** | — (read-only; EntityLinks proveedor/asiento) |
| `/tesoreria/saldos-proveedores` worklist | `listarSaldosProveedoresWorklist(verSaldo)` → `getSaldosPorProveedorConAging()` (só com permiso) + `listarCuentasBancariasParaMovimiento` + `listarProveedoresParaIntermediario` + `getDefaultFecha` | `crearMovimientoTesoreriaAction` (pago directo) / `pagarConIntermediarioAction` (intermediário) |
| Anticipo work window | `getAnticipoDetalle` + `listarFacturasAplicablesProveedor` (lazy, no efeito) | `aplicarAnticipoProveedorAction({anticipoId, compraId XOR gastoId, montoArs})` · `anularAnticipoProveedorAction({anticipoId})` |
| Préstamo work window | `obtenerPrestamoDetalle` (lazy) | — (CTA Amortizar = Link `/tesoreria/movimientos/nuevo?prestamoId=…&modo=amortizacion`) |

## Cânone TES-02 (8 colunas, ApxA #222-229) vs shipped/omitido

| # | Coluna canônica | Shipped em pagos-historial | Motivo se omitido |
|---|---|---|---|
| 222 | Fornecedor (EntityLink) | ✅ `ProveedorCell` → `/maestros/proveedores/[id]` | — |
| 223 | Documento (EntityLink CxP/FA/Comex) | ◐ `FacturasCell` (badges C/G/EMB idênticos ao legado) | facturas de origem "embarque" só trazem `embarqueCodigo` (sem id) → sem deep-link a `/comex/embarques/[id]` sem mudar `historico-pagos.ts` (proibido — consume as-is) |
| 224 | Valor (DualCurrencyAmount) | ✅ Monto (nativo) + ARS + TC — **`DualCurrencyAmount`/`MoneyCell` NÃO existem no repo** (docs mandam não recriar); rendering idêntico à tabela legada | — |
| 225 | Moeda | ✅ | — |
| 226 | Banco | ✅ `cuentaBancariaLabel` | — |
| 227 | Data programada (âmbar/vermelho) | ❌ → coluna **Fecha** (pago executado) | exige modelo FIN-04 (programación) — não existe no schema → Onda 3 |
| 228 | Status (Programado→…→Conciliado) | ❌ → **Método** + **Dif. cambio** onde há dado | pipeline de status de pago não existe no schema (todos os rows são CONTABILIZADOS por contrato do serviço) → Onda 3 |
| 229 | Comprobante (badge) | ❌ | sem modelo de comprobante/storage → Onda 3 |

Colunas 1-3+7 congeladas do cânone → adaptado: **Fecha + Proveedor pinned left** (as
colunas canônicas congeláveis que existem). Extra shipped além do cânone: TC, ARS, Dif.
cambio (gain/loss com sinal), Asiento (EntityLink) — herdadas da tabela legada.

## Drawer/container → FloatingWorkWindow (prova "mesmo body/action")

| Origem | FWW nova | Body | Actions (verbatim) |
|---|---|---|---|
| `anticipos/anticipo-detalle-sheet.tsx` (Sheet) | `anticipo-detalle-work-window.tsx` | header→props `title`/`description` (badges idênticos); `<div className="flex flex-col gap-6 p-6">` **verbatim** (dl + aplicaciones + form Aplicar + seção Anular); lazy fetch idêntico incl. `// eslint-disable-next-line react-hooks/set-state-in-effect` e `TODO(fase-4)` copiados | `getAnticipoDetalle` + `listarFacturasAplicablesProveedor` (CALL); `aplicarAnticipoProveedorAction({anticipoId, compraId, gastoId, montoArs})` e `anularAnticipoProveedorAction({anticipoId})` — payloads byte-idênticos |
| `prestamos/prestamo-detalle-sheet.tsx` (Sheet) | `prestamo-detalle-work-window.tsx` | read-only; header→props; body verbatim (dl + asiento + amortizaciones + `AmortizacionCTA`) | só CALL de `obtenerPrestamoDetalle` |

- Dialog de confirm de anular do anticipo: era filho do `<Sheet>` root → agora **irmão** da
  FWW (a FWW não tem slot de "root children"; padrão `nueva-cuenta-work-window`). Dialogs
  de confirm das tabelas seguem Dialog (precedente 025a — G-04 só bane drawer de FORM).
- Delta de UX assumido (paradigma FWW da casa, igual cuentas/movimientos): outside-click
  não fecha (`dismissOnOutsidePress=false`), sem backdrop opaco (página atrás interativa),
  ESC/X fecham. Swap nos call-sites: `anticipos-table.tsx` e `prestamos-table.tsx` (mesmos
  triggers, mesmo estado `detalle`, deep-links `?anticipoId=`/`?prestamoId=` preservados —
  o seeding server-side via `anticipoInicial`/`prestamoInicial` não mudou).
- Sheets legados **mantidos em árvore, não importados** (rollback; não deletar no 025b).

## Gate `VER_SALDO` — prova de masking server-side (no-call)

- Chave existente `tesoreria.verSaldo` (PR-025a; CAMPO; em `USER_BASE_CLAVES` ⇒ **RBAC OFF =
  zero regressão** — nada muda para nenhum usuário no estado atual de prod). NENHUMA chave
  nova; catálogo/seed/resolver intocados.
- `src/lib/services/saldos-proveedores-worklist.ts`: `listarSaldosProveedoresWorklist(false)`
  **não invoca** `getSaldosPorProveedorConAging` (motor de aging de 5 camadas nem roda) e
  devolve `null`. O boolean chega pré-resolvido da page (`puedeVerSaldo()`), padrão CRIT-10
  sancionado pelo 025a (resolução no caller; projeção nunca importa permisos/auth).
- `saldos-proveedores/page.tsx`: sem permiso, **short-circuit antes do `Promise.all`** — a
  page devolve h1 + aviso "Acceso restringido" server-rendered (markup espelho do
  `DeniedPage` de `permission-gate.tsx`; NÃO se usa o `PermissionGate` client como controle,
  que serializaria os saldos no payload RSC mesmo negado). Omitidos também: KPIs, contador
  do header, links "Todos/Solo con vencidas", batch (saldo-driven), `intermediarios`/
  `cuentasBancarias`/`tc` (nem são buscados).
- Coberto por `test/saldos-proveedores-worklist.test.ts` (espelho de
  `cuenta-bancaria-worklist.test.ts`; mocka só `@/lib/services/cuentas-a-pagar`, sem mock de
  `db` — a projeção não tem query própria): false ⇒ `not.toHaveBeenCalled()` + `null`;
  true ⇒ `toHaveBeenCalledOnce()` + pass-through por referência.
- `pagos-historial` **NÃO é gateada** (decisão de escopo 025a): monto transacional de pago
  individual lido de asiento CONTABILIZADO não é "saldo" — segue o comportamento atual.

### ⚠️ Bypass residual (rollout em etapas — sign-off do dono no plano)

O MESMO dado de aging sai sem gate em 2 rotas irmãs: `/tesoreria/cuentas-a-pagar`
(`getSaldosPorProveedorConAging` direto) e `/tesoreria/movimientos/nuevo` (via
`getFacturasPendientesPorCuenta`). Gatear a CxP inteira conflita com o re-host
container-only do 025b-2, e gatear movimientos/nuevo quebraria o form de pago individual.
**O gate nasce parcial** (controla a superfície mais rica — aging completo + USD nativo por
proveedor) até o slice CxP/follow-up. As mutations (`crearMovimientoTesoreriaAction`/
`pagarConIntermediarioAction`) também seguem invocáveis por usuário sem `VER_SALDO` — o
gate é de visão de campo, não permissão de ação (essa é a trilha PR-012/PR-014).

## Evidência de payload idêntico (batch de saldos — fonte decomposta)

`saldos-batch-pago.tsx` (legado, mantido em árvore) tinha CCN 33 e 728 NLOC — cópia
1-arquivo REPROVA o gate Codacy/Lizard (≤8/50/500, medido com lizard 1.22.2). A fonte foi
decomposta em **3 módulos** com **runtime idêntico**: `batch-pago-helpers.ts` (lógica pura,
105 NLOC), `batch-pago-form-sections.tsx` (JSX de apresentação, 351 NLOC) e
`batch-pago-panel.tsx` (estado + submits + composição, 203 NLOC — todas as funções CCN ≤ 8).
Mapa bloco-a-bloco (linhas do legado → novo local):

| Bloco legado (`saldos-batch-pago.tsx`) | Novo local |
|---|---|
| `:75-89` `fmtBucketPres` (client-safe, sin_fecha→al_dia) | `saldos-proveedores-columns.tsx` — **verbatim** |
| `:143-147` fold `totalSeleccionado` (`Number.isFinite`) | `batch-pago-panel.tsx` — verbatim |
| `:151-158` `toggle` (Set funcional) | `saldos-proveedores-worklist.tsx` — verbatim (em `useCallback`) |
| `:160-162` `subtotalFacturas`/`montoTransferidoNum`/`diferencia` | `batch-pago-panel.tsx` — verbatim |
| `:165-178` validações + toasts (ordem preservada) | `batch-pago-panel.tsx` `onSubmit` — verbatim |
| `:183-193` `sufijoFacts` (filtro `!startsWith("Factura #")`, slice 5, "…") | helper `buildSufijoFacts` — verbatim (Layer-1 fallback LOAD-BEARING) |
| `:195-214` FIFO (`sort localeCompare(fecha)`, `remaining.lte(0.005)`, `tomar.toFixed(2)`, embarque→`{tipo:'embarqueCosto', id:Number(f.id)}`) | helper `distribuirPagoFifo` — verbatim |
| `:216-221` linea (`monto` = `override !== undefined ? override : p.saldoTotal` — STRING cru; `descripcion` `.slice(0,255)`; `appliedTo` `undefined` se vazio) | helper `buildLineas` — verbatim |
| `:224-231` `descripcionFinal` (slice 3 nomes, "…") | helper `buildDescripcionFinal` — verbatim |
| `:244-255` payload `pagarConIntermediarioAction` (`moneda:"ARS"`, `tipoCambio:"1"`, `montoTransferido: montoTransferidoNum.toFixed(2)`, `beneficiarioCuentaId`) | `submitConIntermediario` — verbatim |
| `:260-265` mensagens de diferencia (anticipo/saldo_pendiente/exacto) | helper `mensajeIntermediario` — verbatim |
| `:280-290` payload `crearMovimientoTesoreriaAction` (`tipo:"PAGO"`, ARS/TC=1) | `submitDirecto` — verbatim |
| `:267-275`/`:296-301` resets pós-sucesso + `router.refresh()` | `onPaid()` (seleção+overrides na worklist) + `resetFormComun()`/extras no panel — mesmo conjunto de resets por caso |
| `:315-318` `allSelectableIds` (select-all) | `SelectAllHeader` — evolução filter-aware: itera `table.getPrePaginationRowModel()` filtrado por `cuentaContableId !== null` (sem busca ativa ≡ legado) |
| `:605-665` preview do asiento (DEBE/HABER/diferencia) | `AsientoPreview` — verbatim (enumera TODA a seleção, incl. linhas ocultas por busca/página) |
| `:778-803` chips de facturas (fila extra colSpan=8) | `FacturasChips` → `renderExpanded` do grid — conteúdo verbatim + fallback "Sin facturas pendientes." |

Invariantes de fronteira numérica preservados: preview/subtotal em `Number` float,
payload em `Decimal`/`.toFixed(2)` — exatamente como o legado. `??` (não `||`) no value do
Input de override. **Bug pré-existente preservado de propósito** (flag p/ follow-up, NÃO
corrigido aqui): limpar o Input "A pagar" deixa `montosOverride=""` → `new Decimal("")`
lança de forma síncrona antes do transition (comportamento atual idêntico).

Anti-focus-loss (verificado contra TanStack 8.21/flexRender): colunas memoizadas só com
`[moneda, tc]`; seleção/overrides viajam por `BatchPagoContext` (value `useMemo`'d, setters
funcionais estáveis); `data={proveedores}` com identidade estável (nada mesclado na row —
evita `autoResetPageIndex`). Panel sempre montado (renderiza `null` sem seleção) para que
cuenta/fecha sobrevivam a limpar a seleção, como no legado top-level.

## Prova de motor intocado

`git diff --name-only` desta fatia lista SOMENTE: UI de tesorería (pagos-historial/,
saldos-proveedores/, anticipos/, prestamos/) + a projeção NOVA
(`saldos-proveedores-worklist.ts`, aditiva, CALL-only) + teste novo + este doc. **Zero diff**
em: `pago-exterior.ts` (invariante USD E1-E7 — nem é importado pelo diff),
`movimientos-tesoreria.ts`, `anticipos-proveedor.ts`, `prestamos.ts`,
`retencion-ganancias-pago.ts`, `historico-pagos.ts`, `cuentas-a-pagar.ts` (incl.
`getPagosUsdPorCuenta`/`pagadoUsdParaFactura` — matemática compartilhada view↔engine),
`saldo-usd-nativo.ts`, `prestamo.ts`, motor de asientos, `enterprise-data-grid.tsx` (o
design não exigiu nenhuma mudança no grid compartilhado), schema/migrations/seed/auth/
permisos-catalog/permisos-masking.

Suites que pinam o motor (devem seguir 100% verdes): `ciclo-canonico` (E7 golden),
`pago-exterior-action`, `saldos-exterior-usd`, `diferencia-cambiaria-*`,
`retencion-ganancias-*`, `anticipo-proveedor*`, `prestamo-saldo-usd`,
`tesoreria-usd-libro-ars`, `vep-despacho-action`, `saldos-proveedores-multimoeda`,
`aging-presentacion`, `pick-saldo-nativo`.

## `db:validar-asientos` — antes/depois

**NÃO rodado nesta máquina de propósito** (mesmo racional do 025a): o `DATABASE_URL`
default aponta para **Railway/prod** → rodá-lo seria tocar produção (STOP condition). A
validação equivalente: (a) prova de motor intocado por diff (acima) — a geração
`movimiento → asiento` é byte-idêntica; (b) suites Testcontainers cobrem os asientos dos 4
fluxos afetados. Rodar `pnpm db:validar-asientos` no QA visual local (Postgres descartável)
antes/depois de executar os fluxos pela UI.

## Deltas de UX documentados (UI-only, sem impacto de payload)

1. Chips de facturas em saldos-proveedores: de fila extra SEMPRE visível → expansão por
   chevron (`renderExpanded`; o grid não tem auto-expand). Toda linha mostra chevron; sem
   facturas → fallback textual.
2. Tinte de linha (vermelho p/ vencidas, primary p/ selecionada) do legado não tem hook no
   grid → substituído pelo destaque já existente na célula Vencido (vermelho bold).
3. Select-all é filter-aware (só linhas visíveis selecionáveis, todas as páginas); sem
   busca ativa ≡ comportamento legado. Linhas selecionadas e depois ocultas por busca
   PERMANECEM na seleção (o `AsientoPreview` enumera todas — igual legado, que não tinha busca).
4. pagos-historial ganha busca rápida/orden/paginação client + chip Método (derivado);
   os 5 filtros de DADOS seguem server-driven por URL em `PagosHistorialFilters` (intacto).
   Total do header segue server-side sobre o conjunto completo (busca in-grid não o refaz —
   mesmo padrão do grid de movimientos).
5. FWW não fecha em outside-click e não tem backdrop opaco (paradigma da casa).

## Não-modificados que seguem vivos (atenção)

- `pagos-historial-table.tsx` segue **VIVA** — consumida pela aba Pagos da ficha de
  proveedor (`maestros/proveedores/[id]/page.tsx`). Não é código morto; não deletar.
- Mortos-em-árvore (rollback, não importados): `saldos-batch-pago.tsx`,
  `anticipo-detalle-sheet.tsx`, `prestamo-detalle-sheet.tsx`.

## Validações (resultados — 2026-07-01, branch `pr-025b-tes02-pagos`)

- `pnpm prisma generate`: ✅ (Prisma Client 7.8.0).
- `pnpm typecheck`: ✅ (0 erros).
- `pnpm build`: ✅ (`/tesoreria/pagos-historial`, `/tesoreria/saldos-proveedores`,
  `/tesoreria/anticipos`, `/tesoreria/prestamos` compilam).
- `pnpm biome:ci`: ✅ exit 0 (44 warnings pré-existentes, 0 erros; arquivos novos formatados).
- `pnpm test`: ✅ **160 arquivos / 1223 testes** (1221 pré-existentes + 2 do
  `saldos-proveedores-worklist.test.ts`); suites do motor de pagos
  (`ciclo-canonico`, `pago-exterior-action`, `anticipo-proveedor*`, `retencion-ganancias-*`,
  `vep-despacho-action`, `saldos-proveedores-multimoeda` etc.) 100% verdes.
- **Lizard 1.22.2** (thresholds Codacy: CCN 8 / fn NLOC 50 / file NLOC 500 / params 8) no
  código novo: todos os arquivos < 500 NLOC; funções de composição/lógica novas CCN ≤ 8.
  **Exceções deliberadas e documentadas**: `AnticipoDetalleWorkWindow` (CCN 19, NLOC 146) e
  `PrestamoDetalleWorkWindow` (CCN 13, NLOC 132) — os bodies são cópias VERBATIM dos sheets
  (o objetivo da prova "mesmo body/action"); precedente empírico: o espelho
  `movimiento-detalle-work-window.tsx` do 025a (CCN 24, NLOC 97 pela mesma métrica) passou
  no gate Codacy e está mergeado em main (#364). Decompor os bodies quebraria a prova de
  verbatim sem ganho real.
- `pnpm db:validar-asientos`: NÃO rodado aqui (DATABASE_URL default = Railway/prod — STOP
  condition; ver seção própria). Rodar no QA local descartável.

## Rollback por superfície

- `pagos-historial`: reverter `page.tsx` para `<PagosHistorialTable/>` (componente vivo).
- `saldos-proveedores`: reverter `page.tsx` para `<SaldosBatchPago/>` + remover gate (o
  legado está em árvore); a projeção/chave são aditivas e inertes.
- Anticipos/Préstamos: reverter o swap de import nas tabelas (sheets em árvore).
- Ou `git revert` da fatia inteira.

## QA visual EXECUTADO (2026-07-01/02 — Postgres descartável `postgres:18-alpine` local, overrides `DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL`=localhost com guard de host; prod/Railway NUNCA tocada)

Dados semeados **via UI** (o próprio fluxo é QA): proveedor local + proveedor exterior, cuenta
bancaria ARS (via FWW do 025a), 2 gastos CONTABILIZADOS (asientos Nº 1-2), anticipos AP-0001/0002
(Nº 4/6), préstamo (Nº 7).

- **pagos-historial**: EnterpriseDataGrid com as 11 colunas na ordem legada; busca rápida (OR
  proveedor/banco/método/descripción) e chip Método client-side (URL intacta); orden client;
  filtro de DADOS server-driven confirmado (`?moneda=ARS` via `PagosHistorialFilters` intacto);
  EntityLink proveedor→ficha e asiento `#3`→`/contabilidad/asientos/[id]` navegando; **paridade
  com a tabela legada** provada na aba Pagos da ficha de proveedor (mesmos 11 headers, linha
  idêntica byte a byte, incl. o fallback de descripción — heurística do serviço, igual nas duas).
- **saldos-proveedores COM permiso**: grid + checkbox próprio + select-all filter-aware
  (busca ativa ⇒ select-all cobre só visíveis; seleção prévia PERSISTE — semântica documentada);
  Input "A pagar" com **foco persistente** (8 teclas digitadas uma a uma, valor `60000.00`,
  `document.activeElement` estável); expansão por chevron mostra os chips das 2 facturas;
  "Pagar solo" com href de params EXATOS; painel batch com subtotal respeitando override e
  preview DEBE/HABER; **batch-pago EXECUTADO** → asiento Nº 3 idêntico ao preview
  (`DEBE 2.1.1.01.10` 60.000 / `HABER 1.1.1.02.10` 60.000), saldo 150.000→90.000 (FIFO na
  factura mais antiga), painel limpo no sucesso.
- **FWW anticipo**: `data-slot="floating-work-window"` (não Sheet); title com badges; lazy fetch;
  Select de factura portalado abre e clica ACIMA da FWW (sem bug de stacking); **Aplicar
  EXECUTADO** (AP-0001 → "Aplicado total", asiento Nº 5); **Anular EXECUTADO** com confirm
  Dialog empilhado sobre a FWW (`elementFromPoint` confirma clicável; AP-0002 → ANULADO);
  deep-link `?anticipoId=` abre a FWW seedada em navegação real; ESC fecha. Nota de paridade:
  o deep-link via client-side `router.push` do dropdown "Aplicar a factura" não reabre a janela
  sem remount — mesma semântica do legado (`useState(anticipoInicial)` só seeda no mount).
- **FWW préstamo**: read-only, asiento de recepción com linhas, CTA Amortizar com deep-link
  exato. Wart pré-existente reproduzido verbatim: `banco · null` quando `numero` é null
  (template do sheet legado sem null-guard).
- **SEM `tesoreria.verSaldo`** (RBAC_ENABLED=true + user `qa_sinsaldo` com perfil USER +
  `UsuarioPermiso` revoke): `/tesoreria/saldos-proveedores` renderiza APENAS h1 + "Acceso
  restringido" (server-rendered). **Prova anti-leak**: fetch do documento completo (HTML +
  RSC flight, 60KB) com a sessão negada ⇒ **0 ocorrências** de 17 marcadores sensíveis
  (valores 90.000/150.000/40.000, `saldoTotal`, `vencido`, nome do proveedor, nº de factura,
  `montoNativo`, labels de KPI, banco) — nada escondido por CSS; os dados não existem no payload
  (no-call server-side). **Boundary**: o MESMO usuário vê `/tesoreria/pagos-historial` normal
  (montos transacionais não são saldo — escopo 025a) e em `/tesoreria/cuentas` a coluna Saldo
  está omitida — ou seja, `tesoreria.verSaldo` NÃO é gate genérico da Tesorería: é omissão
  campo-a-campo (TES-01) e, em `saldos-proveedores`, omissão da superfície inteira ANTES do
  fetch porque 100% do conteúdo é agregado de saldo e o batch é saldo-driven.
- **Regressão**: 025a íntegro (cuentas: grid+coluna Saldo+FWW de criação usada no seed;
  movimientos: grid date-bounded + drill-down FWW com asiento); comex cockpit renderiza
  (KPIs+calendário); `/comex/contenedores` devolve 404 **por design** (gate
  `CONTENEDOR_DESCONSOLIDACION_ENABLED` off do PR-024, `notFound()` na page).
- **Console**: nenhum erro originado das superfícies migradas. Achados pré-existentes
  reproduzidos verbatim (não-regressões): dev-warning base-ui "uncontrolled→controlled Select"
  do padrão `value={x || undefined}` (dispara igualmente em páginas intocadas: gasto form,
  anticipo form) e warning `nativeButton` do ShellUserMenu (nav, fora do escopo).
- **Cleanup**: dev server parado; container `qa-pr025b` removido; script temporário
  `prisma/qa-tmp-sinsaldo.ts` removido; `.playwright-mcp`/snapshots removidos; `tsconfig.json`
  (reescrito pelo Next dev) revertido. `db:validar-asientos`/`db:validar-stock` NÃO rodados
  por instrução explícita do dono neste QA (o `.env` default aponta a Railway/prod); prova
  equivalente = asientos Nº 1-7 gerados e conferidos pela UI (preview = asiento real) + suites
  do motor verdes + diff sem motor.

## QA manual (checklist — env local seguro, NUNCA prod/Railway)

Postgres descartável + `DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL=localhost`, login
admin/admin123:

1. `pagos-historial`: grid denso; filtros URL (proveedor/fechas/moneda/banco) funcionam;
   busca/orden/paginação; EntityLinks proveedor/asiento navegam; total do header idêntico;
   **aba Pagos da ficha de proveedor intacta** (tabela legada).
2. `saldos-proveedores` COM permiso: digitar valor multi-dígito no "A pagar" → foco
   persiste; select-all com busca ativa; expandir linha com/sem facturas; batch directo e
   com intermediário executam IDÊNTICO (mesmo asiento nº/linhas; diferencia
   anticipo/saldo_pendiente); "Pagar solo" com mesmos params. SEM permiso (perfil custom
   com RBAC ON): aviso restrito e payload RSC sem NENHUM valor (verificar no response da
   rede — gotcha notFound/200).
3. Anticipos: linha abre FWW central; Aplicar a factura executa igual (mesmo asiento);
   Anular via confirm SOBRE a FWW (stacking base-ui — abrir de verdade); deep-link
   `?anticipoId=`. Préstamos: FWW read-only; CTA Amortizar navega; deep-link `?prestamoId=`
   (incl. cross-link vindo do movimiento-detalle).
4. Abrir TODO Select/DatePicker dentro das FWWs (classe de bug base-ui runtime-only);
   ESC com popup aberto fecha o popup primeiro; outside-click não fecha.
5. `pnpm db:validar-asientos` verde antes/depois do QA (DB local).
