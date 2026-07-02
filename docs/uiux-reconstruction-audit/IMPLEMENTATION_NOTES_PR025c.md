# IMPLEMENTATION NOTES — PR-025c · Tesorería TES-03 · Cobranzas (cuentas-a-cobrar worklist canónica)

Branch `pr-025c-tes03-cobranzas` (limpa de `origin/main` @ `a58aabf5`; 025a #364 e 025b #365+#366 mergeados).
Fatia final do guarda-chuva PR-025. **UI-only + read-only**: nenhuma mutação criada/alterada; motor CxC e
engines intocados; nenhuma chave de permissão nova; zero schema.

## Superfície → serviço/action (READ/CALL verbatim, motor intocado)

| Superfície | Fonte | Modo |
|---|---|---|
| Linhas do grid (aging por cliente) | `getSaldosPorClienteConAging()` via projeção `listarCuentasACobrarWorklist` | READ |
| Expand (ventas pendientes) | `SaldoClienteAging.ventas` (aninhado — **zero query nova**) | READ |
| KPI band (4 cards) | `sumarBucketsNativos`/`convertirBucket`/`sumarSaldosNativos` (chamadas idênticas ao legado) | CALL |
| Valores a cobrar (cheques 1.1.4.20) | `getCuentasACobrar().valoresACobrar` (seção mantida como estava) | READ |
| Export CSV/XLSX | action nova `exportarCuentasACobrar` → mesma projeção + `auditarExportacion` | READ + append auditoria |
| CTA "Cobrar" / "Registrar un cobro" | Links ao fluxo EXISTENTE `movimientos/nuevo?tipo=COBRO` (URL idêntica à legada) | LINK |

## Arquivos

**Criados (8):**
- `src/lib/services/cuentas-a-cobrar-worklist.ts` — projeção no-call (espelho `saldos-proveedores-worklist.ts`).
- `tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion.ts` — helpers PUROS client-safe (`fmtBucketPres`
  transcrição verbatim de 025b, `mayorAtrasoDias`, `cobrarHref`). Módulo sem JSX: "sin RTL en el repo → TDD vía
  helper puro" (idioma estabelecido, cf. `crm/oportunidades/pipeline/_helpers`).
- `tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-columns.tsx` — factory + renderers nomeados (CCN ≤ 8) + expand
  `VentasPendientesTable` (colunas VERBATIM do `VentaRow` legado).
- `tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-worklist.tsx` — EnterpriseDataGrid (quickSearch cliente/CUIT/cuenta,
  `renderExpanded`, export em `primaryAction`, `exportSurface={false}` — o botão nativo do toolbar é placeholder).
- `tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-export-button.tsx` — espelho `auditoria-export-button.tsx`.
- `src/lib/actions/cuentas-a-cobrar-export.ts` — espelho `embarques-export.ts`/`auditoria-export.ts`.
- `test/cuentas-a-cobrar-worklist.test.ts` + `test/cuentas-a-cobrar-export.test.ts`.

**Modificado (1 — ÚNICO tracked):** `tesoreria/cuentas-a-cobrar/page.tsx`. **Rollback = revert deste arquivo**
(os novos ficam órfãos e inertes). `loading.tsx` inalterado (skeleton compatível).

**Não tocados (prova por diff):** `services/cuentas-a-cobrar.ts`, `aging-presentacion.ts`,
`movimientos-tesoreria.ts`, engine de asientos, `saldo-usd-nativo.ts`, catálogo/resolver/seed de permissões,
`prisma/schema.prisma`, arquivos 025a/b.

## Mapa coluna → campo do serviço

| Coluna | Campo (`SaldoClienteAging`) | Render | Paridade com legado (page.tsx antigo) |
|---|---|---|---|
| Cliente (pinned) | `clienteNombre`+`cuentaCodigo`+`cuit` | `ClienteCell` | header do `ClienteCard` (:260-268) |
| Vencido | sort `Number(vencido)`; display `ventas` | `fmtBucketPres(ventas,"vencida",…)` | chip "Vencido:" (:271-274) |
| A vencer 7d | `Number(proximo)` / `ventas` | `fmtBucketPres(…,"proxima",…)` | chip "≤ 7d:" (:276-279) |
| Al día | `Number(alDia)` / `ventas` | `fmtBucketPres(…,"al_dia",…)` | chip "Al día:" (:281-284) |
| Mayor atraso | `ventas[].diasParaVencer` (min dos negativos) | `mayorAtrasoDias` — NÃO re-deriva aging (buckets já classificados) | novo display, data-backed |
| Facturas | `ventas.length` | contagem | novo display (sem valor monetário novo) |
| Saldo contable ({moneda}) | `saldoTotal`+`saldoTotalUsd` | `pickSaldoNativo`+`fmtMontoPres` | saldo grande do card (:250, :289-291) |
| Acciones | `cuentaContableId`/`saldoTotal`/`clienteNombre` | `cobrarHref` — URL VERBATIM (:237-247) | botão "Cobrar" |
| Expand | `ventas[]` | `VentasPendientesTable` | `VentaRow` verbatim (:299-378) |

## Prova de reuso da agregação nativa (lección #262/#263/#279)

- **Page (server)**: KPI band usa as MESMAS chamadas do legado — `sumarBucketsNativos(clientes.flatMap(...))` +
  `convertirBucket` ×3 + `sumarSaldosNativos([...data.clientes, ...data.valoresACobrar])` (diff da page mostra o
  bloco intacto). Nunca `totalGeneral + Σ saldoUsd` (dupla contagem — comentário do serviço).
- **Células (client)**: `fmtBucketPres` (módulo puro `cuentas-a-cobrar-presentacion.ts`) replica client-safe a
  MESMA via que a página legada usava por cliente — `fmtMoney(convertirBucket(sumarBucketsNativos(ventas)[b]))`:
  soma por moeda NATIVA, `sin_fecha` colapsa em `al_dia`, e **redondeio POR PERNA (uma vez por moeda)**.
  Deliberadamente NÃO é a cópia per-item da de `saldos-proveedores-columns.tsx:69-83` (025b): o review
  adversarial provou que redondear por item deriva 1 centavo do KPI/legado com 2+ ventas da mesma moeda num
  bucket (ex.: 2×10.000 ARS @1400 → per-item 14,28 vs per-perna 14,29) — lição "alinhar granularidade de
  redondeio" (bug 1ct do D4). Import direto de 025b tampouco tipa (`FacturaPendiente` exige `origen`) e
  `aging-presentacion` não entra em bundle client.
- **Trava anti-drift**: `test/cuentas-a-cobrar-worklist.test.ts` prova, para fixture multimoneda (ARS+USD, TC de
  cierre ≠ TC de emissão, venta `sin_fecha`), que `fmtBucketPres(...)` ===
  `fmtMoney(convertirBucket(sumarBucketsNativos(items)[bucket],...))` em cada bucket e nas duas monedas de
  apresentação; que vencido USD = `100 + 50000/1400 = 135,71` (um ÷tc cego daria 128,57); e o caso dedicado de
  granularidade (2 ventas ARS iguais → `14,29`, jamais o per-item `14,28`). **Grid == helpers da page por
  construção + por teste.**
- Semânticas distintas preservadas: buckets = agregação nativa das ventas; **Saldo contable** = valuação ARS do
  ledger convertida (ou perna USD-nata via `pickSaldoNativo`) — exatamente como o legado.

## Gate `VER_SALDO` — prova de masking server-side (no-call)

- Chave EXISTENTE `tesoreria.verSaldo` (BASE em `USER_BASE_CLAVES` ⇒ **RBAC OFF = zero regressão**). Nenhuma
  chave nova; catálogo/seed/resolver intocados.
- **Delta deliberado (sancionado pelo prompt)**: a página estava SEM gate — 025c fecha a superfície mais rica de
  CxC (aging completo + USD nativo por cliente), espelhando o racional TES-02.
- Enforcement em 3 pontos server-side:
  1. `page.tsx`: `puedeVerSaldo()` na PRIMEIRA instrução → sem permiso, short-circuit **antes** do `Promise.all`
     (aviso "Acceso restringido" server-rendered; markup espelho 025b; NÃO se usa `PermissionGate` client, que
     serializaria os dados no payload RSC mesmo negado). Omitidos: linhas, KPIs, expand, valores a cobrar, links.
  2. `listarCuentasACobrarWorklist(false)` → `null` **sem invocar** `getCuentasACobrar`/`getSaldosPorClienteConAging`
     (defesa em profundidade se um caller futuro esquecer o early-return). Boolean pré-resolvido no caller; a
     projeção nunca importa permisos/auth (padrão CRIT-10 de 025a/b).
  3. `exportarCuentasACobrar`: re-checa `puedeVerSaldo()` no server → nega inteiro (`{ok:false}`) sem ler a projeção.
- Coberto por teste: `not.toHaveBeenCalled()` + `null` (projeção); pass-through por referência com permiso;
  export nega e não audita sem permiso.
- **Bypass residual (rollout em etapas, mesmo padrão documentado em 025b)**: `movimientos/nuevo?tipo=COBRO` segue
  sem gate (form de cobro individual — gateá-lo quebraria o fluxo de cobro). O gate é de visão de campo, não
  permissão de ação (trilha PR-012/PR-014). Follow-up owed.

## Presets de URL (`?filtro`/`?moneda`) — lição PR-010

- `?filtro=vencidas` segue **preset server-side** (Links "Todos"/"Solo con vencidas" preservando `?moneda`,
  expressão `toDecimal(c.vencido).gt(0)` idêntica) — NÃO se usa o `SavedViewsBar` in-memory do grid (sem
  URL/persistência; sub-vistas oficiais = presets de URL). Links externos existentes seguem funcionando.
- `?moneda` 100% server-driven via `MonedaToggle` (param default `moneda` — em CxC é só apresentação).
- Vistas persistidas por usuário (`ui/saved-views.tsx`) fora de escopo — capturariam `?filtro`/`?moneda`
  automaticamente se montadas depois (serializam a URL); backlog.

## Export auditado — evidência

- Action `exportarCuentasACobrar({params:{filtro,moneda}, formato})`: `requireSessionUser()` (FK-safe) →
  `puedeVerSaldo()` → re-lê a projeção e aplica **o MESMO preset** `vencidas` da page → converte com os MESMOS
  helpers server (`sumarBucketsNativos`/`convertirBucket`/`convertirMonto`) → `toCsv`/`toXlsx` →
  `auditarExportacion({recurso:"cuentas-a-cobrar", filtros:{filtro,moneda,tc}, columnas, nFilas, formato})`.
  **Se a meta-auditoria falha, propaga — não se entrega arquivo sem registrar** (testado). Busca rápida in-grid
  não se aplica (consistente com PR-010/PR-020).
- Sem permiso de exportação dedicado no catálogo (mesmo gap documentado do Comex/PR-020) — action autenticada +
  gateada por `VER_SALDO` + auditada. 025a/b haviam adiado export (`exportSurface={false}`); 025c é o primeiro
  export de tesorería, espelhando o padrão consolidado comex/auditoría.
- Colunas do arquivo: Cliente · CUIT · Cuenta · Vencido/A vencer 7d/Al día ({moneda}) · Mayor atraso (días) ·
  Facturas pendientes · Saldo contable ({moneda}).

## Cânone TES-03 (OD-09) vs shipped/omitido

OD-09: o Q&A "TES-02 — Recebimentos" pertence a TES-03 (Cobranzas). **FLAG H/B1**: a fonte contém só os
enunciados; as respostas detalhadas NÃO foram ingeridas → valem os padrões globais + o corpo canônico.

**Shipped**: worklist densa per-cliente (PAGE-STD-01: busca rápida, orden, expand, paginação, colunas congeladas)
+ aging nativo + expand ventas + export auditado + gate de saldo + presets URL.

**Omitido (SEM modelo de dados — recebimentos são `movimientos`, não documentos; não fabricar semântica):**
recibo/PDF · status "a reconocer"/valores a reconhecer · promessas de pago · aplicar-un-cobro-en-varios-títulos ·
estorno-reabre-título · status separado de cheque/valores en tránsito (a carteira 1.1.4.20 aparece como saldo
agregado, como no legado) · comprobante badge/upload · aba de conciliación · coluna Banco por recebimento ·
crédito do cliente por excedente. → Defer a FIN-03 (PR-035) / TES-04 (PR-040) / futuro doc-model de cobranzas.
O shape canônico "Cliente·Banco·Valor·Moneda·Data·Títulos·Status·Comprobante" é granularidade de recebimento
individual — só parcialmente representável hoje (o expand mostra os TÍTULOS pendentes; os recebimentos vivem em
`/tesoreria/movimientos`). **FIN-01 per-parcela (11 colunas, próxima ação, promesas) = PR-026a, não construído.**

## Deltas de UX documentados (UI-only, sem impacto de payload)

1. Cards por cliente → linhas densas do grid (o detalhe de ventas passa de tabela sempre-visível a expand por
   chevron — espelho do delta `FacturasChips` de 025b).
2. CTA "Cobrar" por cliente: de botão primary no card → botão outline na coluna Acciones (URL idêntica).
3. Colunas novas de display: Mayor atraso (derivada de `diasParaVencer`) e Facturas (contagem) — sem dado novo.
4. Página inteira agora gateada por `VER_SALDO` (antes aberta) — ver seção do gate.

## Validações (resultados — 2026-07-02, branch `pr-025c-tes03-cobranzas`)

```
pnpm prisma generate     ✅
pnpm typecheck           ✅ (2× — antes e depois do formatter)
pnpm build               ✅ (Turbopack, exit 0)
pnpm biome:ci            ✅ Validação Biome: `pnpm biome:ci` foi investigado
                         novamente e passa em main limpa e na branch PR-025c.
                         O falso alarme anterior era causado por arquivos
                         untracked do próprio PR que permaneceram na árvore
                         durante um teste com `git stash` sem `-u`; não era
                         erro pré-existente da main. A CI usa o mesmo
                         `pnpm biome:ci`, portanto não é esperado bloqueio
                         de lint por Biome.
pnpm test                ✅ 1238/1238 (162 files) — inclui cxc-saldos-multimoeda
                         e aging-presentacion verdes + os 15 testes novos.
pnpm db:validar-asientos ✅ (Postgres 18 descartável local, seed + dados QA;
                         invariantes A1-A5 satisfeitas — NUNCA prod/Railway)
lizard -C 8 (gate Codacy)✅ 0 funções acima de CCN 8 nos arquivos novos (24 funções,
                         AvgCCN 2.3; um `mayorAtraso` duplicado na action estourava
                         CCN 9 → substituído por delegação ao helper puro do grid).
```
Testes novos: `cuentas-a-cobrar-worklist.test.ts` **11/11 ✓** (no-call, pass-through por referência,
**paridade** `fmtBucketPres` === `fmtMoney(convertirBucket(sumarBucketsNativos(...)))` por bucket×moneda
incl. `sin_fecha`, anti-÷tc-cego 135,71≠128,57, granularidade per-perna 14,29≠14,28, mayorAtraso, cobrarHref) ·
`cuentas-a-cobrar-export.test.ts` **5/5 ✓** (gate nega sem ler projeção, preset `vencidas` server-side,
native-first no arquivo, auditoria propaga falha, moneda da sessão).
(Rodada FULL `pnpm test` 1238/1238 feita antes do fix de granularidade; os 2 arquivos novos re-rodados verdes
após o fix — nenhum outro arquivo depende dos helpers novos.)

## QA visual EXECUTADO (2026-07-02 — Postgres 18 descartável porta 55433, overrides
`DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL`=localhost:3457, login admin/admin123; prod/Railway NUNCA tocada.
Fixture SQL: 2 clientes, 3 ventas EMITIDAS [100 USD@TC1300 vencida · 50k ARS próxima · 75k ARS al día],
3 asientos CONTABILIZADOS com metadata USD nativa, TC de cierre 1400 — invariantes revalidadas pós-insert.)

