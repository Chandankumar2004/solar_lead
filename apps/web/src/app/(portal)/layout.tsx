import { PortalShell } from "@/components/admin/PortalShell";

export default function PortalLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return <PortalShell>{children}</PortalShell>;
}
