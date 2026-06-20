import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tono = "neutral" | "info" | "success" | "warning" | "danger";

const TONO_CLASS: Record<Tono, string> = {
  neutral: "border-transparent bg-muted text-muted-foreground",
  info: "border-transparent bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  success:
    "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "border-transparent bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  danger: "border-transparent bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

/**
 * Mapa semántico de tokens de estado → tono. Cubre los valores comunes de los
 * enums del dominio (Venta/Compra/Embarque/Asiento/Periodo/etc.). Tokens
 * desconocidos caen en `neutral` (seguro). El badge ya muestra el texto en
 * mayúsculas vía CSS.
 */
const ESTADO_TONO: Record<string, Tono> = {
  // negativos / cancelados
  ANULADO: "danger",
  ANULADA: "danger",
  CANCELADA: "danger",
  CANCELADO: "danger",
  RECHAZADO: "danger",
  RECHAZADA: "danger",
  VENCIDO: "danger",
  VENCIDA: "danger",
  PERDIDA: "danger",
  // concluidos / positivos
  CONTABILIZADO: "success",
  CONTABILIZADA: "success",
  PAGADO: "success",
  PAGADA: "success",
  COBRADO: "success",
  ENTREGADO: "success",
  ENTREGADA: "success",
  RECIBIDA: "success",
  RECIBIDO: "success",
  CONFIRMADO: "success",
  CONFIRMADA: "success",
  APROBADO: "success",
  APROBADA: "success",
  GANADA: "success",
  CERRADO: "success",
  CERRADA: "success",
  APLICADO_TOTAL: "success",
  // en proceso / atención
  PENDIENTE: "warning",
  EN_TRANSITO: "warning",
  EN_PROCESO: "warning",
  PARCIAL: "warning",
  EN_PUERTO: "warning",
  EN_ADUANA: "warning",
  EN_ZONA_PRIMARIA: "warning",
  PROGRAMADA: "warning",
  EN_NEGOCIACION: "warning",
  // activos / vigentes
  EMITIDA: "info",
  EMITIDO: "info",
  ABIERTO: "info",
  ABIERTA: "info",
  ACTIVO: "info",
  ACTIVA: "info",
  DESPACHADO: "info",
  EN_DEPOSITO: "info",
  NUEVO: "info",
  NUEVA: "info",
  VIGENTE: "info",
  // borradores / neutros
  BORRADOR: "neutral",
};

function tonoDe(estado: string): Tono {
  return ESTADO_TONO[estado.toUpperCase()] ?? "neutral";
}

/**
 * Badge de estado con color semántico por token. Reemplaza los `estadoVariant`
 * ad-hoc dispersos por las tablas. Pasá `label` si querés un texto distinto al
 * enum (por defecto muestra el token con `_`→espacio).
 */
export function StatusBadge({
  estado,
  label,
  className,
}: {
  estado: string;
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(TONO_CLASS[tonoDe(estado)], className)}>
      {label ?? estado.replace(/_/g, " ")}
    </Badge>
  );
}