- [x] Grid denso per-cliente com as 8 colunas + expander; expand mostra a sub-tabela de ventas
      (V-QA-1 link `/ventas/…` · Vencida · 100,00; V-QA-2 · Próxima · 35,71) — verbatim do `VentaRow`.
- [x] **KPI band == grid EXATAMENTE** nas duas monedas:
      USD → Vencido 100,00 · Próximo 35,71 (=50000/1400) · Al día 53,57 · Saldo total 153,57;
      ARS → Vencido **140.000** (=100 USD×TC cierre 1400 + 50.000 — prova viva do native-first,
      não os 180.000 do ledger ao TC de emissão) · Saldo total 215.000. Linha ACME espelha os KPIs 1:1.
- [x] `?filtro=vencidas` → só ACME (1 registro), KPIs seguem globais (idêntico ao legado); Links
      Todos/Vencidas preservam `?moneda`; MonedaToggle com badge do TC (1 USD = 1.400,00 · QA).
- [x] Export CSV baixa a vista atual (só ACME com `filtro=vencidas`; Vencido 100.00 native-first) e o
      evento **EXPORTACION** ficou no AuditLog: `pagina=cuentas-a-cobrar,
      filtros={tc:1400, filtro:vencidas, moneda:USD}, nFilas=1`.
