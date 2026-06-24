import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
 * StatusBadge — combina o mapa semântico `estado → tono` consumido pelas tabelas
 * e fichas do domínio (Venta/Compra/Embarque/Asiento/Periodo/…) com os tokens de
 * status do PR-001 Design Foundation (globals.css). Tons canônicos
 * (04_DESIGN_SYSTEM): neutral · process · info · warning · success · danger.
 * Renderização: fundo tonal sutil + texto na cor do tom + borda discreta (NetSuite).
 * Tokens desconhecidos caen en `neutral` (seguro).
 */
type Tono = "neutral" | "process" | "info" | "success" | "warning" | "danger";

const TONO_CLASS: Record<Tono, string> = {
  neutral: "bg-muted text-muted-foreground border-border/60",
  process: "bg-process/12 text-process border-process/25",
  info: "bg-info/12 text-info border-info/25",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
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
