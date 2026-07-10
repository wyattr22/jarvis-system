"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/markets",       label: "MARKETS",       group: "market" },
  { href: "/memories",      label: "MEMORY",        group: "market" },
  { href: "/charts",        label: "CHARTS",        group: "market" },
  { href: "/portfolio",     label: "PORTFOLIO",     group: "market" },
  { href: "/performance",   label: "PERFORMANCE",   group: "market" },
  { href: "/news",          label: "NEWS",          group: "market" },
  { href: "/watchlist",     label: "WATCHLIST",     group: "market" },
  { href: "/bot",           label: "BOT",           group: "execution" },
  { href: "/backtest",      label: "BACKTEST",      group: "execution" },
  { href: "/strategies",    label: "STRATEGIES",    group: "execution" },
  { href: "/features",      label: "FEATURES",      group: "execution" },
  { href: "/source-quality",label: "SOURCES",       group: "execution" },
  { href: "/opportunities", label: "OPPORTUNITIES", group: "execution" },
  { href: "/allocator",     label: "ALLOCATOR",     group: "execution" },
  { href: "/allocations",   label: "ALLOCATIONS",   group: "execution" },
  { href: "/risk-config",   label: "RISK CONFIG",   group: "execution" },
  { href: "/mcp-clients",   label: "MCP CLIENTS",   group: "execution" },
  { href: "/system-status", label: "STATUS",        group: "execution" },
  { href: "/proposals",     label: "PROPOSALS",     group: "council" },
  { href: "/experiments",   label: "EXPERIMENTS",   group: "council" },
  { href: "/council",       label: "COUNCIL",       group: "council" },
  { href: "/meta-decisions",label: "META",          group: "council" },
  { href: "/agent-log",     label: "AUDIT LOG",     group: "council" },
] as const

const GROUP_LABELS: Record<string, string> = {
  market: "MARKET",
  execution: "EXECUTION",
  council: "COUNCIL",
}

export function Sidebar() {
  const path = usePathname()
  const groups = ["market", "execution", "council"]

  return (
    <aside
      className="flex flex-col h-full border-r"
      style={{ width: "var(--sidebar-width)", minWidth: "var(--sidebar-width)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b">
        <span className="text-primary font-bold tracking-[0.2em] text-sm">JARVIS</span>
        <span className="text-muted-foreground text-xs tracking-widest">v2</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4">
        {groups.map((group, gi) => (
          <div key={group} className={gi > 0 ? "mt-4 pt-4 border-t border-border/60" : ""}>
            <p className="px-4 mb-1.5 text-[10px] font-medium tracking-[0.15em] text-muted-foreground/80">
              {GROUP_LABELS[group]}
            </p>
            {NAV.filter((n) => n.group === group).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={path === item.href ? "page" : undefined}
                className={cn(
                  "flex items-center px-4 py-2 text-xs tracking-[0.1em] transition-colors",
                  path === item.href || path.startsWith(item.href + "/")
                    ? "text-primary border-l-2 border-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50 border-l-2 border-transparent"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* System status */}
      <div className="border-t px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] text-muted-foreground tracking-widest">PAPER</span>
        </div>
      </div>
    </aside>
  )
}
