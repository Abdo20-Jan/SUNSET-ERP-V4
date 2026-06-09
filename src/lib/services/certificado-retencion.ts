import "server-only";

import { PDFDocument, type PDFFont, StandardFonts, rgb } from "pdf-lib";

import { db } from "@/lib/db";
import { EMPRESA } from "@/lib/empresa";

// Genera el Certificado de Retención de Ganancias (RG 830) en PDF a partir del
// registro inmutable RetencionPracticada. Se regenera on-demand (no se
// persiste el binario) — la fuente de verdad es el registro contable. Devuelve
// null si la retención no existe.

const CONCEPTO_LABEL: Record<string, string> = {
  BIENES_DE_CAMBIO: "Bienes de cambio (mercadería)",
  HONORARIOS: "Honorarios profesionales",
  ALQUILERES: "Alquileres",
  SERVICIOS_GENERALES: "Servicios generales",
  LOCACIONES_SERVICIOS: "Locaciones de servicios",
};

const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE_ARCA: "Pendiente de depósito (ARCA)",
  PAGADA_ARCA: "Depositada en ARCA",
  ANULADA: "ANULADA",
};

const arsFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function ars(v: { toString(): string }): string {
  return `$ ${arsFmt.format(Number(v.toString()))}`;
}

function fecha(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

export type CertificadoRetencion = { pdf: Uint8Array; certificadoNumero: string };

export async function generarCertificadoRetencionPDF(
  retencionId: string,
): Promise<CertificadoRetencion | null> {
  const ret = await db.retencionPracticada.findUnique({
    where: { id: retencionId },
    select: {
      certificadoNumero: true,
      regimen: true,
      concepto: true,
      base: true,
      alicuota: true,
      importeRetenido: true,
      fechaRetencion: true,
      fechaVencimientoArca: true,
      estado: true,
      proveedor: { select: { nombre: true, cuit: true } },
      movimientoTesoreria: { select: { comprobante: true, fecha: true } },
    },
  });
  if (!ret) return null;

  const neto = (Number(ret.base.toString()) - Number(ret.importeRetenido.toString())).toFixed(2);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificado de Retención ${ret.certificadoNumero}`);
  const page = pdf.addPage([595.28, 841.89]); // A4 vertical
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const M = 56; // margen
  const W = 595.28;
  const ink = rgb(0.12, 0.12, 0.14);
  const muted = rgb(0.45, 0.45, 0.5);
  const line = rgb(0.8, 0.8, 0.83);

  let y = 841.89 - M;

  const text = (
    s: string,
    x: number,
    yy: number,
    opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {},
  ) => {
    page.drawText(s, {
      x,
      y: yy,
      size: opts.size ?? 10,
      font: opts.f ?? font,
      color: opts.color ?? ink,
    });
  };

  const hr = (yy: number) => {
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: W - M, y: yy },
      thickness: 0.75,
      color: line,
    });
  };

  // Encabezado — agente de retención (empresa)
  text(EMPRESA.razonSocial, M, y, { size: 13, f: bold });
  y -= 15;
  text(`CUIT: ${EMPRESA.cuit || "—"}`, M, y, { size: 9, color: muted });
  if (EMPRESA.domicilio) {
    y -= 12;
    text(EMPRESA.domicilio, M, y, { size: 9, color: muted });
  }
  y -= 22;
  hr(y);
  y -= 26;

  // Título
  text("CERTIFICADO DE RETENCIÓN", M, y, { size: 14, f: bold });
  y -= 16;
  text("Impuesto a las Ganancias — Régimen RG 830/AFIP-ARCA", M, y, { size: 10, color: muted });
  y -= 14;
  text(`Certificado N.º ${ret.certificadoNumero}  ·  Régimen ${ret.regimen}`, M, y, {
    size: 9,
    color: muted,
  });
  y -= 24;

  // Bloque sujeto retenido (proveedor)
  const labelW = 190;
  const row = (label: string, value: string, opts: { f?: PDFFont } = {}) => {
    text(label, M, y, { size: 9.5, color: muted });
    text(value, M + labelW, y, { size: 10.5, f: opts.f });
    y -= 18;
  };

  text("SUJETO RETENIDO", M, y, { size: 9, f: bold, color: muted });
  y -= 16;
  row("Razón social / Nombre", ret.proveedor.nombre);
  row("CUIT", ret.proveedor.cuit ?? "—");
  y -= 6;
  hr(y);
  y -= 22;

  text("DATOS DE LA RETENCIÓN", M, y, { size: 9, f: bold, color: muted });
  y -= 16;
  row("Concepto (RG 830)", CONCEPTO_LABEL[ret.concepto] ?? ret.concepto);
  row("Comprobante de pago", ret.movimientoTesoreria?.comprobante ?? "—");
  row("Fecha de pago / retención", fecha(ret.fechaRetencion));
  row("Base sujeta a retención", ars(ret.base));
  row("Alícuota aplicada", `${ret.alicuota.toString()} %`);
  row("Importe retenido", ars(ret.importeRetenido), { f: bold });
  row("Neto pagado al proveedor", ars(neto));
  row("Vencimiento depósito ARCA", fecha(ret.fechaVencimientoArca));
  row("Estado", ESTADO_LABEL[ret.estado] ?? ret.estado);

  y -= 8;
  hr(y);
  y -= 24;

  // Importe retenido destacado
  page.drawRectangle({
    x: M,
    y: y - 30,
    width: W - 2 * M,
    height: 42,
    color: rgb(0.97, 0.96, 0.9),
    borderColor: line,
    borderWidth: 0.75,
  });
  text("TOTAL RETENIDO", M + 14, y - 4, { size: 9, color: muted });
  text(
    ars(ret.importeRetenido),
    W - M - 14 - bold.widthOfTextAtSize(ars(ret.importeRetenido), 16),
    y - 8,
    {
      size: 16,
      f: bold,
    },
  );
  y -= 60;

  // Pie institucional
  const footer =
    "Este certificado se emite conforme al régimen de retención del Impuesto a las " +
    "Ganancias (RG 830). El importe retenido fue / será depositado a la AFIP-ARCA. " +
    "Documento generado por el sistema Sunset ERP.";
  const words = footer.split(" ");
  let lineStr = "";
  const maxW = W - 2 * M;
  for (const w of words) {
    const test = lineStr ? `${lineStr} ${w}` : w;
    if (font.widthOfTextAtSize(test, 8.5) > maxW) {
      text(lineStr, M, y, { size: 8.5, color: muted });
      y -= 12;
      lineStr = w;
    } else {
      lineStr = test;
    }
  }
  if (lineStr) text(lineStr, M, y, { size: 8.5, color: muted });

  const bytes = await pdf.save();
  return { pdf: bytes, certificadoNumero: ret.certificadoNumero };
}
