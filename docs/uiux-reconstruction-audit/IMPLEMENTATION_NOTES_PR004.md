# IMPLEMENTATION NOTES — PR-004 Record Pattern / FloatingWorkWindow / ActionBar / DirtyFooter

Data: 2026-06-24 · Branch: `pr-004-record-page-pattern` · **Não commitado.**

> Entrega a **fundação reutilizável de páginas de detalhe (record)** + a **janela de trabalho
> flutuante** para edição de negócio (G-04). Tudo **aditivo**, aplicado a **UM piloto seguro**
> (`/maestros/depositos/[id]`). Consome a fundação do PR-001 (densidade/cor) e do PR-002
> (abas internas). **Sem** lógica de negócio/cálculo/permissão/auditoria/schema/auth/migrations.

## Achado decisivo (reconciliação com o `main`)
Parte da fundação de record **já existe em `main`** (série NS-4): `RecordHeader`
([src/components/layout/record-header.tsx](../../src/components/layout/record-header.tsx),
slots `breadcrumb/title/subtitle/status/actions`), `RecordTabs`, `StatusBadge`, `RelatedList`,
`AuditTrail` — já consumidos por `ventas/[id]`, `contabilidad/asientos/[id]`,
`maestros/proveedores/[id]`. Logo, o PR-004 **reusa** `RecordHeader` (não recria) e entrega só os
**5 primitivos que faltavam** + um hook de dirty.

## Decisões do dono (confirmadas em Plan Mode)
- **Piloto:** Depósitos — cadastro puro de 4 campos, **zero** imports de serviços protegidos.
- **Acesso à ficha:** a célula "Nombre" da lista de depósitos vira link para `/maestros/depositos/[id]`
  (mudança aditiva de 1 célula; diálogo de edição/exclusão da lista permanecem intactos).

## Arquivos novos — `src/components/record/` (espelha `data-grid/`)
| arquivo | conteúdo |
|---|---|
| [record-layout.tsx](../../src/components/record/record-layout.tsx) | scaffold da ficha: slot `header` (recebe o `RecordHeader` existente) + `actionBar` + corpo de seções. Server-safe. |
| [record-section.tsx](../../src/components/record/record-section.tsx) | `RecordSection` (seção titulada) + `RecordFieldGrid` + `RecordField` — substituem o `Card grid` + helper `Field` duplicado em cada `[id]`. Server-safe. |
| [record-action-bar.tsx](../../src/components/record/record-action-bar.tsx) | `RecordActionBar` sticky (slots `left`/`right`/`children`). Server-safe. |
| [dirty-footer.tsx](../../src/components/record/dirty-footer.tsx) | `DirtyFooter` apresentacional (indicador "cambios sin guardar" + Guardar/Cancelar). Integração **opt-in** de abas via `useInternalTabsOptional` (`tabHref`/`tabLabel`) — degrada a `null` sem provider. |
| [use-dirty-state.ts](../../src/components/record/use-dirty-state.ts) | `useDirtyState` — espelha o flag `isDirty` num `ref` para os gates de fechamento lerem sem stale closure. |
| [floating-work-window.tsx](../../src/components/record/floating-work-window.tsx) | `FloatingWorkWindow` — janela central movível/redimensionável/maximizável. |

**Sem novos pacotes** (`@base-ui/react` já provê dialog; reusa Button/Input/Label/Select/Dialog,
`StatusBadge`, tokens PR-001 e `useInternalTabsOptional` do PR-002).

### API do `FloatingWorkWindow`
```tsx
type FloatingWorkWindowProps = {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode;
  initialWidth?: number (520); initialHeight?: number (440);
  minWidth?: number (360); minHeight?: number (240);
  defaultMaximized?: boolean; resizable?: boolean (true);
  modal?: boolean | "trap-focus" (default "trap-focus");
  dismissOnOutsidePress?: boolean (default false);   // janela de trabalho não fecha por clique-fora
  onRequestClose?: (reason: "escape" | "outside" | "closeButton") => boolean | Promise<boolean>;
};
```
- **Base:** `@base-ui/react/dialog` (`Root` + `Portal` + `Popup`), `modal="trap-focus"`, **sem
  Backdrop**. Herda focus-trap, ESC, restauração de foco, portal SSR-safe e aria; o `Popup` é um
  `<div>` plano que aceita `style={{left,top,width,height}}` → o posicionamento manual não conflita.
- **Drag/resize:** geometria "ao vivo" em `useRef`, escrita direto no DOM por frame (`requestAnimationFrame`);
  `setPointerCapture` + `touch-action:none`; clamp ao viewport; base do drag em ref (sem stale closure);
  **commit em `setState` só no `pointerup`** (sem re-render por pixel). Re-clampa em `resize` de viewport.
