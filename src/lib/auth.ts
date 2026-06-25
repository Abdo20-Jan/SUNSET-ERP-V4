import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { resolvePermisosParaToken } from "@/lib/permisos-resolver";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Usuario", type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // `select` explícito previne vazamento de colunas novas para o session
        // token quando o schema User ganhar campos (princípio de menor surpresa).
        const user = await db.user.findUnique({
          where: { username: parsed.data.username },
          select: {
            id: true,
            username: true,
            nombre: true,
            role: true,
            activo: true,
            passwordHash: true,
            monedaPreferida: true,
            modoRetroactivo: true,
          },
        });
        if (!user?.activo) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        // RBAC (PR-006): resuelve el set de permisos para grabarlo en el JWT
        // (conveniencia FE). Flag-gated y a prueba de fallos: con la flag OFF
        // devuelve undefined y nunca lanza, así que el login no se ve afectado.
        const rbac = await resolvePermisosParaToken(user.id);

        return {
          id: user.id,
          username: user.username,
          nombre: user.nombre,
          role: user.role,
          monedaPreferida: user.monedaPreferida,
          modoRetroactivo: user.modoRetroactivo,
          permisos: rbac?.permisos,
          perfilCodigo: rbac?.perfilCodigo,
        };
      },
    }),
  ],
});
