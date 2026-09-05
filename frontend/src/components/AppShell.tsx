"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Overview", icon: "▦" },
  { href: "/domains", label: "Domains", icon: "◈" },
  { href: "/leads", label: "Leads", icon: "☰" },
  { href: "/campaigns", label: "Campaigns", icon: "◎" },
  { href: "/messages", label: "Messages", icon: "✉" },
  { href: "/runs", label: "Runs", icon: "▶" },
  { href: "/automations", label: "Automations", icon: "⚙" },
  { href: "/settings", label: "Settings", icon: "☰" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-ink-700 bg-ink-900 flex flex-col fixed h-screen">
        <div className="px-5 py-5 border-b border-ink-700">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-accent-strong text-ink-950 grid place-items-center font-black">
              M
            </span>
            <div>
              <div className="font-bold text-ink-100 leading-tight">Miya Pipeline</div>
              <div className="text-[11px] text-ink-400">stats.miyagroupbd.com</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-ink-800 text-ink-100 font-semibold"
                    : "text-ink-400 hover:text-ink-100 hover:bg-ink-850"
                }`}
              >
                <span className="w-4 text-center opacity-80">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-ink-700">
          <div className="px-3 py-2 text-xs text-ink-400 truncate">{user?.email}</div>
          <button
            onClick={logout}
            className="w-full btn btn-ghost justify-start text-sm mt-1"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 ml-60 p-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
