# PR-022d — CX-01 Comex Cockpit · "Exportar día" auditado (+ polish read-only)

**Branch:** `pr-022d-comex-cockpit-export-dia` (limpa de `origin/main` `f16adbd5`, com 022a/b/c).
**Tipo:** cross-cutting-retrofit (continuação de PR-022a/b/c). **Criticidade:** alta.
**Spec:** CX-01 §9-funcional 9 ("Exportar día" PDF/Excel, auditado) · §9-estrutural 10 (OD-08) · G-06/G-08/G-09/G-10 · §07 (auditoría de leitura sensível).

## Escopo entregue
1. **[Exportar día] auditado** (CSV/XLSX) do *briefing* diário do cockpit: indicadores + pendências ativas + calendário do dia + alertas (= críticos).
2. **Polish read-only**: "lembrar última vista" (localStorage) + "busca rápida" (client sobre linhas carregadas).

PDF fica como **não-objetivo** (só existe infra CSV/XLSX; PDF exigiria infra nova).

## Arquivos

### Criados
- `src/lib/services/comex-cockpit-briefing.ts` — **builder puro** (sem `server-only`, só `import type`): `BriefingRow`, `BRIEFING_COLUMNS`, `construirBriefing(data)`. Unit-testável com fixtures (igual a `comex-cockpit-derivaciones`/`filtros`/`calendario`).
- `src/lib/actions/comex-cockpit-export.ts` — server action `exportarCockpitDia(input)` (espelho de `exportarEmbarques`).
- `src/app/(dashboard)/comex/_components/cockpit-export-dia.tsx` — botão client (espelho de `embarques-export-button.tsx`).
- `src/app/(dashboard)/comex/_components/cockpit-ultima-vista.tsx` — polish "última vista" (localStorage; renderiza `null`).
- `src/app/(dashboard)/comex/_components/cockpit-busca-rapida.tsx` — polish "busca rápida" (filtro client in-place).
- `test/comex-cockpit-export.test.ts` — 9 testes (briefing puro + action auditada).

### Modificados (aditivos, comportamento intacto)
- `src/lib/permisos-catalog.ts` — **1 chave aditiva** `COMEX_COCKPIT_EXPORTAR: "comex.cockpit.exportar"` (dim. `EXPORTACION`) + entrada no `PERMISSION_CATALOG`.
- `src/app/(dashboard)/comex/page.tsx` — resolve `puedeExportar` (`hasPermission(COMEX_COCKPIT_EXPORTAR)`) e renderiza `<CockpitExportDia/>` no `PageHeader actions` (topo do cockpit) ao lado do `MonedaToggle`.
- `src/app/(dashboard)/comex/_components/cockpit-filtros.tsx` — monta `<CockpitUltimaVista/>` + `<CockpitBuscaRapida/>` (componentes de polish).
- `src/app/(dashboard)/comex/_components/cockpit-bloque.tsx` — atributos `data-cockpit-row` + `data-busca` em cada `<li>` (**puramente aditivos**, zero mudança visual/comportamental) para a busca rápida.

> **`cockpit.tsx` NÃO foi tocado** — a composição read-only do cockpit (022a/b/c) fica idêntica; o botão vive no `PageHeader` e a busca rápida filtra via query global no DOM.

## Composição do briefing (prova de filtro/OD-08)
`exportarCockpitDia` chama `getCockpitData({ now, verCosto, filtros })` — o **mesmo** read-service do cockpit. Os `filtros` vêm de `parseCockpitFiltros(input.params, now)` sobre os MESMOS params da URL (`vista/proveedor/eta_desde/eta_hasta/estado`), reproduzindo a vista de **SERVIDOR** (PR-022b), **não** a busca rápida client. `construirBriefing` aplana o `CockpitData` em `BriefingRow[]` por seção:

| Seção | Origem |
|---|---|
| Indicador | `indicadores` (4 KPIs; counts em `detalle`, USD em `valor`) |
| Crítico | `operacion.procesosCriticos` (= alertas críticos) |
| Arribo | `operacion.proximosArribos` |
| Sin actualizar | `operacion.sinActualizacion` |
| Documento | `documentos` |
| Costo | `custos` |
| Pago | `financeiro.pagosExteriores` (só com permiso; ver abaixo) |
| Agenda | calendário: eventos da célula `esHoy` (o dia de hoje) |

OD-08: o cockpit hoje aplica gating real apenas de **custo** (`VER_COSTO_LANDED`) — não há chaves por-seção no catálogo (gating por-seção fica para PR de permissões dedicada). O export reproduz **exatamente** esse gating reaproveitando a saída já gateada de `getCockpitData`.

## Prova de auditoria + "no file if audit fails"
A action chama `await auditarExportacion({ recurso: "comex-cockpit", filtros: {…snapshot…}, columnas, nFilas, formato })` (serviço existente, **não modificado**). Como em `exportarEmbarques`, **a auditoria é a última etapa antes do return e propaga em falha** → se a gravação do `AuditLog`/`EXPORTACION` falhar, a exceção sobe e o arquivo **não é entregue**. Teste: `"si la auditoría falla, propaga → NO se entrega el archivo"` (`mAuditar.mockRejectedValue` → `rejects.toThrow`). A ÚNICA escrita do PR é esse append de evento `EXPORTACION` (append-only, imutável — G-07).

