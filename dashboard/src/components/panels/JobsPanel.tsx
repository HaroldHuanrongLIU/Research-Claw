import { useEffect, useState } from 'react';
import { App, Button, Empty, Progress, Spin, Tag, Tooltip, Typography } from 'antd';
import { DownOutlined, PlayCircleOutlined, RedoOutlined, ReloadOutlined, RightOutlined, StopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useJobsStore, type Job, type JobStatus, type JobStepStatus } from '../../stores/jobs';
import { useGatewayStore } from '../../stores/gateway';
import { relativeTime } from '../../utils/relativeTime';

const { Text } = Typography;

// rc_jobs timestamps are SQLite 'YYYY-MM-DD HH:MM:SS' in UTC with no tz marker;
// new Date() would misparse that as local time, so normalize to ISO-UTC first.
function dbDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes('T')) return trimmed;
  return `${trimmed.replace(' ', 'T')}Z`;
}

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: 'default',
  running: 'processing',
  completed: 'success',
  partial: 'warning',
  failed: 'error',
  stalled: 'warning',
  cancelled: 'default',
};

const STEP_STATUS_COLORS: Record<JobStepStatus, string> = {
  pending: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  skipped: 'default',
};

function JobSteps({ steps }: { steps: NonNullable<Job['steps']> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div>
      <Text
        type="secondary"
        style={{ fontSize: 12, cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
        {t('jobs.steps')} ({steps.length})
      </Text>
      {open && (
        <div style={{ display: 'grid', gap: 4, marginTop: 6, paddingLeft: 8, borderLeft: '1px solid var(--border)' }}>
          {steps.map((step) => (
            <div key={step.step_key} style={{ display: 'grid', gap: 2 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Tag color={STEP_STATUS_COLORS[step.status]} style={{ marginInlineEnd: 0 }}>
                  {t(`jobs.stepStatus.${step.status}`)}
                </Tag>
                <Text style={{ fontSize: 12, flex: 1 }}>{step.label}</Text>
                {step.status === 'running' && <Text type="secondary" style={{ fontSize: 11 }}>{step.progress}%</Text>}
                {step.attempt > 1 && (
                  <Text type="secondary" style={{ fontSize: 11 }}>{t('jobs.stepAttempt', { count: step.attempt })}</Text>
                )}
              </div>
              {step.error && <Text type="danger" style={{ fontSize: 11 }}>{step.error}</Text>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const updatedIso = dbDateToIso(job.updated_at);
  const updatedRel = relativeTime(updatedIso, i18n.language);
  const updatedLocal = updatedIso ? new Date(updatedIso).toLocaleString() : job.updated_at;
  const cancelJob = useJobsStore((s) => s.cancelJob);
  const resumeJob = useJobsStore((s) => s.resumeJob);
  const retryJob = useJobsStore((s) => s.retryJob);
  const loadJob = useJobsStore((s) => s.loadJob);
  const action = useJobsStore((s) => s.actionById[job.id]);
  const active = job.status === 'queued' || job.status === 'running' || job.status === 'stalled';
  const controllableOpenClaw = job.type === 'openclaw-subagent' && Boolean(job.session_key);
  const cancellable = active;
  const resumable = controllableOpenClaw && (job.status === 'stalled' || job.status === 'failed' || job.status === 'cancelled');

  const runAction = (fn: () => Promise<void>) => {
    void fn().catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(detail || t('jobs.actionFailed'));
    });
  };

  return (
    <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Text strong style={{ flex: 1 }}>{job.title}</Text>
        <Tag color={STATUS_COLORS[job.status]}>{t(`jobs.status.${job.status}`)}</Tag>
      </div>
      <Progress percent={job.progress} status={job.status === 'failed' ? 'exception' : undefined} size="small" />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {job.current_step || t('jobs.waiting')}
      </Text>
      {job.error && <Text type="danger" style={{ fontSize: 12 }}>{job.error}</Text>}
      {job.steps && job.steps.length > 0 && <JobSteps steps={job.steps} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Tooltip title={updatedLocal}>
          <Text type="secondary" style={{ fontSize: 11 }}>{job.type} · {updatedRel}</Text>
        </Tooltip>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <Tooltip title={t('jobs.refresh')}>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => void loadJob(job.id)} />
          </Tooltip>
          {resumable && (
            <Tooltip title={t('jobs.resume')}>
              <Button
                size="small"
                type="text"
                icon={<PlayCircleOutlined />}
                loading={action === 'resume'}
                disabled={Boolean(action)}
                onClick={() => runAction(() => resumeJob(job.id))}
              />
            </Tooltip>
          )}
          {resumable && (
            <Tooltip title={t('jobs.retry')}>
              <Button
                size="small"
                type="text"
                icon={<RedoOutlined />}
                loading={action === 'retry'}
                disabled={Boolean(action)}
                onClick={() => runAction(() => retryJob(job.id))}
              />
            </Tooltip>
          )}
          {cancellable && (
            <Tooltip title={t('jobs.cancel')}>
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                loading={action === 'cancel'}
                disabled={Boolean(action)}
                onClick={() => runAction(() => cancelJob(job.id))}
              />
            </Tooltip>
          )}
        </span>
      </div>
    </div>
  );
}

export default function JobsPanel() {
  const { t } = useTranslation();
  const jobs = useJobsStore((s) => s.jobs);
  const loading = useJobsStore((s) => s.loading);
  const loadJobs = useJobsStore((s) => s.loadJobs);
  const connState = useGatewayStore((s) => s.state);

  // Refresh once when the panel opens; the global JobsActivityListener owns the
  // ongoing poll so jobs stay live (and notify) even when this panel is closed.
  useEffect(() => {
    if (connState !== 'connected') return;
    void loadJobs();
  }, [connState, loadJobs]);

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ padding: 12, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
        <Text type="secondary" style={{ flex: 1 }}>{t('jobs.hint')}</Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadJobs()} />
      </div>
      {loading && jobs.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>
      ) : jobs.length === 0 ? (
        <Empty description={t('jobs.empty')} />
      ) : jobs.map((job) => <JobCard key={job.id} job={job} />)}
    </div>
  );
}