- [x] Estado negado: com JWT de sessão alheia ao DB (gotcha JWT-viejo) a página rendeu
      "Acceso restringido" server-side SEM nenhum dado — comportamento byte-idêntico ao de
      `saldos-proveedores` (025b) no mesmo env (contraprovado lado a lado).
- [x] "Cobrar" gera URL idêntica à legada (`?tipo=COBRO&monto=180000.00&descripcion=Cobro+de+ACME+SA&
      cuentaContableId=632`) e "Registrar un cobro" aponta ao fluxo `movimientos/nuevo` inalterado.

Nota de semântica observada (não é regressão): "Mayor atraso 32 días" deriva de `diasParaVencer` do
serviço (cálculo em TZ local sobre data UTC-midnight — semântica do MOTOR, intocada; o legado exibia o
mesmo dado via DateBadge/bucket).

## Review adversarial (16 agentes: 4 lentes × achado × 2 refutadores independentes)

- **Corrigido no PR**: `fmtBucketPres` per-item (drift de 1ct vs KPI/legado) → reescrita per-perna + caso de
  teste dedicado (`14,29`≠`14,28`). Também: `mayorAtraso` duplicado na action (CCN 9 > gate 8) → delegado ao
  helper puro do grid.
- **Dívida HERDADA registrada (não corrigida aqui — espelho verbatim de 025b; corrigir nas DUAS worklists
  juntas em follow-up)**: as chaves de SORT das colunas monetárias (`Number(r.vencido)` etc.) são os agregados
  ARS do serviço (TC de emissão), enquanto as células exibem native-first ao TC de cierre → em multimoneda a
  ordem pode divergir do valor exibido (nenhum valor é calculado errado; sort-key ≠ display-key). Uma sort-key
  native-aware é trivial de derivar da própria `fmtBucketPres` quando se decidir corrigir 025b+025c juntos.
- **Já documentado (sancionado, rollout em etapas)**: bypass residual `movimientos/nuevo?tipo=COBRO` sem gate
  (ver seção do gate).
- **Refutado**: "fallback morto pós-gate" na page — é o MESMO padrão null-safety do análogo 025b
  (`todosRaw ?? []`), defesa em profundidade exigida pelo tipo `| null` da projeção.

## Rollback

`git revert` (ou checkout) de `tesoreria/cuentas-a-cobrar/page.tsx` restaura a página legada por completo; os
7 arquivos novos ficam órfãos (nenhum outro módulo os importa) e podem ser removidos no mesmo revert.
