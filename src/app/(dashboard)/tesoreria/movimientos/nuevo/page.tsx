import {
  listarCuentasBancariasParaMovimiento,
  listarCuentasContablesParaContrapartida,
} from "@/lib/actions/movimientos-tesoreria";
import { obtenerContextoAmortizacion } from "@/lib/actions/prestamos";

import { MovimientoForm, type MovimientoFormInitial } from "./movimiento-form";

type SearchParams = Promise<{
  tipo?: string;
  cuentaContableId?: string;
  descripcion?: string;
  comprobante?: string;
  prestamoId?: string;
  modo?: string;
}>;

function parseUuid(value: string | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export default async function NuevoMovimientoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [cuentasBancarias, cuentasContrapartida] = await Promise.all([
    listarCuentasBancariasParaMovimiento(),
    listarCuentasContablesParaContrapartida(),
  ]);

  const params = await searchParams;

  const prestamoId = parseUuid(params.prestamoId);
  const contexto = prestamoId
    ? await obtenerContextoAmortizacion(prestamoId)
    : null;

  const modoInicial: "amortizacion" | "intereses" =
    params.modo === "intereses" && contexto?.cuentaIntereses
      ? "intereses"
      : "amortizacion";

  const initial: MovimientoFormInitial = {};

  if (contexto) {
    initial.tipo = "PAGO";
    initial.cuentaContableId =
      modoInicial === "intereses" && contexto.cuentaIntereses
        ? contexto.cuentaIntereses.id
        : contexto.cuentaPrestamo.id;
    initial.descripcion =
      modoInicial === "intereses"
        ? `Intereses préstamo ${contexto.prestamo.prestamista}`
        : `Amortización préstamo ${contexto.prestamo.prestamista}`;
  } else {
    if (params.tipo === "COBRO" || params.tipo === "PAGO") {
      initial.tipo = params.tipo;
    }

    if (params.cuentaContableId) {
      const parsed = Number.parseInt(params.cuentaContableId, 10);
      if (
        Number.isFinite(parsed) &&
        parsed > 0 &&
        cuentasContrapartida.some((c) => c.id === parsed)
      ) {
        initial.cuentaContableId = parsed;
      }
    }

    if (params.descripcion) {
      initial.descripcion = params.descripcion.slice(0, 255);
    }
  }

  if (params.comprobante) {
    initial.comprobante = params.comprobante.slice(0, 100);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {contexto ? "Pago de préstamo" : "Nuevo movimiento de tesorería"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {contexto
            ? "Registre una amortización de capital o un pago de intereses. El sistema generará el asiento de partida doble y actualizará el saldo del préstamo."
            : "Registre una entrada (cobro) o salida (pago) de dinero. El sistema generará automáticamente el asiento contable de partida doble y lo contabilizará en el período correspondiente."}
        </p>
      </div>
      <MovimientoForm
        cuentasBancarias={cuentasBancarias}
        cuentasContrapartida={cuentasContrapartida}
        initial={initial}
        contextoAmortizacion={contexto}
        modoInicial={modoInicial}
      />
    </div>
  );
}
