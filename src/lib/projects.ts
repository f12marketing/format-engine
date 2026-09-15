/**
 * The `public.projects` table, owned by the sibling story-to-animation app
 * (`../app`) but shared over the same Supabase project. This app only reads
 * and creates rows, scoped to whichever user is signed in; it never runs the
 * story/character/shot generation itself -- that stays `../app`'s job.
 */
export type ProjectStage = "story" | "characters" | "shots" | "carousel" | "done";
export type ProjectStatus = "draft" | "generating" | "needs_review" | "failed";
export type ProjectOutputKind = "video" | "carousel";
export type ProjectAspectRatio = "16:9" | "9:16" | "1:1" | "4:5" | "4:3" | "3:4";

export const SUMMARY_COLUMNS =
  "id, logline, stage, status, output_kind, created_at, updated_at" as const;

export type ProjectSummary = {
  id: string;
  logline: string | null;
  stage: ProjectStage;
  status: ProjectStatus;
  output_kind: ProjectOutputKind;
  created_at: string;
  updated_at: string;
};

export type ProjectDetail = ProjectSummary & {
  user_id: string;
  target_duration_seconds: number;
  image_style: string;
  error: string | null;
  story_markdown: string | null;
  characters_json: unknown;
  backgrounds_json: unknown;
  shots_json: unknown;
  video_mode: "video" | "slideshow";
  render_status: "idle" | "generating" | "done" | "failed";
  render_error: string | null;
  final_video_path: string | null;
  aspect_ratio: ProjectAspectRatio;
  carousel_slide_count: number;
  carousel_json: unknown;
  carousel_template: string;
};
