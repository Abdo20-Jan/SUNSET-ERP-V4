import type { DefaultSession } from "next-auth";
import type { Moneda, Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    id: string;
    username: string;
    nombre: string;
    role: Role;
    monedaPreferida: Moneda | null;
    modoRetroactivo: boolean;
    // RBAC (PR-006): conveniencia FE. Opcionales: tokens/sesiones previas a
    // este PR no los traen, y el BE nunca depende de ellos (revalida en DB).
    permisos?: string[];
    perfilCodigo?: string;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      nombre: string;
      role: Role;
      monedaPreferida: Moneda | null;
      modoRetroactivo: boolean;
      permisos?: string[];
      perfilCodigo?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    nombre: string;
    role: Role;
    monedaPreferida: Moneda | null;
    modoRetroactivo: boolean;
    permisos?: string[];
    perfilCodigo?: string;
  }
}
