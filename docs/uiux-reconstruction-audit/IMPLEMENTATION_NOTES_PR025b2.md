# IMPLEMENTATION NOTES — PR-025b-2 · Tesorería TES-02 · CxP dialogs → FloatingWorkWindow

> Onda 2 (adoção de padrões por módulo). UI-only, behavior-preserving. Fatia 2 do split
> aprovado do PR-025b (025b-1 = worklists + gate `VER_SALDO` + 2 drawers→FWW, **mergeado
> #365 `038b51b2`**). Este slice fecha o item pendente nomeado no cabeçalho do
> `IMPLEMENTATION_NOTES_PR025b.md`: **os 4 dialogs de negócio da página
> `cuentas-a-pagar` → FloatingWorkWindow** (G-04), container-only.
> Base: branch `pr-025b2-tes02-cxp-fww` limpo de `origin/main` (`038b51b2`). Sem stacking.

## Decisões do dono (aprovação do plano, 2026-07-02)

1. **Variante A — verbatim estrito**: botões Cancelar/Confirmar seguem no body
   (`DialogFooter` é div puro sem contexto, `dialog.tsx:80`); SEM DirtyFooter /
   `onRequestClose` / confirm de descarte. ESC descarta como o Dialog legado já fazia.
   DirtyFooter fica para a futura extração `<BatchPaymentDialog>` (`TODO(fase-3.4)` nos
   4 bodies).
2. **Dead export em árvore**: os 4 dialogs legados ganham `export` (1 keyword + comentário)
   e deixam de ser renderizados — rollback por superfície = trocar 1 tag de volta.

## Mapa superfície → action (CALL verbatim, motor intocado)

| Work window (novo) | Dialog legado (dead export, mesmo arquivo de sempre) | Action (payload byte-idêntico) |
|---|---|---|
| `_components/pago-factura-work-window.tsx` | `PagoFacturaDialog` em `_components/pago-por-factura.tsx` | `crearMovimientoTesoreriaAction` (`tipo:"PAGO"`, `tipoCambio:"1"`, lineas single/multi, `descripcion.slice(0,255)`, `retencionGananciasManual` só ARS+válido) + preview `simularRetencionGananciasAction` |
| `pagar-vep-work-window.tsx` | `PagarVepDialog` em `vep-section.tsx` | `pagarVepEmbarqueAction` (`embarqueId`, `fecha` template `T12:00:00Z`, `montoPagado .toFixed(2)`, `creditoAplicado` condicional) |
| `pagar-refuerzo-vep-work-window.tsx` | `PagarRefuerzoVepDialog` em `vep-section.tsx` | `pagarRefuerzoVepAction` (`embarqueCodigo`, `montoBanco .toFixed(2)`, idem) |
| `pagar-vep-despacho-work-window.tsx` | `PagarVepDespachoDialog` em `vep-despacho-section.tsx` | `pagarVepDespachoAction` (`despachoId`, `numeroVep .trim() \|\| undefined`, idem) |

Call-sites (única mudança de render): `pago-por-factura.tsx` (`PagoPorFactura`),
`vep-section.tsx` (`VepSection`, 2 tags), `vep-despacho-section.tsx` (`VepDespachoSection`)
— mesmos estados/triggers/props. **`page.tsx` da CxP: zero diff.**

## Prova "mesmo body/action" (verificação adversarial executada)

Método: extração de cada componente legado e novo, normalização SÓ de whitespace inicial,
`diff` + classificação de cada hunk. **Veredicto: 4/4 CONTAINER-ONLY / VERBATIM-OK.**
Hunks sobreviventes mapeiam 1:1 às adaptações mecânicas documentadas:

| Legado | Novo | Nota |
|---|---|---|
| `<Dialog open onOpenChange>` | `<FloatingWorkWindow open onOpenChange>` | MESMO lambda (`(o) => !o && onClose()`; no pago-factura o guard `!pending` + `reset()` verbatim) |
| `DialogHeader/Title/Description` | props `title`/`description` | JSX interno byte-idêntico; no pago-factura, null-guard `proveedor?.numero ?? ""` no title (props são avaliados com a janela fechada — adaptação container-level) |
| `DialogContent className="sm:max-w-[560px]"` (VEPs) / default (pago-factura) | `initialWidth={560}` + `initialHeight` 680/620/660/640 | tamanho de form da casa |
| `DialogClose render={<Button variant="ghost" type="button">Cancelar</Button>}` | `<Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>` | só nos 3 VEPs; efeito líquido idêntico (o close path legado era `onOpenChange(false)` → `onClose()`, sem reset). O pago-factura já usava Buttons com onClick — zero adaptação |
| `DialogFooter` | **mantido verbatim** | div presentacional puro (`dialog.tsx:80`, sem contexto de Dialog) |
| grid `gap-6` do DialogContent (pago-factura) | wrapper `<div className="flex flex-col gap-6">` | preserva o espaçamento entre blocos; sem padding próprio (a FWW já dá `p-4`) |

Idênticos byte a byte (linhas nem entram no diff): todos os hooks (nomes/defaults/ordem),
os useEffect de prop-sync/preview **incl. os comentários `eslint-disable-next-line
react-hooks/set-state-in-effect` e `TODO(fase-3.4)`**, `reset`/`toggleRetManual`/
`aplicarCreditoCompleto`, todos os guards e strings de toast, os 4 objetos de payload
campo a campo (incl. `.toFixed(2)`, `.trim() || undefined`, template `T12:00:00Z`,
`retencionGananciasManual` condicional), `onClose()`/`router.refresh()`, e todo o JSX dos
forms (classes, ids, placeholders, maxLength). Pós-verificação, o biome formatter re-embrulhou
algumas linhas dos arquivos novos que passaram a caber com a des-indentação — whitespace puro.

Semântica de mount preservada: nos 3 VEPs os hooks vêm antes do `if (!vep) return null`
(componente segue montado pelo pai; só o Popup portalado desmonta — mesma stack base-ui
`Root+Portal+Popup` nos dois containers); no pago-factura o componente fica montado com
`open=false` exatamente como antes (preview RG830 keyed no prop `open`). Wart legado
preservado de propósito: reabrir o MESMO vep (mesma referência) não re-roda o prop-sync.

### Compartilhamento de símbolos (diferença estrutural vs 025a/b-1)

Os dialogs legados viviam NO MESMO arquivo das seções (não em arquivos próprios). Para não
criar duas cópias vivas, 8 símbolos module-scope de `pago-por-factura.tsx` ganharam `export`
**sem mudança de corpo** (diff = keyword apenas): `CONCEPTO_LABEL`, `CONCEPTO_VALUES`,
`type FacturaConProveedor`, `ORIGEN_LABEL`, `ORIGEN_BADGE`, `todayIso`, `facturaKey`,
`sumarMontos` — importados pelo work-window (mesmos símbolos, não cópias). Os tipos
`CuentaBancariaArsOption` (`vep-section.tsx:46`) e `VepDespachoPendiente`
(`vep-despacho-section.tsx:45`) já eram exportados. O ciclo de import
`pago-por-factura` ↔ `pago-factura-work-window` é benigno (bindings usados só dentro do
componente, nunca no init do módulo); os pares VEP são type-only (apagados na compilação).

## Deltas de UX documentados (paradigma FWW da casa, sem impacto de payload)

1. Outside-click NÃO fecha (`dismissOnOutsidePress=false` default) — no legado fechava e
   descartava o form; o delta REMOVE um caminho de descarte acidental.
2. Sem backdrop opaco/scroll-lock: a página atrás fica interativa → é possível abrir DUAS
   FWWs ao mesmo tempo (ex.: Pagar VEP + Pagar refuerzo), impossível no modal legado. Sem
   risco de dado: as actions validam server-side e `router.refresh()` roda no sucesso.
3. ESC com popup (Select/DatePicker) aberto fecha o popup primeiro; o ESC seguinte fecha a
   janela (com a MESMA semântica de descarte do Dialog legado — decisão Variante A).
4. Janela movível/redimensionável/maximizável; densidade `p-4` da FWW (legado `p-6`).
5. pago-factura: largura 560 (legado `max-w-md`≈448) — alargamento cosmético.

## Não-goals (deferidos, sem modelo/outra fatia)

Gate `VER_SALDO` na CxP (bypass residual documentado no 025b-1 segue: `page.tsx` chama
`getSaldosPorProveedorConAging` cru — follow-up próprio; esta fatia não introduz nem remove
gating); pipeline de status/comprobante/lotes/programación (FIN-04, Onda 3); FIN-02
per-parcela (PR-026b); TES-03/TES-04; estorno; consolidação `<BatchPaymentDialog>`
(fase-3.4); qualquer mudança de action/schema/permissão.

## Prova de motor intocado

`git diff --name-only` desta fatia lista SOMENTE: 4 work-windows novos + 3 arquivos de
seção da CxP (swap de render + dead exports) + este doc. **Zero diff** em:
`pago-exterior.ts` (invariante USD E1-E7 — a CxP nem o importa; único consumidor é
`comex/proveedores/_components/pago-exterior-dialog.tsx`), `vep-embarque.ts`,
`vep-despacho.ts`, `movimientos-tesoreria.ts`, `retenciones.ts`,
`retencion-ganancias-pago.ts`, `cuentas-a-pagar.ts` (incl. `getSaldosExteriorPorProveedor`),
`historico-pagos.ts`, `saldo-usd-nativo.ts`, motor de asientos, `floating-work-window.tsx`,
`enterprise-data-grid.tsx`, schema/migrations/seed/auth/permisos-catalog/permisos-masking,
`page.tsx` da CxP.

Suites que pinam os fluxos (100% verdes): `vep-despacho-action` (exercita as 3 actions
VEP), `retencion-ganancias-pago`, `retencion-ganancias-manual`, `ciclo-canonico` (E7),
`pago-exterior-action`, `diferencia-cambiaria-*`, `saldos-exterior-usd`,
`cuentas-a-pagar-bonded`.

## Validações (resultados — 2026-07-02, branch `pr-025b2-tes02-cxp-fww`)

- `pnpm prisma generate`: ✅ (Prisma Client 7.8.0).
- `pnpm typecheck`: ✅ (0 erros).
- `pnpm build`: ✅ (`/tesoreria/cuentas-a-pagar` compila; exit 0).
- `pnpm biome:ci`: ✅ exit 0 (44 warnings pré-existentes — mesmos do baseline 025b-1, incl.
  o `suppressions/unused` de `pago-por-factura.tsx` que já existia em `origin/main`; 0 erros).
- `pnpm test`: ✅ **160 arquivos / 1223 testes** (mesmo baseline do 025b-1 — nenhum teste
  novo, nenhum quebrado); suites do motor (`vep-despacho-action`, `retencion-ganancias-*`,
  `ciclo-canonico`, `pago-exterior-action`, `diferencia-cambiaria-*`) 100% verdes.
- **Lizard 1.22.2** (thresholds Codacy: CCN 8 / fn NLOC 50 / file NLOC 500): arquivos novos
  com 282/264/240/389 NLOC (< 500). **Exceções deliberadas e documentadas**: os callbacks
  `startTransition` dos `handleSubmit` copiados verbatim medem CCN 9-11 — EXATAMENTE os
  mesmos valores das funções legadas de onde foram copiados (ex.: `vep-section.tsx`
  anonymous@326-353 = CCN 10 idêntico ao novo anonymous@111-138). Precedente mergeado:
  `movimiento-detalle-work-window` CCN 24 (#364) e `anticipo-detalle-work-window` CCN 19
  (#365) passaram no gate pelo mesmo racional (decompor quebraria a prova verbatim).
- `pnpm db:validar-asientos`: NÃO rodado nesta máquina (o `DATABASE_URL` default aponta a
  Railway/prod — STOP condition; mesmo racional do 025a/025b-1). Validação equivalente:
  (a) prova de motor intocado por diff; (b) payloads byte-idênticos verificados por diff
  adversarial; (c) suites Testcontainers cobrem os asientos dos 4 fluxos. Rodar
  `pnpm db:validar-asientos` no QA visual local (Postgres descartável) antes/depois.

## Rollback por superfície

- Pago por factura: trocar a tag `<PagoFacturaWorkWindow` de volta para `<PagoFacturaDialog`
  em `pago-por-factura.tsx` (dead export em árvore; 1 linha).
- VEP embarque / refuerzo: idem nas 2 tags de `vep-section.tsx`.
- VEP despacho: idem em `vep-despacho-section.tsx`.
- Ou `git revert` da fatia inteira (page.tsx intocada ⇒ raio confinado aos client
  components da CxP).

## QA visual EXECUTADO (2026-07-02 — Postgres descartável `postgres:18-alpine` local porta 55446, overrides `DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL=localhost:3789`; prod/Railway NUNCA tocada; login admin/admin123 fresco pós-signout — gotcha JWT-velho evitado)

Dados semeados **via UI** (o próprio fluxo é QA): cuenta bancaria ARS via FWW do 025a
(`1.1.1.02.10 BANCO QA 025B2 ARS`), proveedor local (`2.1.1.01.10 PROVEEDOR QA 025B2`),
período contable 2026-07 (Contabilidad>Períodos), gasto `G-2026-0002` de ARS 150.000
CONTABILIZADO (asiento Nº 1: DEBE 7.9.01 / HABER 2.1.1.01.10).

- **CxP renderiza** intacta (header, Total pendiente, seções; MonedaToggle operante).
- **PagoFacturaWorkWindow (single)**: "Pagar" na linha da factura abre
  `data-slot="floating-work-window"` (NÃO `dialog-content` — legado ausente do DOM);
  title `Pagar factura G-2026-0002` e description `Proveedor QA 025b2 — Gasto · Total
  150.000,00 ARS` byte-idênticos ao header legado; **monto prefilled `150000.00`**
  (prop-sync OK); Select de cuenta bancaria portalado abre e o `elementFromPoint` no
  centro da opção devolve a própria opção ⇒ **empilha ACIMA da FWW, clicável** (classe de
  bug de stacking negativa); DatePicker/calendário idem (`aboveFww: true`); **ESC com
  calendário aberto fecha só o calendário, FWW segue aberta**; **outside-click não fecha**
  (pointer events no h1 da página, FWW permanece); **pago EXECUTADO** → FWW fecha via
  `onPaid`, CxP refresca com **Total pendiente 0,00** e factura fora da lista; **asiento
  Nº 2 conferido no banco**: `DEBE 2.1.1.01.10` 150.000,00 / `HABER 1.1.1.02.10`
  150.000,00 — exatamente o que o motor gera (payload intacto).
- `pnpm db:validar-asientos` (com override explícito para o DB local): ✅ "Todas las
  invariantes del ledger contable están satisfechas."
- **Console: 0 erros / 0 warnings** em toda a sessão de QA.
- VEP embarque/refuerzo/despacho: não exercitados end-to-end neste QA (exigem pipeline
  comex completo — embarque CERRADO com tributos/despacho); cobertura equivalente:
  (a) os 3 work-windows são o MESMO padrão de container e os MESMOS primitivos
  portalados (Select/DatePicker) validados acima; (b) bodies/payloads provados
  byte-idênticos por diff adversarial; (c) `vep-despacho-action.test.ts` pina as 3
  actions. Item do checklist abaixo para o dono cobrir no QA de aceitação se desejar.
- **Cleanup**: dev server parado; container `qa-pr025b2` removido; `.playwright-mcp/`
  removido; `tsconfig.json` (reescrito pelo Next dev) revertido.

## QA manual (checklist — env local seguro, NUNCA prod/Railway)

Postgres descartável + `DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL=localhost`, login
admin/admin123. Em TODAS as janelas: `data-slot="floating-work-window"`; title/description
idênticos aos headers legados; abrir TODO Select/DatePicker portalado (devem empilhar ACIMA
da FWW — classe de bug runtime-only); ESC com popup aberto fecha o popup primeiro;
outside-click não fecha; drag/resize/maximizar/X.

1. **PagoFactura single**: "Pagar" numa linha → FWW com monto prefilled; preview RG 830
   automático (proveedor sujeito, ARS); toggle manual pré-carrega sugerido; executar →
   toast `Pago registrado — Asiento Nº X` → conferir asiento (DEBE proveedor / HABER banco /
   2.1.3.07 se retención). **Multi**: 2 facturas mesmo proveedor+moneda → monto
   disabled=suma → executar.
2. **PagarVep**: "Usar máximo" do crédito Aduana; pagar a menos → toast com
   `saldo pendiente (refuerzo)`; conferir asiento e o refuerzo aparecendo na seção.
3. **PagarRefuerzoVep**: pagar o refuerzo gerado; conferir saldo restante + asiento.
4. **PagarVepDespacho**: pago exato → "Pago exacto…"; conferir asiento (origen COMEX).
5. `pnpm db:validar-asientos` verde antes/depois (DB local). Regressão: resto da CxP
   (EmbarqueBatchPago inline, seções read-only, MonedaToggle, header/KPIs) intacto;
   console sem warnings NOVOS (o dev-warning base-ui `value={x || undefined}` é
   pré-existente, reproduzido verbatim).
