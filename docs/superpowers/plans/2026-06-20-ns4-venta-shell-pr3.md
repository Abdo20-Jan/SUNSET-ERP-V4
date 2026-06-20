# NS-4 PR-3 · rollout do record-shell em Venta + resolver órfã Entregas — Plan

> Execução inline. Refatora a view de venta para o record-shell (RecordHeader + RecordTabs) e move Entregas (rota órfã) para uma tab no mesmo path. SEM auditoria (PR-4).

**Goal:** `/ventas/[id]` (estado ≠ BORRADOR) usa o record-shell com tabs **General · Entregas** (Entregas só com stock dual). A rota separada `/ventas/[id]/entregas` vira redirect para `?tab=entregas`. Resolve a "rota órfã" (layout divergente `container p-6`/`text-2xl`).

**Architecture:** quebra o monolito client `VentaDetailView` (305 linhas) em: `VentaDetailActions` (client — MonedaToggle + Anular, as únicas partes interativas) + `VentaGeneralView` (presentacional — Stats/campos/ítems, sai do bundle client) + `VentaEntregasView` (presentacional — lista de remitos + Nueva entrega, reusa EntregaActions). A página compõe `RecordHeader`+`RecordTabs`+tab ativa (entregas lazy). Reusa `resolveActiveTab`.

**Tech Stack:** Next 16 RSC, RecordHeader/RecordTabs (NS-4 PR-1), StatusBadge, MonedaToggle, vitest node.

## Global Constraints
- `RecordTabs` é URL-driven (`?tab=`); o `MonedaToggle` preserva os params (constrói de `searchParams.toString()`) → tab sobrevive à troca de moeda. Página `force-dynamic`.
- StatusBadge cobre BORRADOR/EMITIDA/CANCELADA (ESTADO_TONO). Densidade `text-[15px]` (NÃO `text-2xl`).
- Entregas tab só quando `isStockDualEnabled()`. Conteúdo da tab ativa lazy (lista só quando ativa); count sempre (quando stock dual).
- Reusa `obtenerVentaPorId`, `listarEntregasDeVenta`, `EntregaActions`, `fmt*` de `@/lib/format`. Sem schema.

---

### Task 1: `ventas/_components/venta-detail-actions.tsx` (client)
Extrai do `VentaDetailView`: `MonedaToggle` + botão/dialog Anular (`anularVentaAction`). Props `{ ventaId, numero, moneda, tcInfo, puedeAnular }`. (O botão "Entregas" NÃO vem — virou tab.)

### Task 2: `ventas/_components/venta-general-view.tsx` (presentacional)
Extrai: 5 Stat cards + Card de campos (Fecha/Vencimiento/TC/Asiento/Notas) + tabela de ítems. Props `{ venta, productosMap, depositosMap, asientoNumero, moneda, tc }`. Inclui os helpers `Stat`/`Field`. Sem "use client" (só formata).

### Task 3: `ventas/_components/venta-entregas-view.tsx` (presentacional)
Extrai da página órfã: sub-header (contagem remitos/borradores/confirmadas + "Nueva entrega" link quando estado EMITIDA) + lista de Cards de remitos (reusa `EntregaActions`) + empty state. Props `{ ventaId, numero, estado, entregas }`. Sem `container p-6`/`text-2xl`.

### Task 4: Reescrever `ventas/[id]/page.tsx` (branch não-BORRADOR)
`searchParams: { moneda?, tab? }`. `tabsDisponibles = stockDualOn ? ["general","entregas"] : ["general"]`; `activeTab = resolveActiveTab(sp.tab, tabsDisponibles, "general")`. Promise.all (cliente/productos/depositos/asiento/session/cotizacion + `db.entregaVenta.count` quando stockDualOn). `RecordHeader` (breadcrumb Ventas/Venta Nº · título · `StatusBadge` · subtítulo cliente·fecha·condición · actions=`<VentaDetailActions>`) + `RecordTabs` (quando stockDualOn) + `{activeTab==="general" && <VentaGeneralView/>}` + `{activeTab==="entregas" && <VentaEntregasView entregas={await listarEntregasDeVenta(id)}/>}`. Remove `VentaDetailView`.

### Task 5: Redirect da rota órfã + ajustar Nueva entrega
- `ventas/[id]/entregas/page.tsx` → `redirect('/ventas/${id}?tab=entregas')`.
- `nueva-entrega-form.tsx:91` e back-links de `nueva/page.tsx` → `?tab=entregas` em vez de `/entregas`.

### Task 6: Remover `ventas/_components/venta-detail-view.tsx`.

### Gates
typecheck · eslint · biome (escopo) · vitest (808; reuso de resolveActiveTab já testado) · `pnpm build` (client novo + redirect). Review adversarial opus whole-branch → PR → auto-merge.

### Próximo (NS-4)
PR-4 audit de venta (instrumentar guardarVenta/anularVenta + tab Historial, padrão do PR-2). PR-5+ asiento/embarque/cliente. Depois NS-5.
