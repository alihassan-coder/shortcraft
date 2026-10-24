import { Suspense } from "react";
import type { Metadata } from "next";
import { ProcessingView } from "@/components/app/processing-view";

export const metadata: Metadata = { title: "Editing your video" };

async function ProcessingForProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProcessingView projectId={id} />;
}

export default function ProcessingPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[680px] px-5 py-16 sm:px-8" />}>
      <ProcessingForProject params={props.params} />
    </Suspense>
  );
}
