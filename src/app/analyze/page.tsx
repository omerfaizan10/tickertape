import { AnalyzeForm } from "./analyze-form";

export default function AnalyzePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium text-text">Analyze a 10-K</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Enter any US-listed company&apos;s ticker. Tickertape pulls its latest
          10-K straight from the SEC, finds the three financial statements, and
          has three agents read them in parallel. Every figure comes back with
          the exact statement row it was read from, and code checks that the
          figures add up before anything is shown.
        </p>
      </div>
      <AnalyzeForm />
    </div>
  );
}
