import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";

// PR 3.5 — handler de client upload (Vercel Blob) para las evidencias de la
// investigación de divergencia (fotos, documentos, grabación de descarga).
// El client llama `upload(...)` de @vercel/blob/client con
// handleUploadUrl="/api/comex/divergencia/upload"; este handler genera el
// token de subida tras validar flag + auth. Blobs públicos con sufijo
// aleatorio (URL no adivinhable, no listable). Requiere BLOB_READ_WRITE_TOKEN.

const CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB (cubre la grabación de descarga)

export async function POST(request: Request): Promise<NextResponse> {
  // La feature está detrás de flag — no exponer el endpoint con la flag OFF.
  if (!isContenedorDesconsolidacionEnabled()) {
    return NextResponse.json({ error: "Función no habilitada." }, { status: 404 });
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const session = await auth();
        if (!session) {
          throw new Error("No autorizado.");
        }
        return {
          allowedContentTypes: CONTENT_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_BYTES,
        };
      },
      // Las URLs se persisten vía registrarConferenciaAction tras el upload;
      // este callback no dispara en localhost (requiere túnel público).
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error de subida." },
      { status: 400 },
    );
  }
}
