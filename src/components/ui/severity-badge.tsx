import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
 * SeverityBadge — PR-001 Design Foundation.
 * Indicador de severidade para alertas/avisos (06_RECORD_PATTERN / 04_DESIGN_SYSTEM:
 * "severidade por cor SEM pintar a tela inteira"). Compartilha os tokens de status.
 *   critical = vermelho controlado (bloqueio/impeditivo)
 *   warning  = âmbar (atenção)
 *   info     = azul (informação)
 *   neutral  = cinza (baixa relevância)
 */
const severityVariants = cva("", {
  variants: {
    severity: {
      neutral: "bg-muted text-muted-foreground border-border/60",
      info: "bg-info/12 text-info border-info/25",
      warning: "bg-warning/15 text-warning border-warning/30",
      critical: "bg-destructive/10 text-destructive border-destructive/25",
    },
  },
  defaultVariants: { severity: "info" },
});

export type Severity = NonNullable<VariantProps<typeof severityVariants>["severity"]>;

type SeverityBadgeProps = Omit<React.ComponentProps<typeof Badge>, "variant"> & {
  severity?: Severity;
};

export function SeverityBadge({ severity, className, ...props }: SeverityBadgeProps) {
  return <Badge className={cn(severityVariants({ severity }), className)} {...props} />;
}

export { severityVariants };
