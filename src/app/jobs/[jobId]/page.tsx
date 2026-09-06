import { JobView } from "./JobView";

export default async function JobPage(props: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await props.params;
  return <JobView jobId={jobId} />;
}
