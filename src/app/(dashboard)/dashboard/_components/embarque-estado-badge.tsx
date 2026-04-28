import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EmbarqueEstado } from "@/generated/prisma/client";

const ESTADO_LABEL: Record<EmbarqueEstado, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  EN_PUERTO: "En puerto",
  EN_ZONA_PRIMARIA: "En zona primaria",
  EN_ADUANA: "En aduana",
  DESPACHADO: "Despachado",
  EN_DEPOSITO: "En depósito",
  CERRADO: "Cerrado",
};

const ESTADO_CLASSES: Record<EmbarqueEstado, string> = {
  BORRADOR: "bg-muted text-muted-foreground",
  EN_TRANSITO: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  EN_PUERTO: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  EN_ZONA_PRIMARIA: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  EN_ADUANA: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  DESPACHADO: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  EN_DEPOSITO: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  CERRADO: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

export function EmbarqueEstadoBadge({ estado }: { estado: EmbarqueEstado }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", ESTADO_CLASSES[estado])}>
      {ESTADO_LABEL[estado]}
    </Badge>
  );
}
