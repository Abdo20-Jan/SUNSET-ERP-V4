# IMPLEMENTATION_NOTES_PR021 — CX-03 · Comex · Processo de Importação (Record PAGE-STD-02)

**Tipo:** record-migration (Wave 2) · **Criticidade:** alta/máxima (módulo Comex protegido)
**Branch:** `pr-021-comex-proceso-record` (limpo de `origin/main` @ `731c4ce1`, #347 PR-020)
**PR:** `feat(ui): CX-03 Comex Processo de Importação — record PAGE-STD-02 (PR-021)`

## Objetivo

Substituir o `embarque-form.tsx` full-page em `/comex/embarques/[id]` pelo Record canônico
PAGE-STD-02 (AdaptiveRecordHeader 3 linhas + 6 abas + Resumen-first + Sistema/Historial), espelhando
PR-018/019 (Venta/Pedido). **UI-only:** DISPLAY + HOST + CALL. O motor de rateio/custo/tributos
(`services/comex.ts`) e **todas** as actions comex ficam **byte-idênticos / intocados**. Zero
recálculo na UI (a edição segue feita pelo `EmbarqueForm` existente, agora hospedado numa
`FloatingWorkWindow`). Sem schema, sem migration.

## Correção ao prompt

O prompt referia a chave `ver_costo_comex` (PR-011) — **essa chave não existe no código**. A chave real
para custo landed/CIF/tributos/cash-out é **`VER_COSTO_LANDED` (`"costos.verLanded"`)**, via
`puedeVerCostoLanded()` + `maskField()` em `src/lib/permisos-masking.ts`. Toda a estratégia de masking
usa a chave real.

## Arquivos

### Criados
- `[id]/_components/embarque-edit-window.tsx` — ilha client; `FloatingWorkWindow` hospedando
  `<EmbarqueForm embedded>` (espelho de `venta-edit-window.tsx`), `useDirtyState` + Dialog de descarte.
- `[id]/_components/embarque-vista.ts` — **projeção server-side / masking**: `EmbarqueVista` (não
  sensível) + `EmbarqueFinanciero` (gateado, `null` sem `VER_COSTO_LANDED`) + `ContenedorVista` (sem
  `costoFCUnitario`) + `calcularFiscalCounters` (contagem, não custo). DISPLAY puro, zero recálculo.
- `[id]/_components/embarque-alertas-band.tsx` — faixa de alertas (top, antes das abas).
- `[id]/_components/embarque-resumen-view.tsx` — aba Resumen (7 blocos §9.1).
- `[id]/_components/embarque-operacion-view.tsx` — aba Operación (Items/Transporte/Containers).
- `[id]/_components/embarque-aduana-view.tsx` — aba Aduana (Despachos→subrota + Tributos gated + Documentos).
- `[id]/_components/embarque-finanzas-view.tsx` — aba Finanzas (Costos gated + Pagos + Cierre status).
- `[id]/_components/embarque-comercial-view.tsx` — aba Comercial (proveedor + termos + PI/CI diferido).
- `docs/uiux-reconstruction-audit/IMPLEMENTATION_NOTES_PR021.md` — este arquivo.

### Modificados (aditivo, comportamento intacto)
- `[id]/page.tsx` — reescrito de form full-page para o Record (server component: mesmos loaders +
  `puedeVerCostoLanded()` + projeção + derivações read-only + RecordLayout/AdaptiveRecordHeader/RecordTabs).
- `_components/embarque-form.tsx` — **APENAS** props aditivas opcionais `embedded?` / `onCancel?` /
  `onSuccess?` / `onDirtyChange?` (via tipo `EmbeddedProps & ...` em ambos os arms da union). `embedded`
  → footer in-flow (`-mx-4 -mb-4`) + esconde o h1 próprio; cancel/success caem no `router.push` atual
  quando ausentes; `isDirty` (de `formState`) borbulha via `useEffect`. **Grid, cálculos, chamadas ao
  motor (`calcularTributosSugeridos`, CIF useMemo), schema e validação INTACTOS.** `nuevo/page.tsx` não
  passa props novas → comportamento idêntico.

### Proibidos de modificar — NÃO TOCADOS
`prisma/schema.prisma`, migrations, auth/JWT/session, modelo de permissões, e o **engine + actions
Comex**: `services/comex.ts`, `services/{despacho-parcial,embarque-zpa,comex-overview,
comex-worklist-derivaciones}.ts`, `lib/actions/{embarques,despachos,despacho-cruzado-costos,
contenedores,vep-embarque,vep-despacho}.ts`. Apenas CHAMADOS/HOSPEDADOS.

## Mapa Header 3 linhas (§9.3)
- **L1:** `Embarque {codigo}` + `StatusBadge(estado)`.
- **L2:** EntityLink proveedor (`/maestros/proveedores/[id]`) · `N u.` (Σ cantidad) · `N cont.` ·
  **FOB gated** (`vista.moneda fmtMoney(fobTotal)` só com `VER_COSTO_LANDED`; senão "— costo oculto").
- **L3 (meta):** ETA (`fechaLlegada`) · Moneda·TC · Última actualización (`Embarque.updatedAt`, sem
  "por usuário" — sem audit). Responsable = "Comex".
- Encolhe on-scroll via `AdaptiveRecordHeader` (CompactBar).

## Mapa 6 abas (§9.4)
| Aba | Conteúdo | Notas |
|---|---|---|
| Resumen | 7 blocos §9.1 | ver abaixo |
| Operación | Items (FOB unit gated) · Transporte/embarque · Containers (detalhe) | Timeline vive no Resumen |
| Comercial | Proveedor + incoterm + condições | PI/CI = CX-07 diferido |
| Aduana | Despachos (→ `[id]/despachos`) · Tributos (gated) · Documentos | Documentos = CX-07 diferido |
| Finanzas | Costos (gated) · Pagos · Cierre (status) | ações de cierre/ZP nos diálogos do form |
| Sistema | Historial (`getAuditLog("Embarque",id)`) | vazio hoje (sem instrumentação de audit) |

## Mapa 7 blocos Resumen (§9.1) — enviado vs omitido
| # | Bloco | Status | Origem (zero recálculo) |
|---|---|---|---|
| 121 | Timeline | ✅ | derivada de estado/fechas/asientos |
| 122 | Resumo financeiro | ✅ **gated** | `EmbarqueFinanciero` (stored fields) — `null` sem permiso |
| 123 | Containers | ✅ | `listarPackingListDeEmbarque` (sem custo) |
| 124 | Despachos + contadores fiscais (Total/Nacionalizado/En fiscal/En despacho) | ✅ | `listarDespachosDeEmbarque` + contagem de cantidades por estado |
| 125 | Documentos pendentes | ◐ derivado | costos sem factura + asientos ZP/cierre pendentes (sem doc-model CX-07) |
| 126 | Alertas | ✅ | banda no topo da página (posição canônica PAGE-STD-02) |
| 127 | Próxima acción | ✅ | derivada de estado/asientos/despachos |

## Garantias de comportamento (provas)

**Payload byte-idêntico de `guardarEmbarqueAction`:** o `onSubmit` do form NÃO mudou — continua
montando `{ id, ...values, costos: costosParaGuardar }` exatamente como antes. A única diferença é que,
no sucesso, em vez de `router.push("/comex/embarques")` chama `onSuccess?.({id,codigo})` quando o host
fornece (a ventana fecha + `router.refresh`); sem host, o `router.push` original. O filtro de `costos`
BORRADOR, o schema zod, e os `setValue` permanecem idênticos.

**Diálogos cierre/ZP/costo:** `CerrarEmbarqueDialog`, `ConfirmarZonaPrimariaDialog`,
`RevertirZonaPrimariaDialog` e `AsientoEmbarqueLink` são reusados **verbatim dentro do form
hospedado** (já vivem no footer do form, que computa seus previews — `fobTotalArs`,
`costoTotal`, `cantFacturasZP`). Não foram movidos para fora do form (surfacing no ActionBar exigiria
recomputar `totalProveedorExterior` da ZP fora do motor → evitado por CRIT-04). Finanzas>Cierre mostra
apenas o **status** read-only (asientos ZP/cierre, estado, despachos) e direciona a "Editar embarque".

**Engine intocado (prova automatizada):** golden tests `golden-rateio-embarque` (1) +
`golden-costo-landed-despacho` (2) verdes = output do motor byte-idêntico. Suítes comex/despacho/zpa:
**21 arquivos, 112 testes, todos verdes** (inclui `validar-invariantes-comex` 9, `despacho-parcial` 17,
`edicion-embarque-no-destructiva` 3, cruzado/VEP/arribo/ZP-guards). `git diff` não toca nenhum arquivo
de engine/action comex.

## Masking / exposição de dados (CRIT-10 / G-10)

- `puedeVerCostoLanded()` resolvido **server-side** na page; `proyectarEmbarque(embarque, …, verCosto)`
  devolve `financiero = null` quando falso → FOB/CIF/flete/seguro/tributos/cash-out/costoTotal,
  **custo unitário FOB por ítem** e **facturas de costo** NUNCA cruzam para as read-views sem permiso.
  `proyectarContenedores` sempre omite `costoFCUnitario`. As views mostram nota "requiere costos.verLanded".
- **Nuance conhecida (não resolvida neste PR):** o `EmbarqueForm` hospedado na
  `FloatingWorkWindow` (modo edição) **ainda recebe `initialData` COMPLETO** (com FOB/CIF/tributos/
  cash-out/costoTotal/custo unitário/facturas de costo) porque precisa desses campos para editar —
  **exatamente como o comportamento full-page pré-existente** (`<EmbarqueForm initialData={embarque}>`).
  Logo, esses valores ainda aparecem no payload serializado **via a edit-window**, mesmo para um
  usuário sem `VER_COSTO_LANDED`. PR-021 **não piora** a exposição (idêntica à da tela antiga) e blinda
  apenas as superfícies de **LEITURA** novas; `obtenerEmbarquePorId` não tem gate hoje (pré-existente).
- **Por que não foi resolvido aqui:** blindar a exposição da edição exigiria **refator do loader/form/
  action de edição** (`obtenerEmbarquePorId` + `EmbarqueForm` + `guardarEmbarqueAction`), o que está
  **fora do escopo UI-only** deste PR (proibido tocar loader/form/actions e alterar payloads).
- **Hardening futuro (registrado):** (a) **separar a read-projection da edit-projection** — a leitura já
  usa `EmbarqueVista`/`EmbarqueFinanciero` (gated); estender o mesmo princípio à edição, OU (b) **carregar
  os dados sensíveis apenas sob permissão/ação específica** (ex.: a edit-window só recebe os campos de
  custo quando o usuário tem `VER_COSTO_LANDED`, ou os busca on-demand ao abrir o form com gate no
  backend). Qualquer das duas exige tocar `obtenerEmbarquePorId`/o form e deve ir em PR próprio de
  hardening (com testes de não-vazamento no payload), fora deste PR-021.

## Ações OMITIDAS (sem action/schema hoje — diferidas + documentadas)
Registrar evento manual · Actualizar etapa (FWW+motivo) · Cancelar/Dividir/Mesclar/Vincular proceso
(chaves `cancel/split/merge_proceso_comex` **não existem** + sem action) · Generar paquete documental ·
Adjuntar documento por entidad · Registrar pago exterior desde el proceso (existe
`proveedores/_components/pago-exterior-dialog.tsx` — Tesorería; sem rebuild) · instrumentação de audit
de embarque (Historial fica vazio) · modelo "Proceso" distinto de Embarque (CX-07). Nenhuma chave de
permissão nova introduzida.

## Validação executada
- `pnpm prisma generate` ✅ · `pnpm typecheck` ✅ (0 erros) · `pnpm build` ✅ (rota `/comex/embarques/[id]`
  compila) · `pnpm biome:format` + `pnpm biome:ci` ✅ (exit 0; 44 warnings pré-existentes alheios).
- `pnpm lint` (eslint) nos arquivos do PR: **0 erros**, 5 warnings **todos pré-existentes** em
  `embarque-form.tsx` (`Moneda` unused; `exhaustive-deps` dos useMemo de items/costos — não tocados).
  (O `pnpm lint` global reporta erros vindos de cópias em `.claude/worktrees/` — ruído local; o CI roda
  em checkout limpo.)
- Testes comex/despacho/zpa: **21 arquivos / 112 testes verdes** (engine intocado).
- `pnpm test` completo: ver resultado anexado à execução (UI-only; suítes do módulo protegido todas verdes).
- `pnpm db:validar-stock` / `db:validar-asientos`: **NÃO executados** — esses scripts standalone falam com
  `DATABASE_URL` (PRODUÇÃO por padrão neste ambiente), proibido pela tarefa. O equivalente
  (`validar-invariantes-comex.test.ts`, 9 invariantes) roda em Postgres isolado (Testcontainers) e passou;
  como nenhum engine/action/schema mudou, stock/asiento não podem regredir.

## QA manual (env local seguro — Postgres descartável, `AUTH_URL=localhost`, NUNCA prod; admin/admin123)
- [ ] Abrir embarque existente → Record renderiza (header 3 linhas, 6 abas, Resumen-first); form full-page sumiu.
- [ ] "Editar embarque" → `FloatingWorkWindow` com o form completo; editar campo → footer dirty; fechar
      com mudanças → confirmação de descarte; "Guardar" → `guardarEmbarqueAction` persiste idêntico; Record refresca.
- [ ] Zona primaria / cerrar y contabilizar / emitir-anular costo factura (dentro do form) → idênticos a hoje.
- [ ] `nuevo` inalterado; `[id]/despachos` alcançável via Aduana>Despachos e via Próxima acción.
- [ ] Sem `VER_COSTO_LANDED`: nenhum custo/CIF/FOB/tributos visível (server omite); com a chave: visíveis.
      CERRADO → "Ver detalle" read-only.

## Rollback
Restaurar o `[id]/page.tsx` antigo (form full-page) + remover os `[id]/_components/*` novos + reverter
as 5 edições aditivas do `embarque-form.tsx`. Nenhuma migration/seed/engine envolvido → rollback trivial.
