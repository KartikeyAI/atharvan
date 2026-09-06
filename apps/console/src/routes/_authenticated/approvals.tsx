import { createFileRoute } from "@tanstack/react-router";
import { OperatorShell } from "@/components/operator-shell";
import { ApprovalPanel } from "@/components/approval-panel";

export const Route = createFileRoute("/_authenticated/approvals")({
  component: () => (
    <OperatorShell title="Approvals">
      <ApprovalPanel />
    </OperatorShell>
  ),
});
