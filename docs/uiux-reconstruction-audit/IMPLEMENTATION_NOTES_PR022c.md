# IMPLEMENTATION_NOTES — PR-022c · CX-01 Comex Cockpit · Calendário semanal operacional

> Wave 2 · cross-cutting-retrofit (continuação de PR-022a/022b) · criticidade alta.
> Branch: `pr-022c-comex-cockpit-calendario` (limpo a partir de `origin/main`, sem stacking — 022a `c378ded0` +
> 022b `4bcb6864` já mergeados).

## O QUE
Calendário operacional semanal de **largura total abaixo dos 6 blocos** do cockpit (`/comex`). Grade de semanas
(lunes→domingo) com **ícones compactos de eventos por dia**; **click-dia** expande a lista do dia in-place;
**click-evento** abre o processo na aba correspondente (`/comex/embarques/[id]?tab=<x>`). Implementa CX-01
§9-estrutural 5.

## RESTRIÇÃO CENTRAL (cumprida)
Read-only puro. Os eventos derivam **SOMENTE de datas ARMAZENADAS** — nada é computado, o motor de rateio/custo
(`services/comex.ts`, `despacho-parcial.ts`) **nunca** é importado/chamado/tocado. Sem schema, sem migration, sem
action/mutation, sem export. O calendário reusa os **mesmos `filtros` do 022b** e pertence à seção nomeada
**Operação** (OD-08).

---

## Arquitetura (wiring aprovado pelo dono: deriva do MESMO conjunto filtrado, sem 2ª query)
`getCockpitData` já computa `visibles` (universo de embarques **já filtrado** pelos `filtros` 022b via
`aplicarFiltrosEnriched`). O calendário deriva desse mesmo conjunto → **filtro garantidamente consistente com os
blocos**, **uma única query**, complexidade baixa.

```
searchParams (URL, 022b) → parseCockpitFiltros → getCockpitData
   → visibles (já filtrado)  ── visibleIds ──▶ construirCalendario(embarques ∈ visibleIds, now)   [PURO]
        → tagEventosDeProceso → agruparEventosPorDia (UTC) → construirSemanas (grade)
   → CockpitData.calendario (campo ADITIVO)
→ <Cockpit> → <CockpitCalendario data={calendario}/>  (largura total, abaixo dos 6 blocos)
click-dia → expande lista in-place (sem navegação) · click-evento → EntityLink → /comex/embarques/[id]?tab=<x>
```

## Arquivos
**Criados**
- `src/lib/services/comex-cockpit-calendario.ts` — PURO (sem `db`, sem `server-only`, sem motor). Helpers pequenos
  (cada um complexidade ciclomática ≤ 8 p/ o gate Codacy/Lizard): `tagEventosDeProceso`, `agruparEventosPorDia`,
  `construirCalendario` (+ internos `rangoSemanas`/`construirSemanas`). Tipo de entrada estrutural
  `ProcesoCalendarioFuente` (desacoplado do Prisma → testável com fixtures).
- `src/app/(dashboard)/comex/_components/cockpit-calendario.tsx` — client (`useState` p/ dia expandido). Grade
  `grid-cols-7`, ícones compactos por dia, click-dia expande, `EntityLink` por evento. Navegável por teclado
  (células com eventos são `<button>` com `aria-label`/`aria-pressed`).
- `test/comex-cockpit-derivaciones.test.ts` — **estendido** (+12 testes; importa os helpers puros do calendário).
- `docs/uiux-reconstruction-audit/IMPLEMENTATION_NOTES_PR022c.md` (este).

**Modificados (aditivo, comportamento intacto)**
- `src/lib/services/comex-cockpit.ts` — (a) `EMBARQUE_COCKPIT_SELECT` ampliado **só com campos de data** (Embarque:
  `fechaEmpaque/fechaSalida/fechaTransbordo/fechaZonaPrimaria/fechaCierre`; contenedores: `+fechaTrasladoDF/
  fechaDesconsolidacion`; `+despachos: { fecha }`; `costos.fechaVencimiento` já existia) — **nenhuma coluna
  monetária** (anti-leak intacto). (b) campo aditivo `calendario: CalendarioData` em `CockpitData`, preenchido a
  partir de `visibles` (3 linhas).
- `src/app/(dashboard)/comex/_components/cockpit.tsx` — destructura `calendario` e renderiza `<CockpitCalendario>`
  logo após o grid dos 6 blocos. Alertas/indicadores/blocos inalterados.

