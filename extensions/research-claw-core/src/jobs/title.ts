const MAX_SUMMARY_LENGTH = 56;

const TASK_TYPE_RULES: Array<[string, RegExp]> = [
  ['文献任务', /论文|文献|paper|papers|pdf|arxiv|doi|期刊|会议/i],
  ['代码任务', /代码|仓库|代码库|项目|bug|修复|实现|重构|测试|构建|build|commit|push|github/i],
  ['数据任务', /数据|数据库|sqlite|表格|csv|excel|dataset|清洗|统计/i],
  ['写作任务', /写作|撰写|报告|文档|markdown|总结|汇总|生成.*(?:报告|文档)/i],
  ['文件任务', /workspace|工作区|目录|文件夹|文件|扫描|遍历|整理/i],
];

export function formatJobTitleFromMessage(message: string, fallbackType = '后台任务'): string {
  const summary = summarizeOriginalMessage(message);
  const type = inferTaskType(message, fallbackType);
  return `${type}: ${summary || '未命名任务'}`;
}

export function inferTaskType(message: string, fallbackType = '后台任务'): string {
  for (const [type, pattern] of TASK_TYPE_RULES) {
    if (pattern.test(message)) return type;
  }
  return fallbackType;
}

export function summarizeOriginalMessage(message: string): string {
  const firstLine = message
    .replace(/^把这个任务作为(?:\s*OpenClaw)?(?:\s*子会话)?后台(?:任务)?执行[:：]?\s*/i, '')
    .replace(/^请?(?:帮我)?\s*/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
  const compact = firstLine
    .replace(/^#+\s*/, '')
    .replace(/^任务[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length <= MAX_SUMMARY_LENGTH) return compact;
  return `${compact.slice(0, MAX_SUMMARY_LENGTH)}...`;
}
