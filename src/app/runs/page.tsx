import Link from "next/link";
import { listRuns } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await listRuns();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium text-text">Runs</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Every analysis, from eval batches over the golden set and from live
          lookups. Golden-set runs are graded against the SEC&apos;s figures;
          live runs are checked only by reconciliation, since there&apos;s no
          answer key for an arbitrary filing until it&apos;s in the golden set.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-text-faint">
            <tr>
              <th className="px-4 py-2 font-normal">ticker</th>
              <th className="px-4 py-2 font-normal">period</th>
              <th className="px-4 py-2 font-normal">source</th>
              <th className="px-4 py-2 text-right font-normal">graded</th>
              <th className="px-4 py-2 text-right font-normal">checks</th>
              <th className="px-4 py-2 text-right font-normal">cost</th>
              <th className="px-4 py-2 text-right font-normal">time</th>
              <th className="px-4 py-2 font-normal">model</th>
              <th className="px-4 py-2 font-normal">when</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-border-soft hover:bg-surface">
                <td className="px-4 py-2">
                  <Link href={`/runs/${r.id}`} className="font-mono text-accent hover:underline">
                    {r.ticker}
                  </Link>
                  {r.status !== "completed" ? (
                    <span className="ml-2 text-xs text-escalate">{r.status}</span>
                  ) : null}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-text-muted">{r.periodEnd}</td>
                <td className="px-4 py-2 text-xs text-text-muted">
                  {r.source === "golden_set" ? "eval" : "live"}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono ${r.graded === null ? "text-text-faint" : r.correct === r.graded ? "text-text" : "text-review"}`}
                >
                  {r.graded === null ? "-" : `${r.correct}/${r.graded}`}
                </td>
                <td className="px-4 py-2 text-right font-mono text-text-muted">
                  {r.checksTotal ? `${r.checksPassed}/${r.checksTotal}` : "-"}
                  {r.retryCount > 0 ? <span className="ml-1 text-review">↻</span> : null}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                  ${r.costUsd.toFixed(4)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                  {(r.latencyMs / 1000).toFixed(1)}s
                </td>
                <td className="px-4 py-2 font-mono text-xs text-text-faint">
                  {r.model} · {r.promptVersion}
                </td>
                <td className="px-4 py-2 text-xs text-text-faint">
                  {new Date(r.startedAt).toISOString().slice(0, 16).replace("T", " ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
