import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";

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
        if (!user || !user.activo) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          username: user.username,
          nombre: user.nombre,
          role: user.role,
          monedaPreferida: user.monedaPreferida,
          modoRetroactivo: user.modoRetroactivo,
        };
      },
    }),
  ],
});
