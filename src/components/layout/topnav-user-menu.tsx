"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon } from "@hugeicons/core-free-icons";

import { logout } from "@/lib/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NavCenter } from "@/components/layout/nav-config";

function getInitials(nombre: string) {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function TopnavUserMenu({
  user,
  config,
}: {
  user: { nombre: string; username: string; role: string };
  config: NavCenter;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Configuración y perfil"
      >
        <Avatar className="size-7 rounded-md">
          <AvatarFallback className="rounded-md text-[11px]">
            {getInitials(user.nombre) || "??"}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56 rounded-lg">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
            <Avatar className="size-8 rounded-md">
              <AvatarFallback className="rounded-md text-xs">
                {getInitials(user.nombre) || "??"}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 leading-tight">
              <span className="truncate font-medium">{user.nombre}</span>
              <span className="truncate text-xs text-muted-foreground">{user.role}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {config.sections.map((section) => (
          <DropdownMenuGroup key={section.label}>
            {section.items.map((item) => (
              <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>
                <HugeiconsIcon icon={item.icon} />
                {item.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        ))}
        <form action={logout}>
          <DropdownMenuItem render={<button type="submit" className="w-full cursor-pointer" />}>
            <HugeiconsIcon icon={Logout01Icon} />
            Cerrar sesión
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
