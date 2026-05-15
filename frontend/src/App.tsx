import { useEffect, useRef, useState } from "react";
import {
  Clip,
  CreateJobRequest,
  JobState,
  clipUrl,
  createJob,
  getJob,
} from "./api";

const DEFAULT_REQ: CreateJobRequest = {
  youtube_url: "",
  n_clips: 5,
  min_sec: 20,
  max_sec: 75,
  whisper_backend: "local",
  whisper_model: "small.en",
};

export default function App() {
  const [req, setReq] = useState<CreateJobRequest>(DEFAULT_REQ);
  const [job, setJob] = useState<JobState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;

    const tick = async () => {
      try {
        const next = await getJob(job.job_id);
        setJob(next);
      } catch (e) {
        setSubmitError(String(e));
      }
    };
    pollTimer.current = window.setInterval(tick, 1500);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [job?.job_id, job?.status]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setJob(null);
    try {
      const newJob = await createJob(req);
      setJob(newJob);
    } catch (e) {
      setSubmitError(String(e));
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Repurposer</h1>
        <p className="subtitle">
          YouTube podcast → vertical short-form clips with karaoke captions
        </p>
      </header>

      <form onSubmit={onSubmit} className="job-form">
        <label>
          YouTube URL
          <input
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=..."
            value={req.youtube_url}
            onChange={(e) => setReq({ ...req, youtube_url: e.target.value })}
          />
        </label>

        <div className="row">
          <label>
            Clips
            <input
              type="number"
              min={1}
              max={20}
              value={req.n_clips}
              onChange={(e) =>
                setReq({ ...req, n_clips: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Min seconds
            <input
              type="number"
              min={10}
              max={120}
              value={req.min_sec}
              onChange={(e) =>
                setReq({ ...req, min_sec: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Max seconds
            <input
              type="number"
              min={20}
              max={180}
              value={req.max_sec}
              onChange={(e) =>
                setReq({ ...req, max_sec: Number(e.target.value) })
              }
            />
          </label>
        </div>

        <div className="row">
          <label>
            Whisper
            <select
              value={req.whisper_backend}
              onChange={(e) =>
                setReq({
                  ...req,
                  whisper_backend: e.target.value as "local" | "api",
                })
              }
            >
              <option value="local">Local (faster-whisper)</option>
              <option value="api">OpenAI API</option>
            </select>
          </label>
          {req.whisper_backend === "local" && (
            <label>
              Model
              <select
                value={req.whisper_model}
                onChange={(e) =>
                  setReq({ ...req, whisper_model: e.target.value })
                }
              >
                <option value="tiny.en">tiny.en (fast, lower quality)</option>
                <option value="base.en">base.en</option>
                <option value="small.en">small.en (recommended)</option>
                <option value="medium.en">medium.en</option>
                <option value="large-v3">large-v3 (slow, best)</option>
              </select>
            </label>
          )}
        </div>

        <button type="submit" disabled={job?.status === "running"}>
          {job?.status === "running" ? "Working…" : "Generate clips"}
        </button>

        {submitError && <p className="error">{submitError}</p>}
      </form>

      {job && <JobView job={job} />}
    </div>
  );
}

function JobView({ job }: { job: JobState }) {
  return (
    <section className="job">
      <div className="job-header">
        <code>{job.job_id}</code>
        <StatusBadge status={job.status} />
      </div>

      {(job.status === "queued" || job.status === "running") && (
        <div className="progress">
          <div
            className="progress-bar"
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
          <div className="progress-label">
            {job.stage} · {Math.round(job.progress * 100)}%
          </div>
        </div>
      )}

      {job.status === "error" && (
        <pre className="error-trace">{job.error}</pre>
      )}

      {job.status === "done" && job.result && (
        <>
          <div className="source-info">
            <strong>{job.result.source_title}</strong>
            <span> · {job.result.source_uploader}</span>
          </div>
          <div className="clips">
            {job.result.clips.map((c) => (
              <ClipCard key={c.index} jobId={job.job_id} clip={c} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: JobState["status"] }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function ClipCard({ jobId, clip }: { jobId: string; clip: Clip }) {
  const [copied, setCopied] = useState(false);
  const fullCaption =
    clip.caption +
    (clip.hashtags.length ? "\n\n" + clip.hashtags.map((h) => `#${h}`).join(" ") : "");

  const copy = async () => {
    await navigator.clipboard.writeText(fullCaption);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className="clip-card">
      <video
        controls
        preload="metadata"
        src={clipUrl(jobId, clip.index)}
        className="clip-video"
      />
      <div className="clip-meta">
        <div className="clip-title-row">
          <span className="clip-index">#{clip.index}</span>
          <span className="clip-score">score {clip.score.toFixed(1)}</span>
          <span className="clip-time">
            {Math.round(clip.start_sec)}s–{Math.round(clip.end_sec)}s ·{" "}
            {Math.round(clip.duration_sec)}s
          </span>
        </div>
        <div className="clip-hook">"{clip.hook}"</div>
        <div className="clip-caption">{clip.caption}</div>
        <div className="clip-tags">
          {clip.hashtags.map((h) => (
            <span key={h} className="tag">
              #{h}
            </span>
          ))}
        </div>
        <div className="clip-reason">{clip.reason}</div>
        <div className="clip-actions">
          <button onClick={copy}>{copied ? "Copied" : "Copy caption"}</button>
          <a
            href={clipUrl(jobId, clip.index)}
            download={`clip_${String(clip.index).padStart(2, "0")}.mp4`}
          >
            Download mp4
          </a>
        </div>
      </div>
    </article>
  );
}
