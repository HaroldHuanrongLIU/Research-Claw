import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useJobsStore, type JobStatus } from '../stores/jobs';
import { useGatewayStore } from '../stores/gateway';
import { notifyNative, setDockBadge, isDesktop } from '../utils/desktop';

/**
 * Always-mounted background-jobs watcher. It owns the global poll for the job
 * list (so notifications and the Dock badge work even when the Jobs panel is
 * closed), detects completion transitions, and surfaces them natively:
 *   - a macOS system notification when a job finishes/fails
 *   - a Dock badge counting jobs still active
 *
 * In a plain browser the native calls are no-ops; the in-app panel still works.
 */

const ACTIVE: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'running', 'stalled']);
// Terminal states worth a notification. 'cancelled' is user-initiated, so skip.
const NOTIFY_DONE: ReadonlySet<JobStatus> = new Set<JobStatus>(['completed', 'partial', 'failed']);

const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 12_000;

export default function JobsActivityListener() {
  const { t } = useTranslation();
  const jobs = useJobsStore((s) => s.jobs);
  const loadJobs = useJobsStore((s) => s.loadJobs);
  const connState = useGatewayStore((s) => s.state);

  // Previous status per job id, to detect active → terminal transitions.
  const prevStatus = useRef<Map<string, JobStatus>>(new Map());
  const seeded = useRef(false);

  // Adaptive polling: fast while something is active, slow when idle.
  useEffect(() => {
    if (connState !== 'connected') return;
    let timer: number;
    const tick = () => {
      void loadJobs();
      const anyActive = useJobsStore.getState().jobs.some((j) => ACTIVE.has(j.status));
      timer = window.setTimeout(tick, anyActive ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [connState, loadJobs]);

  // React to job list changes: fire notifications + update the Dock badge.
  useEffect(() => {
    const prev = prevStatus.current;

    // First populated snapshot: seed without notifying, so pre-existing
    // completed jobs don't all fire a notification on launch.
    if (!seeded.current) {
      if (jobs.length > 0 || connState === 'connected') {
        for (const job of jobs) prev.set(job.id, job.status);
        seeded.current = true;
      }
    } else {
      for (const job of jobs) {
        const before = prev.get(job.id);
        if (before && ACTIVE.has(before) && NOTIFY_DONE.has(job.status)) {
          notifyNative(t(`jobs.notify.${job.status}`), job.title);
        }
        prev.set(job.id, job.status);
      }
    }

    const activeCount = jobs.filter((j) => ACTIVE.has(j.status)).length;
    if (isDesktop()) setDockBadge(activeCount);
  }, [jobs, connState, t]);

  return null;
}
