const { handleGenerateImage } = require("./image-api");

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

const jobs = new Map();

function publicJob(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    error: job.error,
    result: job.result,
  };
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || status === 524 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneJobs(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [jobId, job] of jobs.entries()) {
    if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) {
      jobs.delete(jobId);
    }
  }
}

async function runJob(job, input, options) {
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const started = Date.now();
  job.status = "running";
  job.startedAt = new Date(started).toISOString();

  while (job.attempts < maxAttempts && !job.abortController.signal.aborted) {
    job.attempts += 1;
    try {
      const result = await handleGenerateImage(input, {
        ...options,
        signal: job.abortController.signal,
      });
      if (job.abortController.signal.aborted) return;
      const finished = Date.now();
      job.status = "succeeded";
      job.finishedAt = new Date(finished).toISOString();
      job.durationMs = finished - started;
      job.result = {
        ...result,
        durationMs: job.durationMs,
      };
      return;
    } catch (error) {
      if (job.abortController.signal.aborted) return;
      const status = error.status || 500;
      const canRetry = retryableStatus(status) && job.attempts < maxAttempts;
      job.error = canRetry
        ? `上游暂时失败，正在自动重试：${error.message || `HTTP ${status}`}`
        : error.message || `OpenAI 请求失败，HTTP ${status}`;
      if (!canRetry) {
        const finished = Date.now();
        job.status = "failed";
        job.finishedAt = new Date(finished).toISOString();
        job.durationMs = finished - started;
        return;
      }
      await sleep(retryDelayMs);
    }
  }
}

function createImageJob(input, options = {}) {
  pruneJobs(options.maxAgeMs);
  const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    jobId,
    status: "queued",
    attempts: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    error: null,
    result: null,
    abortController: new AbortController(),
  };
  jobs.set(jobId, job);
  runJob(job, input, options).catch((error) => {
    if (job.status === "cancelled") return;
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = error.message || "服务异常";
  });
  return publicJob(job);
}

function getImageJob(jobId) {
  return publicJob(jobs.get(jobId));
}

function cancelImageJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") {
    job.abortController.abort();
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    job.error = "任务已取消";
  }
  return publicJob(job);
}

module.exports = {
  cancelImageJob,
  createImageJob,
  getImageJob,
  pruneJobs,
};
