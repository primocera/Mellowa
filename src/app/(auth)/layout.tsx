export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAF7F2] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
            Mellowa
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            A realistic wellbeing plan for the day you actually have.
          </p>
        </div>
        {/* MW-V10-07: a main landmark on the auth pages too. */}
        <main id="main" className="rounded-2xl bg-white p-8 shadow-sm">
          {children}
        </main>
      </div>
    </div>
  );
}
