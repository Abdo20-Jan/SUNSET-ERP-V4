import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 p-6">
      {children}
    </main>
  );
}
