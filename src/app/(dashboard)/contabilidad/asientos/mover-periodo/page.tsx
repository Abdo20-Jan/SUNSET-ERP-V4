import { db } from "@/lib/db";
import { AsientoEstado, PeriodoEstado, Prisma } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";

import { MoverPeriodoForm, type AsientoRow, type PeriodoOption } from "./mover-form";
import { MoverPeriodoFilters } from "./mover-filters";

const ESTADO_VALUES = new Set<AsientoEstado>([AsientoEstado.BORRADOR, AsientoEstado.CONTABILIZADO]);

function parseEstado(value: string | undefined): AsientoEstado | null {
  if (!value) return null;
  return ESTADO_VALUES.has(value as AsientoEstado) ? (value as AsientoEstado) : null;
}

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type SearchParams = Promise<{
  periodoOrigenId?: string;
  estado?: string;
  q?: string;
}>;

const asientoSelect = {
  id: true,
  numero: true,
  fecha: true,
  descripcion: true,
  estado: true,
  origen: true,
  moneda: true,
  totalDebe: true,
  periodo: { select: { codigo: true } },
  movimiento: {
    select: {
      tipo: true,
      comprobante: true,
      referenciaBanco: true,
      descripcion: true,
      cuentaBancaria: { select: { alias: true, banco: true } },
    },
  },
  compra: {
    select: { numero: true, proveedor: { select: { nombre: true } } },
  },
  venta: {
    select: { numero: true, cliente: { select: { nombre: true } } },
  },
  gasto: {
    select: {
      numero: true,
      facturaNumero: true,
      proveedor: { select: { nombre: true } },
    },
  },
  embarqueCierre: {
    select: { codigo: true, proveedor: { select: { nombre: true } } },
  },
  embarqueZonaPrimaria: {
    select: { codigo: true, proveedor: { select: { nombre: true } } },
  },
  embarqueCosto: {
    select: {
      embarque: { select: { codigo: true } },
      proveedor: { select: { nombre: true } },
    },
  },
  despacho: {
    select: { codigo: true, embarque: { select: { codigo: true } } },
  },
  prestamo: { select: { prestamista: true } },
  chequeRecibidoCobro: { select: { numero: true, banco: true } },
  entregaVenta: {
    select: { numero: true, venta: { select: { cliente: { select: { nombre: true } } } } },
  },
  gastoFijoRegistro: {
    select: { gastoFijo: { select: { descripcion: true } } },
  },
} satisfies Prisma.AsientoSelect;

type AsientoConRelaciones = Prisma.AsientoGetPayload<{ select: typeof asientoSelect }>;

function buildContexto(a: AsientoConRelaciones): { etiqueta: string; lineas: string[] } {
  if (a.movimiento) {
    const m = a.movimiento;
    const banco = m.cuentaBancaria.alias || m.cuentaBancaria.banco;
    const lineas: string[] = [banco];
    if (m.comprobante) lineas.push(`Comp ${m.comprobante}`);
    if (m.referenciaBanco) lineas.push(`Ref ${m.referenciaBanco}`);
    if (m.descripcion) lineas.push(m.descripcion);
    return { etiqueta: m.tipo, lineas };
  }
  if (a.compra) {
    return {
      etiqueta: "Compra",
      lineas: [`FAC ${a.compra.numero}`, a.compra.proveedor.nombre],
    };
  }
  if (a.venta) {
    return {
      etiqueta: "Venta",
      lineas: [`FAC ${a.venta.numero}`, a.venta.cliente.nombre],
    };
  }
  if (a.gasto) {
    const lineas: string[] = [`G-${a.gasto.numero}`];
    if (a.gasto.facturaNumero) lineas.push(`Fact ${a.gasto.facturaNumero}`);
    lineas.push(a.gasto.proveedor.nombre);
    return { etiqueta: "Gasto", lineas };
  }
  if (a.embarqueZonaPrimaria) {
    return {
      etiqueta: "Zona Primaria",
      lineas: [a.embarqueZonaPrimaria.codigo, a.embarqueZonaPrimaria.proveedor.nombre],
    };
  }
  if (a.embarqueCierre) {
    return {
      etiqueta: "Embarque",
      lineas: [a.embarqueCierre.codigo, a.embarqueCierre.proveedor.nombre],
    };
  }
  if (a.embarqueCosto) {
    return {
      etiqueta: "Costo embarque",
      lineas: [a.embarqueCosto.embarque.codigo, a.embarqueCosto.proveedor.nombre],
    };
  }
  if (a.despacho) {
    return {
      etiqueta: "Despacho",
      lineas: [a.despacho.codigo, `Embarque ${a.despacho.embarque.codigo}`],
    };
  }
  if (a.prestamo) {
    return { etiqueta: "Préstamo", lineas: [a.prestamo.prestamista] };
  }
  if (a.chequeRecibidoCobro) {
    const lineas = [`Cheq ${a.chequeRecibidoCobro.numero}`];
    if (a.chequeRecibidoCobro.banco) lineas.push(a.chequeRecibidoCobro.banco);
    return { etiqueta: "Cheque", lineas };
  }
  if (a.entregaVenta) {
    return {
      etiqueta: "Entrega",
      lineas: [a.entregaVenta.numero, a.entregaVenta.venta.cliente.nombre],
    };
  }
  if (a.gastoFijoRegistro) {
    return {
      etiqueta: "Gasto fijo",
      lineas: [a.gastoFijoRegistro.gastoFijo.descripcion],
    };
  }
  return { etiqueta: "", lineas: [] };
}

