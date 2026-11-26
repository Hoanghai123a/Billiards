import type { ReactNode } from "react";

export default function PinnedPageHeader({ children, className }: { children: ReactNode; className: string }) {
  return <div className="h-[92px] shrink-0">
    <header className={`fixed inset-x-0 top-0 z-30 ${className}`}>{children}</header>
  </div>;
}
