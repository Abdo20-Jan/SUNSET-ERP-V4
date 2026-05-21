import { NextResponse } from "next/server";

import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import { expirarBorradoresVencidos } from "@/lib/services/despacho-parcial";

// PR 4.6 — cron de limpieza de borradores de despacho cruzado vencidos.
// Vercel Cron invoca este endpoint (ver vercel.json) con el header
// `Authorization: Bearer ${CRON_SECRET}`. Expira los borradores cuyo TTL
// venció liberando los counters trabados (cantidadEnDespacho →
// cantidadDisponible), para que el stock no quede bloqueado indefinidamente.

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Auth: sólo Vercel Cron (o un caller con el secreto) puede dispararlo.
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // Flag apagada (prod): no-op. La ruta responde 200 para no marcar el cron
  // como fallido, pero no toca nada (el flujo de borradores está detrás de la
  // flag, así que no debería haber vencidos de todos modos).
  if (!isContenedorDesconsolidacionEnabled()) {
    return NextResponse.json({ ok: true, cleaned: 0, skipped: "flag off" });
  }

  const { cleaned, fallidos } = await expirarBorradoresVencidos();
  return NextResponse.json({ ok: true, cleaned, fallidos });
}
