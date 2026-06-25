"use client";

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import type { PermisoKey } from "@/lib/permisos-catalog";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHasPermission } from "@/components/auth/permissions-provider";

// Mascaramento híbrido (PAGE-STD-02 funcional 7 / PERM-01 funcional 7). Quando a permissão
// está ausente, cada variant degrada de um jeito mantendo o LAYOUT ESTÁVEL:
//   field  → "—" + tooltip          block  → bloco oculto + mensagem
//   page   → mensagem central       column → não renderizado (null)
//   button → desabilitado + tooltip
// Com RBAC OFF (snapshot undefined) `useHasPermission` sempre devolve true ⇒ renderiza children.
export type PermissionGateVariant = "field" | "block" | "column" | "button" | "page";

type PermissionGateProps = {
  permission: PermisoKey;
  variant?: PermissionGateVariant;
  children: ReactNode;
  /** Mensagem central (variants block/page). */
  message?: string;
  /** Texto do tooltip (variants field/button). */
  tooltip?: string;
  className?: string;
};

const DEFAULT_MESSAGE = "No tenés permiso para ver esta información.";
const DEFAULT_TOOLTIP = "Sin permiso";

export function PermissionGate({
  permission,
  variant = "block",
  children,
  message = DEFAULT_MESSAGE,
  tooltip = DEFAULT_TOOLTIP,
  className,
}: PermissionGateProps): ReactNode {
  const allowed = useHasPermission(permission);
  if (allowed) return <>{children}</>;
  return renderDenied(variant, { children, message, tooltip, className });
}

type DeniedOpts = {
  children: ReactNode;
  message: string;
  tooltip: string;
  className?: string;
};

function renderDenied(variant: PermissionGateVariant, opts: DeniedOpts): ReactNode {
  switch (variant) {
    case "field":
      return <DeniedField tooltip={opts.tooltip} className={opts.className} />;
    case "block":
      return <DeniedBlock message={opts.message} className={opts.className} />;
    case "page":
      return <DeniedPage message={opts.message} />;
    case "button":
      return <DeniedButton tooltip={opts.tooltip}>{opts.children}</DeniedButton>;
    default:
      // "column": coluna/conteúdo simplesmente não renderizado.
      return null;
  }
}

function DeniedField({ tooltip, className }: { tooltip: string; className?: string }) {
  // Dato enmascarado: display no interactivo → tooltip solo en hover (sin tabIndex).
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<span className={cn("text-muted-foreground", className)} />}>
          —
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DeniedBlock({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {message}
    </div>
  );
}

function DeniedPage({ message }: { message: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium text-foreground">Acceso restringido</p>
      <p className="max-w-md text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function DeniedButton({ children, tooltip }: { children: ReactNode; tooltip: string }) {
  const disabledChild = isValidElement(children)
    ? cloneElement(children as ReactElement<{ disabled?: boolean }>, { disabled: true })
    : children;
  return (
    <TooltipProvider>
      <Tooltip>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: span wrapper necesario para tooltip sobre control deshabilitado (no recibe foco ni eventos) */}
        <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
          {disabledChild}
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
