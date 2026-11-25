import { EmptyState, PageHeader } from "../components/ui";

/** For screens whose design exists but that nothing saves yet, so they never claim work they didn't do. */
export function NotAvailable({ title, body }: { title: string; body: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Not available yet" body={body} />
    </>
  );
}
