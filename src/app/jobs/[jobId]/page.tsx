import { JobView } from "./JobView";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";

export default async function JobPage(props: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await props.params;
  return (
    <AuthorisedBoundary>
      <JobView jobId={jobId} />
    </AuthorisedBoundary>
  );
}
