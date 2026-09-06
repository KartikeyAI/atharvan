import { createFileRoute } from "@tanstack/react-router";
import { OperatorShell } from "@/components/operator-shell";
import { OperatorSessionsPanel } from "@/components/operator-sessions";

export const Route = createFileRoute("/_authenticated/security")({
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <OperatorShell title="Security">
      <OperatorSessionsPanel />
    </OperatorShell>
  );
}
