import { Toaster } from "sonner";
import { AppHeader } from "@/components/app/app-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="flex flex-1 flex-col">{children}</main>
      <Toaster
        theme="light"
        position="bottom-center"
        toastOptions={{ classNames: { toast: "!rounded-[12px] !border-line !text-[14px] !font-sans" } }}
      />
    </>
  );
}
