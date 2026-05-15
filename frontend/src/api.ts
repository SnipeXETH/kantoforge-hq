export type JobStatus = "queued" | "running" | "done" | "error";

export interface Clip {
  index: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  hook: string;
  caption: string;
  hashtags: string[];
  score: number;
  reason: string;
  video_path: string;
  caption_path: string;
}

export interface JobResult {
  job_id: string;
  source_title: string;
  source_uploader: string;
  source_url: string;
  output_dir: string;
  clips: Clip[];
}

export interface JobState {
  job_id: string;
  status: JobStatus;
  stage: string;
  progress: number;
  error: string | null;
  result: JobResult | null;
}

export interface CreateJobRequest {
  youtube_url: string;
  n_clips: number;
  min_sec: number;
  max_sec: number;
  whisper_backend: "local" | "api";
  whisper_model: string;
}

export async function createJob(req: CreateJobRequest): Promise<JobState> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`createJob: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getJob(jobId: string): Promise<JobState> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error(`getJob: ${res.status} ${await res.text()}`);
  return res.json();
}

export function clipUrl(jobId: string, index: number): string {
  return `/api/clips/${jobId}/clip_${String(index).padStart(2, "0")}.mp4`;
}