export default async function MoverPeriodoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const periodoOrigenId = parsePeriodoId(params.periodoOrigenId);
  const estadoFilter = parseEstado(params.estado);
  const qFilter = params.q?.trim() ?? "";

  const periodos = await db.periodoContable.findMany({
    orderBy: { fechaInicio: "desc" },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      estado: true,
      fechaInicio: true,
      fechaFin: true,
    },
  });

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    estado: p.estado,
  }));

  let rows: AsientoRow[] = [];
  let origenCerrado = false;
  let origenInfo: { codigo: string; nombre: string } | null = null;

  if (periodoOrigenId) {
    const origen = periodos.find((p) => p.id === periodoOrigenId);
    if (origen) {
      origenCerrado = origen.estado === PeriodoEstado.CERRADO;
      origenInfo = { codigo: origen.codigo, nombre: origen.nombre };
    }

    const where: Prisma.AsientoWhereInput = {
      periodoId: periodoOrigenId,
      estado: { not: AsientoEstado.ANULADO },
    };
    if (estadoFilter) where.estado = estadoFilter;
    if (qFilter.length > 0) {
      where.descripcion = { contains: qFilter, mode: "insensitive" };
    }

    const asientos = await db.asiento.findMany({
      where,
      orderBy: [{ fecha: "asc" }, { numero: "asc" }],
      select: asientoSelect,
    });

    rows = asientos.map((a) => ({
      id: a.id,
      numero: a.numero,
      fecha: a.fecha,
      descripcion: a.descripcion,
      estado: a.estado,
      origen: a.origen,
      moneda: a.moneda,
      totalDebe: a.totalDebe.toFixed(2),
      periodoCodigo: a.periodo.codigo,
      contexto: buildContexto(a),
    }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Mover asientos de período</h1>
        <p className="text-sm text-muted-foreground">
          Remapeá asientos al período contable correcto sin alterar la fecha. Útil para entradas
          retroactivas.
        </p>
      </div>

      <MoverPeriodoFilters
        periodos={periodoOptions}
        selectedPeriodoOrigenId={periodoOrigenId ?? null}
        selectedEstado={estadoFilter ?? "all"}
        query={qFilter}
      />

      {periodoOrigenId === null ? (
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
          Seleccioná un período origen para listar sus asientos.
        </Card>
      ) : origenCerrado ? (
        <Card className="border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El período origen <span className="font-mono">{origenInfo?.codigo}</span> está{" "}
          <strong>CERRADO</strong>. Reabrilo en{" "}
          <a href="/contabilidad/periodos" className="underline">
            /contabilidad/periodos
          </a>{" "}
          antes de mover.
        </Card>
      ) : rows.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
          No hay asientos no anulados en el período {origenInfo?.codigo} con los filtros aplicados.
        </Card>
      ) : (
        <MoverPeriodoForm
          key={`${periodoOrigenId}|${estadoFilter ?? ""}|${qFilter}`}
          asientos={rows}
          periodos={periodoOptions}
          periodoOrigenId={periodoOrigenId}
        />
      )}
    </div>
  );
}
