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
  }

  interface Session {
    user: {
      id: string;
      username: string;
      nombre: string;
      role: Role;
      monedaPreferida: Moneda | null;
      modoRetroactivo: boolean;
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
  }
}
