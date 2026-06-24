"use client";

/**
 * Menu de usuário do header do top-nav (PR-002 Global Shell).
 *
 * Equivale ao `user-menu.tsx` do sidebar, mas **sem** depender do contexto de
 * sidebar (`useSidebar`/`SidebarMenuButton`) — porque o modo top-nav não monta
 * o `SidebarProvider`. Avatar + Perfil + Cerrar sesión (mesma `logout` action).
 */

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon, UserCircleIcon } from "@hugeicons/core-free-icons";

import { logout } from "@/lib/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ShellUserMenuProps = {
  user: { nombre: string; username: string; role: string };
};

function getInitials(nombre: string) {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ShellUserMenu({ user }: ShellUserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-accent/60 data-[popup-open]:bg-accent"
        aria-label="Menú de usuario"
      >
        <Avatar className="size-7 rounded-md">
          <AvatarFallback className="rounded-md text-xs">
            {getInitials(user.nombre) || "??"}
          </AvatarFallback>
        </Avatar>
        <span className="hidden min-w-0 flex-col leading-tight lg:flex">
          <span className="truncate text-[12px] font-medium">{user.nombre}</span>
          <span className="truncate text-[10px] text-muted-foreground">@{user.username}</span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium text-foreground">{user.nombre}</span>
            <span className="truncate text-xs text-muted-foreground">{user.role}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/perfil" />}>
          <HugeiconsIcon icon={UserCircleIcon} strokeWidth={2} />
          Mi perfil
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logout}>
          <DropdownMenuItem
            variant="destructive"
            render={<button type="submit" className="w-full cursor-pointer" />}
          >
            <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />
            Cerrar sesión
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
