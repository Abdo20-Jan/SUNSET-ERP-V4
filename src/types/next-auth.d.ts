import type { DefaultSession } from "next-auth";
import type { Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    id: string;
    username: string;
    nombre: string;
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      nombre: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    nombre: string;
    role: Role;
  }
}
