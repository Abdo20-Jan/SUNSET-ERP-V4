"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Maximize01Icon, Minimize01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/*
 * FloatingWorkWindow (PR-004) — janela de trabalho central, movível, redimensionável
 * e maximizável, para edição de registros de negócio (substitui drawers `Sheet`
 * nos fluxos de edição — G-04). Construída sobre `@base-ui/react/dialog`
 * (Root + Portal + Popup) com `modal="trap-focus"` e SEM backdrop opaco: herda
 * focus-trap, ESC, restauração de foco, portal SSR-safe e aria do base-ui; o
 * `Popup` é um `<div>` plano que aceita `style` → o posicionamento manual de
 * `left/top/width/height` não disputa com o primitivo.
 *
 * Drag/resize: geometria "ao vivo" escrita direto no DOM por frame (rAF), com
 * `setPointerCapture` e `touch-action:none`; o estado React só é commitado no
 * `pointerup` (sem re-render por pixel). Fechamento passa por um gate único
 * (`onRequestClose`) — usado pelo consumidor para confirmar descarte quando há
 * mudanças não salvas; cliques fora NÃO fecham (não é modal opaco).
 *
 * Sem novas dependências (React + pointer events).
 */
export type FloatingWorkWindowCloseReason = "escape" | "outside" | "closeButton";

type Geometry = { left: number; top: number; width: number; height: number };

type Interaction = {
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type FloatingWorkWindowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  defaultMaximized?: boolean;
  resizable?: boolean;
  modal?: boolean | "trap-focus";
  dismissOnOutsidePress?: boolean;
  onRequestClose?: (reason: FloatingWorkWindowCloseReason) => boolean | Promise<boolean>;
  className?: string;
};

const TITLEBAR_KEEP = 36;
const VIEWPORT_MARGIN = 8;

