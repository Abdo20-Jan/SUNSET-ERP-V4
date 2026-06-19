import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getBalanceGeneralByFecha } from "@/lib/services/reportes";
import { generarBalanceBPExcel } from "@/lib/services/reportes/export/balance-bp-excel";
import { construirModeloBP } from "@/lib/services/reportes/export/balance-bp-modelo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | null): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function endOfDay(value: string): Date | undefined {
  if (!DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// GET /api/reportes/balance-general/export?desde&hasta&moneda
// → .xlsx do Balanço Patrimonial no formato artesanal (USD + ARS ao TC cierre).
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session) {
    return new NextResponse("No autorizado.", { status: 401 });
  }

  const url = new URL(req.url);
  const desdeStr = url.searchParams.get("desde");
  const hastaStr = url.searchParams.get("hasta") ?? new Date().toISOString().slice(0, 10);

  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);
  const fecha = DATE_RE.test(hastaStr) ? hastaStr : new Date().toISOString().slice(0, 10);

  const [bg, cotizacion] = await Promise.all([
    getBalanceGeneralByFecha({ fechaDesde, fechaHasta }),
    getCotizacionParaFecha(fechaHasta ?? new Date()),
  ]);
  const tc = cotizacion ? cotizacion.valor.toString() : null;

  const modelo = construirModeloBP(bg, { tc, fecha });
  const bytes = await generarBalanceBPExcel(modelo);

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="balance-general-${fecha}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
