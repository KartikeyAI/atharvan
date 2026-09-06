import { createFileRoute } from "@tanstack/react-router";
import { OperatorShell } from "@/components/operator-shell";
import { PlatformOverviewPanel } from "@/components/platform-overview";
import { usePlatformOverview } from "@/lib/use-platform-overview";

export const Route = createFileRoute("/_authenticated/")({
  component: PlatformOverview,
});

function PlatformOverview() {
  const overview = usePlatformOverview();
  return (
    <OperatorShell title="Overview">
      <PlatformOverviewPanel {...overview} />
    </OperatorShell>
  );
}
