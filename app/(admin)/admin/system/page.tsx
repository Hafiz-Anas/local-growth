import type { Metadata } from "next";
import { SystemView } from "@/components/admin/system-view";

export const metadata: Metadata = { title: "Admin · System" };

export default function AdminSystemPage() {
  return <SystemView />;
}
