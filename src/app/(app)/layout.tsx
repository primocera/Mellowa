import { requireUser } from "@/lib/auth/get-current-user";
import { AppNav } from "@/components/layout/app-nav";
import { TrialBanner } from "@/components/dailyflow/trial-banner";
import { ConsentCheckpoint } from "@/components/dailyflow/consent-checkpoint";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <AppNav />
      <main className="px-4 pb-24 pt-6 md:ml-56 md:px-8 md:pb-8">
        <div className="mx-auto max-w-3xl">
          <TrialBanner userId={user.id} />
          <ConsentCheckpoint />
          {children}
        </div>
      </main>
    </div>
  );
}
