import "server-only";

// Identidad fiscal de la empresa, usada en documentos oficiales (certificados
// de retención RG 830, etc.). La razón social tiene default; CUIT y domicilio
// se configuran por env (datos sensibles/variables) — completarlos antes de
// emitir certificados a proveedores.
export const EMPRESA = {
  razonSocial: process.env.EMPRESA_RAZON_SOCIAL || "SUNSET TIRES CORPORATION SAS",
  cuit: process.env.EMPRESA_CUIT || "",
  domicilio: process.env.EMPRESA_DOMICILIO || "",
} as const;
