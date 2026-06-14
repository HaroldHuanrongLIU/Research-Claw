# Research-Claw v0.7.2

> 科研龙虾 v0.7.2 — built as an OpenClaw satellite.
> OpenClaw base: `2026.6.1` · Protocol v3 · Date: 2026-06-14

功能性发布:重做设置面板的 API 配置体验(协议探针、preset 一键切换、独立视觉端点、上下文窗口可配),新增 Ctrl+C 退出告别页,增强聊天与工作区交互,并落地零依赖密钥扫描防线。

## What's New

### Features

- **API 协议探针** —— 新增"测试"按钮,一键探测端点并自动识别套用协议(anthropic-messages / openai 等);探测期锁定保存并冻结 URL 输入,读取状态码后及时释放连接避免占用 socket。
- **已保存 API 配置 preset 一键切换** —— 已保存配置支持 preset 直接切换并修复切换不生效;统一配置选择器与内联列表的草稿数据与样式。
- **独立视觉端点** —— 视觉端点可指向独立配置,按 URL 自动对齐协议,视觉密钥与 URL 命名对齐文本端点。
- **上下文窗口可配** —— 自定义/本地端点可配置上下文窗口与全局压缩长度,并防止启动对齐覆盖用户设置;启动期按 OpenClaw 权威目录对齐模型卡上下文窗口(新增模型目录快照与对齐纯函数及单测)。
- **退出告别页** —— Ctrl+C 退出时显示用量总览、平台更新提示、版本与致谢。
- **聊天输入增强** —— 输入框支持引用文件、文件夹拖拽上传与超时继续;首轮对话后用主模型自动生成会话标题;模态确认与图片处理体验优化。
- **主会话管理** —— 主会话支持清空重置,并隐藏 subagent 合成会话。

### Fixes

- **OpenAI Codex 身份统一** —— 迁移到统一 `openai` 身份,并放行无 `content-type` 的 SSE 响应。
- **无效会话探测** —— 无请求方标识时跳过 current 会话探测,消除无效 `sessions.resolve` 报错。
- **配置交互** —— 修正配置切换后再编辑的按钮判定;内联配置列表点击当前卡片不再误触发保存;切换供应商时规范化配置标签与 API 回退,保持表单干净;移除设置页冗余 GitHub 链接,精简调参项。
- **工作区软链** —— 迁移后的提示文件改用根软链修复原生读取 ENOENT;根文件让位软链时按内容比对防误删,独特内容转存编号备份。
- **Docker L1 提示** —— L1 提示改版本门控刷新并清理无引用的旧版 USER 模板。

### Security

- **零依赖密钥扫描钩子** —— 新增零依赖密钥扫描 pre-commit 钩子与 CI 步骤,拦截明文密钥推送。
- **凭证防泄露** —— Docker 忽略运行时凭证目录防 cookie 烤入发布镜像;补全 config 备份快照的 git/docker 忽略规则,防密钥随推送或镜像泄露。

### Housekeeping

- README 中英文对齐当前 Dashboard 功能并补充新特性。
- research-plugins 维持 **v1.4.7**(433 skills + 18 agent tools)。

## Upgrade

```bash
curl -fsSL https://wentor.ai/install.sh | bash
```