// `useLayoutEffect` no client (antes do paint, sem flash ao centralizar) e
// `useEffect` no server (não roda no SSR → evita o aviso dev-only "useLayoutEffect
// does nothing on the server" quando a ilha client é renderizada com a janela fechada).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function FloatingWorkWindow({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  initialWidth = 520,
  initialHeight = 440,
  minWidth = 360,
  minHeight = 240,
  defaultMaximized = false,
  resizable = true,
  modal = "trap-focus",
  dismissOnOutsidePress = false,
  onRequestClose,
  className,
}: FloatingWorkWindowProps) {
  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const interactionRef = React.useRef<Interaction | null>(null);
  const pendingRef = React.useRef<Geometry | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const closingRef = React.useRef(false);
  const wasOpenRef = React.useRef(false);

  const [geometry, setGeometry] = React.useState<Geometry | null>(null);
  const [maximized, setMaximized] = React.useState(defaultMaximized);

  // Na transição fechado→aberto: centra a janela medindo o viewport num layout effect
  // (antes do paint → sem flash) e restaura o estado de maximização padrão. Não lê `window`
  // no render; via `useIsomorphicLayoutEffect` não roda no SSR. Re-centra a cada abertura.
  useIsomorphicLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(initialWidth, vw - VIEWPORT_MARGIN * 2);
      const height = Math.min(initialHeight, vh - VIEWPORT_MARGIN * 2);
      setGeometry({
        left: Math.max(VIEWPORT_MARGIN, Math.round((vw - width) / 2)),
        top: Math.max(VIEWPORT_MARGIN, Math.round((vh - height) / 3)),
        width,
        height,
      });
      setMaximized(defaultMaximized);
    }
    wasOpenRef.current = open;
  }, [open, initialWidth, initialHeight, defaultMaximized]);

  // Re-clampa para dentro do viewport quando a janela do browser é redimensionada.
  React.useEffect(() => {
    if (!open || maximized) return;
    const onResize = () => {
      setGeometry((g) => {
        if (!g) return g;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.min(g.width, vw - VIEWPORT_MARGIN * 2);
        const height = Math.min(g.height, vh - VIEWPORT_MARGIN * 2);
        return {
          width,
          height,
          left: clamp(g.left, 0, vw - width),
          top: clamp(g.top, 0, vh - TITLEBAR_KEEP),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, maximized]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const applyToDom = React.useCallback((next: Geometry) => {
    pendingRef.current = next;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const panel = popupRef.current;
      const n = pendingRef.current;
      if (!panel || !n) return;
      panel.style.left = `${n.left}px`;
      panel.style.top = `${n.top}px`;
      panel.style.width = `${n.width}px`;
      panel.style.height = `${n.height}px`;
      panel.style.transform = "none";
    });
  }, []);

  // Handlers passados POR REFERÊNCIA (não invocados no render). Uma factory chamada no JSX
  // (`beginInteraction("move")`) faria o React Compiler ver o acesso aos refs "durante o render".
  const beginInteraction = (mode: Interaction["mode"], e: React.PointerEvent<HTMLElement>) => {
    if (maximized || interactionRef.current || e.button !== 0) return;
    if (mode === "move" && (e.target as Element).closest("[data-no-drag]")) return;
    const panel = popupRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    interactionRef.current = {
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMovePointerDown = (e: React.PointerEvent<HTMLElement>) => beginInteraction("move", e);
  const onResizePointerDown = (e: React.PointerEvent<HTMLElement>) => beginInteraction("resize", e);

  const onInteractionMove = (e: React.PointerEvent<HTMLElement>) => {
    const it = interactionRef.current;
    if (!it || it.pointerId !== e.pointerId) return;
    const dx = e.clientX - it.startX;
    const dy = e.clientY - it.startY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (it.mode === "move") {
      applyToDom({
        width: it.width,
        height: it.height,
        left: clamp(it.left + dx, 0, vw - it.width),
        top: clamp(it.top + dy, 0, vh - TITLEBAR_KEEP),
      });
    } else {
      applyToDom({
        left: it.left,
        top: it.top,
        width: clamp(it.width + dx, minWidth, vw - it.left - VIEWPORT_MARGIN),
        height: clamp(it.height + dy, minHeight, vh - it.top - VIEWPORT_MARGIN),
      });
    }
  };

  const endInteraction = (e: React.PointerEvent<HTMLElement>) => {
    const it = interactionRef.current;
    if (!it || it.pointerId !== e.pointerId) return;
    interactionRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const panel = popupRef.current;
    if (panel) {
      const rect = panel.getBoundingClientRect();
      setGeometry({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
  };

  const attemptClose = React.useCallback(
    async (reason: FloatingWorkWindowCloseReason) => {
      if (closingRef.current) return;
      if (onRequestClose) {
        closingRef.current = true;
        try {
          const ok = await onRequestClose(reason);
          if (!ok) return;
        } finally {
          closingRef.current = false;
        }
      }
      onOpenChange(false);
    },
    [onRequestClose, onOpenChange],
  );

  const style: React.CSSProperties = maximized
    ? {
        left: VIEWPORT_MARGIN,
        top: VIEWPORT_MARGIN,
        right: VIEWPORT_MARGIN,
        bottom: VIEWPORT_MARGIN,
      }
    : geometry
      ? { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height }
      : {
          left: "50%",
          top: "12%",
          width: initialWidth,
          height: initialHeight,
          transform: "translateX(-50%)",
        };

  return (
    <DialogPrimitive.Root
      open={open}
      modal={modal}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        if (details.reason === "outside-press" && !dismissOnOutsidePress) {
          details.cancel();
          return;
        }
        const mapped: FloatingWorkWindowCloseReason =
          details.reason === "escape-key"
            ? "escape"
            : details.reason === "outside-press"
              ? "outside"
              : "closeButton";
        details.cancel();
        void attemptClose(mapped);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          ref={popupRef}
          data-slot="floating-work-window"
          style={style}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-[13px] text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none",
            className,
          )}
        >
          <div
            className="flex shrink-0 cursor-move touch-none items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 select-none"
            onPointerDown={onMovePointerDown}
            onPointerMove={onInteractionMove}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
          >
            <DialogPrimitive.Title className="min-w-0 truncate text-[13px] font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            <div data-no-drag className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={maximized ? "Restaurar ventana" : "Maximizar ventana"}
                onClick={() => setMaximized((m) => !m)}
              >
                <HugeiconsIcon icon={maximized ? Minimize01Icon : Maximize01Icon} strokeWidth={2} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Cerrar ventana"
                onClick={() => void attemptClose("closeButton")}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </div>
          </div>

          {description && (
            <DialogPrimitive.Description className="shrink-0 border-b border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          )}

          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>

          {footer && <div className="shrink-0">{footer}</div>}

          {resizable && !maximized && (
            <div
              role="presentation"
              aria-hidden
              className="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none"
              onPointerDown={onResizePointerDown}
              onPointerMove={onInteractionMove}
              onPointerUp={endInteraction}
              onPointerCancel={endInteraction}
            >
              <span className="absolute right-1 bottom-1 size-2 border-r-2 border-b-2 border-muted-foreground/40" />
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
