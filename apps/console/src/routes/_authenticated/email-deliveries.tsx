import { createFileRoute } from "@tanstack/react-router";
import { OperatorShell } from "@/components/operator-shell";
import { EmailDeliveriesPanel } from "@/components/email-deliveries";

export const Route = createFileRoute("/_authenticated/email-deliveries")({
  component: EmailDeliveriesPage,
});
function EmailDeliveriesPage() {
  return (
    <OperatorShell title="Email delivery">
      <EmailDeliveriesPanel />
    </OperatorShell>
  );
}
