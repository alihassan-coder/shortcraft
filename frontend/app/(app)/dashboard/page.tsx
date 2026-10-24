import type { Metadata } from "next";
import { Dashboard } from "@/components/app/dashboard";

export const metadata: Metadata = { title: "Projects" };

export default function DashboardPage() {
  return <Dashboard />;
}