**Não tocados (proibidos):** `prisma/schema.prisma`, migrations, auth/JWT/session, modelo de permissões, motor +
actions do Comex (`services/comex.ts`, `despacho-parcial.ts`, `lib/actions/{embarques,despachos,contenedores,
vep-*}.ts`).

---

## Mapa evento → campo de data ARMAZENADO → aba destino
Todos `DateTime?` exceto `Despacho.fecha` (`DateTime`). Datas nulas → evento **omitido**.

| tipo de evento      | campo armazenado (fonte)            | aba (`?tab=`) | ícone (hugeicons)     |
|---------------------|-------------------------------------|---------------|-----------------------|
| empaque             | `Embarque.fechaEmpaque`             | operacion     | `Package01Icon`       |
| embarcado           | `Embarque.fechaSalida`              | operacion     | `CargoShipIcon`       |
| transbordo          | `Embarque.fechaTransbordo`          | operacion     | `Exchange01Icon`      |
| arribo              | `Embarque.fechaLlegada`             | operacion     | `AnchorIcon`          |
| ingreso-zpa         | `Embarque.fechaZonaPrimaria`        | operacion     | `WarehouseIcon`       |
| traslado-df         | `Contenedor.fechaTrasladoDF`        | operacion     | `ContainerTruckIcon`  |
| desconsolidación    | `Contenedor.fechaDesconsolidacion`  | operacion     | `PackageOpenIcon`     |
| nacionalización     | `Embarque.fechaCierre`              | finanzas      | `Stamp01Icon`         |
| despacho-liberación | `Despacho.fecha`                    | aduana        | `ShipmentTrackingIcon`|
| pago-exterior-venc. | `EmbarqueCosto.fechaVencimiento`    | finanzas      | `CoinsDollarIcon`     |

Cor do ícone por aba: operacion=`text-process`, aduana=`text-info`, finanzas=`text-warning`.

### Tipos OMITIDOS (documentados, NÃO falseados)
- **`retirada`** — não existe campo armazenado no schema → omitido (consume-or-omit).
- **`Contenedor.fechaSalidaOrigen` / `fechaLlegadaPuerto`** — duplicariam embarcado/arribo de nível Embarque; o
  calendário é processo-cêntrico → usamos o nível Embarque, sem dupla-contagem.
- **`EmbarqueCosto.fechaFactura`** — o evento operacional de pagamento é o **vencimento**, não a emissão da factura.
- De-duplicação por DIA dos eventos vindos de arrays (contenedor/despacho/costo) para evitar N ícones idênticos do
  mesmo processo no mesmo dia.

---

## Prova: reuso do filtro 022b (consistência com os blocos)
O calendário **não tem fonte de filtro própria**. `getCockpitData` aplica `aplicarFiltrosEnriched(...)` uma vez,
produzindo `visibles`; o calendário é derivado de `embarques.filter(e => visibleIds.has(e.id))` onde
`visibleIds = new Set(visibles.map(v => v.ref.id))`. Logo, qualquer filtro 022b (Proveedor/ETA/Status/preset/foco)
narra o calendário **exatamente** como narra os blocos — by-design, sem replicação de lógica. Teste:
`construirCalendario` só emite eventos dos processos passados (universo filtrado).

## Prova: gating OD-08 «Operação»
No PR-022a, a seção **Operação** (Procesos críticos · Próximos arribos · Sin actualización) **não tem gate
por-seção** — é visível a quem acessa `/comex` (o catálogo de permissões **não** tem `ver_costo_comex`/
`ver_valores_financieros`; só existe `VER_COSTO_LANDED` = `costos.verLanded`, que gateia a seção Financeiro). O
calendário, pertencendo a Operação, segue **o mesmo padrão**: gate = acesso à rota `/comex`. **Nenhuma chave nova.**

## Prova: «no recompute / engine untouched / read-only»
- O serviço `comex-cockpit-calendario.ts` importa **apenas tipos**; não importa `db`, `server-only`, nem nada de
  `services/comex.ts`/`despacho-parcial.ts`. Só agrupa datas já carregadas.
- `getCockpitData` apenas **lê** (`findMany`) e **agrupa** — nenhuma escrita/transação/action; o motor de rateio
  nunca é chamado.
- 32 testes de invariantes do Comex (asiento/stock/despacho/guards) permanecem verdes (ver Validação).

