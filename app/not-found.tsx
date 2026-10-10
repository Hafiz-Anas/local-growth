import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NotAvailable } from "@/components/shared/not-available";

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <header className="flex h-(--topbar-height) items-center border-b border-border px-4 md:px-8">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <NotAvailable />
    </div>
  );
}
