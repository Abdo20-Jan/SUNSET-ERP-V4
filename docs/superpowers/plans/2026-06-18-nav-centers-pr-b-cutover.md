# PR-B — Cutover da navegación por centers (Fase F · NS-2)

> **For agentic workers:** ejecución inline con gates incrementales + review adversarial final.

**Goal:** Hacer de la topnav la navegación real (default), eliminar el legado de sidebar y completar la accesibilidad del mega-menú con el patrón ARIA menubar.

**Architecture:** El `(dashboard)/layout.tsx` deja de ramificar por cookie y monta siempre `AppTopnav`. El mega-menú pasa de `Popover` (sin teclado) al primitivo `Menubar` + `Menu` de base-ui (role=menubar/menu, flechas ←→ entre centers y ↑↓ dentro, aria-expanded, Esc, foco roving — todo nativo). Se borran sidebar/header/user-menu/nav-items/nav-flag legados.

**Tech Stack:** Next 16 (RSC) · React 19 · `@base-ui/react@1.5.0` (Menubar + Menu) · Tailwind v4 · hugeicons · vitest (node env, sin jsdom).

## Global Constraints

- **Rutas no cambian.** Server actions, datos y los 31 `ui/` intactos (salvo `sidebar.tsx`, que queda huérfano — se deja en su lugar como primitivo reusable, no se borra).
- **Cutover completo (decisión del dueño):** se borra el branch sidebar; rollback = `git revert` del PR (no por flag). Por lo tanto la flag `ui_nav` pierde sentido y también se elimina.
- **a11y vía primitivo base-ui**, no hand-roll (lo manda el ADR).
- Sin schema. Code-only.
- Gates: `pnpm biome:ci` (correr SIEMPRE antes del PR — el formatter no es required check pero rompe build local), `pnpm typecheck`, `pnpm test`. Build lo corre CI.

---

## Task 1: a11y del mega-menú — Popover → Menubar/Menu

**Files:**
- Create: `src/components/ui/menubar.tsx` (wrapper fino del primitivo `Menubar`)
- Modify: `src/components/layout/center-mega-menu.tsx` (Popover → DropdownMenu)
- Modify: `src/components/layout/app-topnav.tsx` (envolver centers en `<Menubar>`)

**Interfaces:**
- `CenterMegaMenu` mantiene su firma `{ center: NavCenter; active: boolean }`.
- Nuevo `Menubar` = wrapper de `@base-ui/react/menubar` con `data-slot` + className flex.

- [ ] **Step 1: crear `ui/menubar.tsx`**

```tsx
"use client";

import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";

import { cn } from "@/lib/utils";

function Menubar({ className, ...props }: MenubarPrimitive.Props) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      // modal=false: barra de navegación, no debe bloquear scroll/foco del resto
      modal={false}
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

export { Menubar };
```

- [ ] **Step 2: reescribir `center-mega-menu.tsx` sobre el primitivo Menu (vía componentes dropdown-menu)**

```tsx
"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NavCenter } from "@/components/layout/nav-config";

export function CenterMegaMenu({ center, active }: { center: NavCenter; active: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {center.label}
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="grid w-auto min-w-[28rem] grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-3 rounded-md p-4"
      >
        {center.sections.map((section) => (
          <DropdownMenuGroup key={section.label} className="flex flex-col gap-1">
            <DropdownMenuLabel className="px-1 py-0 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              {section.label}
            </DropdownMenuLabel>
            {section.items.map((item) => (
              <DropdownMenuItem
                key={item.href}
                render={<Link href={item.href} />}
                className="gap-2 rounded-md px-1.5 py-1 text-[12.5px]"
              >
                <HugeiconsIcon icon={item.icon} className="size-4 text-muted-foreground" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        {center.crossLinks && center.crossLinks.length > 0 ? (
          <DropdownMenuGroup className="flex flex-col gap-1">
            <DropdownMenuLabel className="px-1 py-0 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              Atajos
            </DropdownMenuLabel>
            {center.crossLinks.map((item) => (
              <DropdownMenuItem
                key={item.href}
                render={<Link href={item.href} />}
                className="gap-2 rounded-md px-1.5 py-1 text-[12.5px]"
              >
                <HugeiconsIcon icon={item.icon} className="size-4 text-muted-foreground" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: envolver los centers en `<Menubar>` en `app-topnav.tsx`**

Reemplazar el `<nav ... aria-label="Centers">{barCenters.map(...)}</nav>` por:

```tsx
import { Menubar } from "@/components/ui/menubar";
// ...
<Menubar className="ml-1 hidden md:flex" aria-label="Centers">
  {barCenters.map((center) => (
    <CenterMegaMenu key={center.id} center={center} active={center.id === activeId} />
  ))}
</Menubar>
```

- [ ] **Step 4: gates** — `pnpm typecheck && pnpm biome:ci && pnpm test`. Esperado: verde (los tests puros de nav siguen pasando; no hay test nuevo de a11y porque no hay jsdom — se verifica visualmente).

- [ ] **Step 5: commit** — `feat(ui): mega-menú accesible con primitivo Menubar (role=menubar/menu, flechas, aria-expanded)`

## Task 2: cutover del layout + borrado del legado

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx` (quitar ramificación; siempre topnav)
- Delete: `src/components/layout/app-sidebar.tsx`, `src/components/layout/app-header.tsx`, `src/components/layout/user-menu.tsx`, `src/components/layout/nav-items.ts`, `src/lib/nav/nav-flag.ts`, `test/nav-flag.test.ts`

- [ ] **Step 1: simplificar `layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { AppTopnav } from "@/components/layout/app-topnav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const modoRetroactivo = session.user.modoRetroactivo ?? false;

  return (
    <div className="flex min-h-svh flex-col">
      <AppTopnav user={session.user} />
      {modoRetroactivo ? (
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
          Modo retroactivo activo · las fechas no se autocompletan ·{" "}
          <Link href="/perfil" className="underline hover:text-amber-950">
            ajustar en perfil
          </Link>
        </div>
      ) : null}
      <main className="flex-1 px-4 py-3">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: borrar los 6 archivos legados** (sidebar/header/user-menu/nav-items/nav-flag + su test). `git rm`.

- [ ] **Step 3: verificar que no quedan imports rotos** — `grep -rn "app-sidebar\|app-header\|layout/user-menu\|nav-items\|nav-flag\|UI_NAV_COOKIE\|resolveNavVariant" src/ test/` → vacío.

- [ ] **Step 4: gates** — `pnpm typecheck && pnpm biome:ci && pnpm test`. Esperado: verde.

- [ ] **Step 5: commit** — `feat(ui): cutover a topnav por default y borrado del legado sidebar`

## Verificación final

- Review adversarial whole-branch (subagente, modelo capaz) sobre el diff `origin/main..HEAD`.
- Aplicar fixes Critical/Important.
- Verificación visual con el dueño en preview/prod (role=menubar en DOM, flechas entre centers, Esc, sin sidebar).
- PR + auto-merge si CI verde. ☑ nota 20 del vault + memoria.
