export const UI_NAV_COOKIE = "ui_nav";
export type NavVariant = "topnav" | "sidebar";

export function resolveNavVariant(cookieValue: string | undefined): NavVariant {
  return cookieValue === "topnav" ? "topnav" : "sidebar";
}
