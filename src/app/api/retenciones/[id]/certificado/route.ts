import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { generarCertificadoRetencionPDF } from "@/lib/services/certificado-retencion";

export const dynamic = "force-dynamic";

// GET /api/retenciones/[id]/certificado → PDF del certificado de retención
// Ganancias (RG 830). Se regenera on-demand desde el registro inmutable.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) {
    return new NextResponse("No autorizado.", { status: 401 });
  }

  const { id } = await params;
  const cert = await generarCertificadoRetencionPDF(id);
  if (!cert) {
    return new NextResponse("Retención no encontrada.", { status: 404 });
  }

  const filename = `certificado-retencion-${cert.certificadoNumero}.pdf`;
  return new NextResponse(Buffer.from(cert.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
