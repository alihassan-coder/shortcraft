import type { Metadata } from "next";
import { NewProjectFlow } from "@/components/app/new-project-flow";

export const metadata: Metadata = { title: "New video" };

export default function NewProjectPage() {
  return <NewProjectFlow />;
}
