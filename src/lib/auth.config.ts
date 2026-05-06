import type { NextAuthConfig, Session } from "next-auth";

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL("/dashboard", nextUrl));
        return true;
      }
      return isLoggedIn;
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.nombre = user.nombre;
        token.role = user.role;
        token.monedaPreferida = user.monedaPreferida;
        token.modoRetroactivo = user.modoRetroactivo;
      }
      if (trigger === "update" && session?.user?.monedaPreferida !== undefined) {
        token.monedaPreferida = session.user.monedaPreferida as Session["user"]["monedaPreferida"];
      }
      if (trigger === "update" && session?.user?.modoRetroactivo !== undefined) {
        token.modoRetroactivo = session.user.modoRetroactivo as Session["user"]["modoRetroactivo"];
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.username = token.username as string;
      session.user.nombre = token.nombre as string;
      session.user.role = token.role as Session["user"]["role"];
      session.user.monedaPreferida = token.monedaPreferida as Session["user"]["monedaPreferida"];
      session.user.modoRetroactivo = token.modoRetroactivo as Session["user"]["modoRetroactivo"];
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
