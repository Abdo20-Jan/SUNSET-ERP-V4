import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { EXPORT_REGISTRY } from "@/lib/export/registry";

export const dynamic = "force-dynamic";

// GET /api/export/[recurso]?<filtros de la lista>
// Exporta a CSV el set FILTRADO (q, marca/estado/pais, sort, dir) sin paginar.
// El CSV lleva BOM → Excel lo abre con columnas y acentos correctos.
export async function GET(req: Request, { params }: { params: Promise<{ recurso: string }> }) {
  const session = await auth();
  if (!session) {
    return new NextResponse("No autorizado.", { status: 401 });
  }

  const { recurso } = await params;
  const res = EXPORT_REGISTRY[recurso];
  if (!res) {
    return new NextResponse("Recurso no encontrado.", { status: 404 });
  }

  const sp = new URL(req.url).searchParams;
  const csv = await res.buildCsv(sp);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${res.filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
