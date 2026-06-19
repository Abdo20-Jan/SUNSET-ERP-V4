# NS-4 PR-1 · record-shell (fundação) + piloto Proveedor — Implementation Plan

> Execução inline (executing-plans). Trabalho acoplado: 4 primitivos + 1 página piloto.

**Goal:** primitivos reutilizáveis de "record-shell" (header normalizado + subtabs URL-driven + lista de related-records) e aplicá-los ao detalhe de **Proveedor** como piloto (tabs General / Compras / Pagos / Anticipos). Sem auditoria (PR-2) e sem tocar venta/asiento/embarque (rollout depois).

**Architecture:** componentes presentacionais (`RecordHeader`, `RelatedList`/`RelatedItem`) + um client URL-driven (`RecordTabs`, extrai o padrão de `embarques-tabs.tsx`) + helper puro `resolveActiveTab` (TDD). A página `proveedores/[id]` passa a ler `?tab=` e renderizar a tab ativa server-side (lazy por tab; counts cheap para Compras/Anticipos).

**Tech Stack:** Next 16 RSC, @base-ui/react Tabs, Tailwind v4, StatusBadge, vitest node.

## Global Constraints
- Header com densidade do repo (`text-[15px]`); NÃO usar `text-2xl`/`container p-6` (dialeto divergente das telas órfãs).
- Tabs URL-driven via `URLSearchParams` cru (SEM nuqs), espelhando `embarques-tabs.tsx` (`Tabs value`+`onValueChange`→`router.replace(scroll:false)`, `TabsList variant="line"`, `TabsTrigger`+`Badge`).
- Reusar `getHistoricoPagos`+`PagosHistorialTable` (já usados na página atual) e `StatusBadge`. `/compras/[id]` existe (linkar Compras). Anticipos não tem rota de detalhe → RelatedItem sem href.
- Página `force-dynamic` → `useSearchParams` do RecordTabs seguro sem Suspense.

---

### Task 1: Helper puro `src/lib/record-tabs.ts` (TDD)
`resolveActiveTab(param: string|undefined, allowed: readonly string[], fallback: string): string` → retorna `param` se válido na allowlist, senão `fallback`. Testes em `test/record-tabs.test.ts` (válido, inválido, undefined, vazio).

### Task 2: `src/components/layout/record-header.tsx`
`RecordHeader({ breadcrumb?: {label,href?}[], title, subtitle?, status?, actions? })` presentacional: linha de breadcrumb (Links + `/`), linha título (`h1 text-[15px]` + status) + actions à direita, subtitle. Normaliza os 3 dialetos de header.

### Task 3: `src/components/ui/record-tabs.tsx` (client)
`RecordTabs({ tabs: {value,label,count?}[], activeValue, paramKey="tab" })` — `useRouter`/`usePathname`/`useSearchParams`; `onValueChange` seta `paramKey`, deleta `page`, `router.replace(scroll:false)`. Render `Tabs value=activeValue` + `TabsList variant="line"` + `TabsTrigger` (Badge `variant="outline"` ml-1 quando `count != null`). Sem `TabsContent` (conteúdo é server-rendered pela página).

### Task 4: `src/components/ui/related-list.tsx`
`RelatedList({ emptyText, children })` (mostra empty state se children vazio) + `RelatedItem({ href?, title, subtitle?, trailing? })` (linha bordada hover; envolve em `<Link>` se href).

### Task 5: `ESTADO_TONO` — cobrir EstadoAnticipo
Em `status-badge.tsx`: `VIGENTE: "info"`, `APLICADO_TOTAL: "success"` (hoje caem em neutral).

### Task 6: Refatorar `maestros/proveedores/[id]/page.tsx`
`searchParams: Promise<{tab?}>`; `activeTab = resolveActiveTab(tab, ["general","compras","pagos","anticipos"], "general")`. `findUnique` proveedor + `Promise.all([compra.count, anticipoProveedor.count])`. `<RecordHeader>` + `<RecordTabs>` (4 tabs; counts em Compras/Anticipos). Switch por activeTab:
- **general**: Card de campos (Tipo/Email/Teléfono/Condición) — como hoje.
- **compras**: `db.compra.findMany({where:{proveedorId}, orderBy fecha desc, take 200})` → `RelatedList` de `RelatedItem href=/compras/[id]` (title `#numero`, subtitle fecha, trailing total+`StatusBadge`).
- **pagos**: `getHistoricoPagos` + `PagosHistorialTable` (reuso).
- **anticipos**: `db.anticipoProveedor.findMany({where:{proveedorId}, orderBy fecha desc})` → `RelatedList` (title `#numero`, subtitle fecha, trailing montoArs+`StatusBadge`; sem href).

### Gates
typecheck · eslint · biome (escopo) · vitest · `pnpm build` (página dinâmica + client novo). Review adversarial opus whole-branch → PR → auto-merge. Validação visual prod não-essencial (wipe → proveedor sem compras/pagos; estrutura garantida por código+review).

### Próximo (NS-4)
PR-2 audit-trail (getAuditLog + `<AuditTrail>` + helper `registrarAuditoria` + instrumentar 1 domínio + tab Historial). PR-3+ rollout (venta resolve órfã Entregas, asiento, embarque). Cliente ganha o mesmo shell de Proveedor.
