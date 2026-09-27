import Link from "next/link";

const LINKS = [{ href: "/", label: "golden set" }];

export function Nav() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="font-mono text-sm tracking-tight text-text">
            tickertape
          </span>
        </Link>
        <nav className="flex gap-6 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-text-muted transition-colors hover:text-text"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
