import { notFound } from "next/navigation";
import { getFormat } from "@/formats";
import { Editor } from "./Editor";

/**
 * `params` is a Promise in Next 16 -- synchronous access was removed, not just
 * deprecated. PageProps gives the route's own typed params.
 */
export default async function NewJobPage(props: PageProps<"/new/[formatId]">) {
  const { formatId } = await props.params;
  const format = getFormat(formatId);
  if (!format || format.status !== "ready") notFound();

  return <Editor format={format} />;
}
