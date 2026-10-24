import { Suspense } from "react";
import type { Metadata } from "next";
import { EditorShell } from "@/components/editor/editor-shell";

export const metadata: Metadata = { title: "Editor" };

// Only the demo project exists until projects come from the backend.
export function generateStaticParams() {
  return [{ projectId: "demo" }];
}

async function EditorForProject({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <EditorShell projectId={projectId} />;
}

export default function EditorPage(props: PageProps<"/editor/[projectId]">) {
  return (
    <Suspense fallback={<div className="h-dvh bg-white" />}>
      <EditorForProject params={props.params} />
    </Suspense>
  );
}
