import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { EXPORT_REGISTRY } from "@/lib/export/registry";

export const dynamic = "force-dynamic";

// GET /api/export/[recurso]?formato=csv|xlsx&<filtros de la lista>
// Exporta el set FILTRADO (q, marca/estado/pais, sort, dir) sin paginar.
// formato=xlsx → workbook (header en negrita); cualquier otro valor → CSV
// (con BOM → Excel lo abre con columnas y acentos correctos).
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

  if (sp.get("formato") === "xlsx") {
    const buf = await res.buildXlsx(sp);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${res.filename}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const csv = await res.buildCsv(sp);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${res.filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
