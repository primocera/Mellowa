import { requireUser } from "@/lib/auth/get-current-user";
import { AppNav } from "@/components/layout/app-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <AppNav />
      <main className="px-4 pb-24 pt-6 md:ml-56 md:px-8 md:pb-8">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