## Prova de strip de custo server-side
- Gate de custo re-checado no servidor: `verCosto = await hasPermission(PERMISOS.VER_COSTO_LANDED)`.
- `getCockpitData({ verCosto })` já **mascara** todo valor financeiro: `*Usd` → `null`, seção `financeiro` → `null` (omitida). O briefing **nunca reintroduz** um valor mascarado: `valor` vem `""` e `filasPagos` retorna `[]` quando `financeiro === null`.
- Testes: `"sin permiso (datos enmascarados): NINGÚN valor de costo"` (puro) + `"strip de costo: re-lee con verCosto=false y lo registra"` (action passa `verCosto:false` a `getCockpitData` e ao snapshot da auditoria).

## Decisão de gate (Opção A) + aditividade
- **Opção A** (recomendada e escolhida pelo dono): chave dedicada `comex.cockpit.exportar`, dimensão `EXPORTACION`, espelhando `AUDITORIA_EXPORTAR`.
- **Aditivo puro**: o seed (`prisma/seed.ts` `seedRbacFoundation`) **itera `PERMISSION_CATALOG`** e faz `upsert` por `clave` → a chave entra automaticamente. **Nenhuma** mudança no resolver/seed-logic/schema.
- Comportamento com **RBAC OFF** (default): a chave (fora de `USER_BASE_CLAVES`) é admin-scoped → `requirePermission` delega a `requireAdmin` (ADMIN passa; outros recebem `{ok:false}`) e `hasPermission` retorna `!isAdminScopedKey` (true só p/ ADMIN). Idêntico a `AUDITORIA_EXPORTAR`/`APROBACIONES_VER`. Gate na UI (`puedeExportar` esconde o botão) + no servidor (`requirePermission` nega).

## Prova "engine intocado / sem mutação de negócio"
- `comex-cockpit-export.ts` **não importa** `services/comex` / `despacho-parcial` / `asiento` / `stock`. Imports restritos a `export/{csv,xlsx}`, `permisos`, `auditar-exportacion`, `comex-cockpit` (read), `comex-cockpit-filtros` (puro), `comex-cockpit-briefing` (puro).
- Nenhum valor é recalculado — tudo vem de `getCockpitData` (read-only). Nenhuma `db.*.create/update/delete` exceto o append de `EXPORTACION` via `auditarExportacion`.

## Polish read-only
- **Última vista**: `localStorage["comex-cockpit-ultima-vista"]`; restaura ao abrir `/comex` sem params; persiste a query quando há filtros; limpa quando o usuário faz "Limpiar" (qs vazio). `moneda` sozinho não toca a vista. Sem schema/servidor.
- **Busca rápida**: input client que alterna `hidden` sobre `[data-cockpit-row]` por `data-busca` (query global no DOM). **Não** toca a URL → **não** é reproduzida pelo export (que reflete só os filtros de servidor). Progressive enhancement: sem JS, todas as linhas aparecem.

## Validação
| Comando | Resultado |
|---|---|
| `pnpm prisma generate` | ✅ Prisma Client 7.8.0 |
| `pnpm typecheck` | ✅ sem erros |
| `pnpm build` | ✅ build completo (`/comex` dinâmico) |
| `pnpm biome:ci` | ✅ exit 0 (42 warnings PRÉ-EXISTENTES em `scoring-engine.ts`; **nenhum** arquivo do PR sinalizado) |
| `pnpm test` (Testcontainers) | ✅ **154 arquivos / 1162 testes** — inclui `validar-invariantes-comex.test.ts` (invariantes do motor Comex verdes via Testcontainers → motor intacto, sem tocar prod) |
| `pnpm vitest run` (suites do cockpit/export) | ✅ 66 testes (export 9, derivaciones 25, filtros 22, csv 7, xlsx 3) |

> **`db:validar-stock` / `db:validar-asientos`**: NÃO executados — o `.env` aponta a Railway/produção e o dono instruiu não rodar scripts de DB sem override localhost validado (e que, nesse caso, não são bloqueadores). O PR não toca o motor (prova acima), então as invariantes de stock/asientos não são afetadas por construção.

Complexidade (Codacy ≤8): a action é fina (1 branch de gate); a serialização e cada mapper de seção foram extraídos (`construirBriefing` apenas concatena; `serializar` 1 branch de formato).

## QA manual (env local seguro — Postgres descartável + `AUTH_URL=localhost`, nunca prod; admin/admin123)
- [ ] [Exportar día] baixa CSV/XLSX com indicadores + pendências + agenda do dia + alertas, respeitando os filtros 022b ativos.
- [ ] Gera linha `EXPORTACION` no `AuditLog` (ver `/sistema/auditoria`); forçando falha da auditoria → nenhum arquivo.
- [ ] Sem `comex.cockpit.exportar` → botão oculto + servidor nega; sem `VER_COSTO_LANDED` → sem custo/cash-out no arquivo.
- [ ] "última vista" reabre `/comex` na última vista; "busca rápida" filtra as linhas carregadas.
- [ ] Cockpit (022a/b/c) inalterado.

## Rollback
Remoção pura: apagar `comex-cockpit-export.ts`, `comex-cockpit-briefing.ts`, `cockpit-export-dia.tsx`, `cockpit-ultima-vista.tsx`, `cockpit-busca-rapida.tsx`, `test/comex-cockpit-export.test.ts`; reverter os `data-*` em `cockpit-bloque.tsx`, o mount em `cockpit-filtros.tsx`, o botão/`puedeExportar` em `page.tsx`, e a chave aditiva em `permisos-catalog.ts`. **Sem migration / sem migração de dados.**