## Prova: NÃO há exposição de valores
O payload de evento (`CalendarioEvento`) carrega **só** `embarqueId / codigo / proveedorNombre / tipo / fechaISO /
tab` — **nenhum** campo monetário. O `EMBARQUE_COCKPIT_SELECT` ampliado adicionou **só colunas de data** (anti-leak
intacto: nunca traz `iva/iibb/costoTotal/fobUnitario`). Teste dedicado: `Object.keys(evento)` não contém valor.
Logo o calendário **não precisa** de `VER_COSTO_LANDED` (date/event-based).

## Decisão build-or-omit: «Más filtros» → **OMITIDO** (NON-GOAL)
A barra de filtros 022b já cobre **Proveedor / ETA (rango) / Status / presets**. O filtro **Modal** não tem campo no
schema (gap pré-existente, documentado no 022b); os filtros avançados restantes (responsable / free-time / alerta)
referenciam **dados inexistentes**. Logo não há filtro avançado real a expressar → «Más filtros» (FloatingWorkWindow)
é NON-GOAL nesta PR. Se algum dia necessário, vira **PR-022d**.

## Janela do calendário
Grade contígua de semanas (lunes→domingo, UTC) cobrindo a semana atual + as semanas com eventos, acotada por
`SEMANAS_ATRAS_MAX=8` / `SEMANAS_TOTAL_MAX=26`, mínimo `SEMANAS_VISIBLES=4`. Container com `max-h-64 overflow-y-auto`
(4–5 semanas visíveis, scroll para o resto — "4 semanas visíveis, scroll para mais"). Eventos além do tope são
contados honestamente em `fueraDeVentana` (footnote: "N evento(s) fuera de la ventana visible"), nunca ocultados em
silêncio. Bucketing por dia em **UTC** (casa com `fmtDate`, evita hydration mismatch); `now` injetado — **sem
`Date.now()`** nos services.

---

## Validação (executada nesta ordem)
| Comando | Resultado |
|---|---|
| `pnpm prisma generate` | ✓ Prisma Client 7.8.0 |
| `pnpm typecheck` (`tsc --noEmit`) | ✓ limpo |
| `pnpm build` | ✓ exit 0 (rota `/comex` presente) |
| `pnpm biome:ci` | ✓ exit 0 (42 warnings pré-existentes, 0 erros; format aplicado via `biome:format`) |
| `pnpm vitest run` cockpit (derivaciones **25** [+12], filtros 22, overview 4) | ✓ 51/51 |
| Engine-adjacent (Testcontainers, isolado): validar-invariantes-comex 9, asiento-comex 13, arribo-comex 4, guards (cruzado/revertir-zp/legacy-zp) 6 | ✓ 32/32 |

**Nota sobre `db:validar-stock` / `db:validar-asientos`:** esses scripts conectam a `DATABASE_URL` (padrão =
**produção/Railway**). Como a PR **não toca** motor/stock/asiento/schema (zero write paths), e os mesmos invariantes
de stock/asiento são exercitados em isolamento pelas suítes Testcontainers acima (todas verdes), os scripts NÃO foram
rodados contra produção (condição de STOP "Production DB would be needed"). Para QA local seguro, rodá-los apontando
a um Postgres descartável (override `DATABASE_URL`/`DIRECT_DATABASE_URL`), nunca prod.

## QA manual (env local seguro — Postgres descartável + `DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL=localhost`, NUNCA prod; login admin/admin123)
- [ ] Calendário renderiza abaixo dos 6 blocos, ícones compactos por dia ao longo das semanas.
- [ ] Click-dia expande a lista do dia in-place; click-evento abre `/comex/embarques/[id]?tab=<x>` na aba certa.
- [ ] Aplicar filtro 022b (Proveedor/ETA/Status/preset) atualiza o calendário em sincronia com os blocos.
- [ ] Tipos sem data armazenada não aparecem; nenhum valor de custo/margem é exibido no calendário.
- [ ] `/comex` sem o calendário (rollback mental) casa byte-a-byte com o 022b.

## Rollback
Remover `cockpit-calendario.tsx` + `comex-cockpit-calendario.ts`, reverter a inserção `<CockpitCalendario>` em
`cockpit.tsx`, e remover o campo `calendario`/3 linhas + a ampliação de datas do select em `comex-cockpit.ts`.
`/comex` volta a ser idêntico ao 022b.
