// Resolver de drill-down de la worklist de auditoría (AUD-01). Mapea el par
// (tabla, registroId) de un AuditLog a la ruta de la ficha del registro
// auditado. PURO y client-safe (sin I/O, sin `server-only`): lo consume el
// mapper server-side y es trivialmente testeable.
//
// `switch/case` explícito por tabla auditable (NO acceso dinámico por clave a un
// objeto ni invocación de funciones obtenidas dinámicamente). Las tablas listadas
// SON los strings reales que escribe `registrarAuditoria`. Tablas sin ficha por-id
// (o no auditadas hoy) caen al `default` → null: la celda Registro se dibuja como
// texto plano, nunca apunta a una ruta inexistente.

/** Ruta de la ficha del registro auditado, o null si la tabla no tiene ficha. */
export function resolverRutaAuditada(tabla: string, registroId: string): string | null {
  switch (tabla) {
    case "Cliente":
      return `/maestros/clientes/${registroId}`;
    case "Proveedor":
      return `/maestros/proveedores/${registroId}`;
    case "Deposito":
      return `/maestros/depositos/${registroId}`;
    case "Venta":
      return `/ventas/${registroId}`;
    // La tabla de usuarios se audita como "User" (no "Usuario").
    case "User":
      return `/sistema/usuarios/${registroId}`;
    // Future-proof: la ruta existe; hoy ningún audit escribe estas tablas, así
    // que el case queda dormido hasta que esas mutaciones empiecen a auditar.
    case "Compra":
      return `/compras/${registroId}`;
    case "Asiento":
      return `/contabilidad/asientos/${registroId}`;
    // Producto se omite a propósito: /maestros/productos NO tiene ruta [id]
    // (se edita por diálogo) → texto plano. Igual: Perfil, UsuarioPermiso,
    // RetencionPracticada, AuditLog (meta-evento de export).
    default:
      return null;
  }
}