- **Fechamento:** gate único `onRequestClose` em ESC e botão X; clique-fora é cancelado
  (`eventDetails.cancel()`) por padrão. Para confirmação assíncrona, cancela primeiro e fecha após o
  `await` (o base-ui decide síncrono).
- **Centralização SSR-safe:** `useLayoutEffect` (antes do paint), nunca lê `window` no render.

## Piloto — `/maestros/depositos/[id]`
- [page.tsx](<../../src/app/(dashboard)/maestros/depositos/[id]/page.tsx>) — server component
  (`force-dynamic`). Busca `db.deposito.findUnique` direto (mesmo padrão de `proveedores/[id]`;
  **não** toca `lib/actions/depositos.ts`) + contagens read-only (`movimientoStock`/`embarque`).
  Renderiza `RecordLayout` → `RecordHeader` (reusado, com `StatusBadge` Activo/Inactivo) +
  `RecordActionBar` (link "Volver" + ilha client "Editar") + `RecordSection`s "Datos"/"Referencias".
- [deposito-edit-window.tsx](<../../src/app/(dashboard)/maestros/depositos/[id]/deposito-edit-window.tsx>)
  — ilha client. "Editar" abre o `FloatingWorkWindow` com o form de 4 campos (`react-hook-form` +
  `zodResolver`, mesmo schema do diálogo da lista) ligado a **`actualizarDepositoAction`**
  (ação existente, intocada). `DirtyFooter` no slot `footer`; `onRequestClose` consulta
  `formState.isDirty` → `Dialog` de confirmação de descarte; `router.refresh()` no sucesso.

## Arquivos editados (mínimo)
- [depositos-table.tsx](<../../src/app/(dashboard)/maestros/depositos/depositos-table.tsx>) — célula
  "Nombre" vira `next/link` para a ficha (1 célula; busca/edição/exclusão/RowActions intactos).
- [HANDOFF_CURRENT.md](HANDOFF_CURRENT.md) — seção PR-004.

## O que NÃO foi implementado (intencional — fora do escopo aprovado)
- **Migração dos 5 drawers de negócio** (tesouraria ×4, asientos) → FWW → PRs de módulo.
- **"Más filtros"/AdvancedFilters em FWW** (placeholder do `filter-bar.tsx`) — deixado como está; o
  FWW fica **pronto** para hospedá-lo num PR futuro.
- **AlertPopover, DualCurrencyAmount/MoneyCell, abas Resumen/Documentos/Historial** (constam do
  roadmap PR-004, mas **fora** da lista de primitivos aprovada pelo dono).
- **Refatorar as fichas existentes** (`ventas/[id]`, `asientos/[id]`, `proveedores/[id]`) para os
  novos primitivos → follow-up; ficam intactas.

## Comandos de validação e resultados
| comando | resultado |
|---|---|
| `pnpm prisma generate` | ✅ Client 7.8.0 gerado (pré-requisito da suíte; client git-ignorado fica stale). |
| `pnpm typecheck` | ✅ **exit 0** (após corrigir os literais de `reason` do base-ui — kebab-case `escape-key`/`outside-press`). |
| `pnpm build` | ✅ **exit 0**; rota `/maestros/depositos/[id]` compilada e no `app-paths-manifest`. |
| `pnpm biome:ci` | ✅ **exit 0** — warnings só pré-existentes (breadcrumb/input-group/sidebar/scoring-engine); **nenhum** nos arquivos do PR-004. |
| `pnpm test` (`vitest run`) | ✅ **903 passados + 2 skipped**; **1 suite** (`entregas-pendientes-loader`) falhou só por **timeout de port-binding do Testcontainers** → **passa 2/2 no retry isolado** (flake de infra, não regressão; o PR não toca código testado). |
| e2e por browser | ⏸️ **diferido** — suíte Playwright do repo é service-level (sem browser), como nos PR-001/002/003. |

## QA visual (checklist manual — requer dev server + sessão)
Em `/maestros/depositos`:
- Clicar no **nome** → abre `/maestros/depositos/[id]`; header (breadcrumb/título/`StatusBadge`) +
  seções "Datos"/"Referencias" em densidade PR-001.
- "Editar" → **FloatingWorkWindow** central: **arrastar** pela barra de título, **redimensionar**
  pelo canto inferior-direito, **maximizar/restaurar**, **fechar** (X/ESC).
- Alterar um campo → `DirtyFooter` mostra "Cambios sin guardar"; tentar fechar → confirmação de
  descarte; **Guardar** → toast + ficha atualizada.
- Com `TOP_NAV_ENABLED=ON`: a aba do registro recebe `*` enquanto há mudanças não salvas (degrada
  sem provider).

## Rollback
- **Piloto:** remover `maestros/depositos/[id]/` + reverter a 1 célula linkada em `depositos-table.tsx`.
- **Total:** remover `src/components/record/`. Zero efeito em dados/migrations/motores/permissão/auth.
