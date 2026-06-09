import React from 'react';
import ReactMarkdown from 'react-markdown';
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  markdownComponents,
  normalizeMath,
} from '../lib/markdown';

interface MarkdownBodyProps {
  children: string;
  className?: string;
  style?: React.CSSProperties;
  /** Tighter spacing for summary cards / description lists */
  compact?: boolean;
}

export default function MarkdownBody({ children, className, style, compact }: MarkdownBodyProps) {
  const classes = [
    'markdown-body',
    compact ? 'markdown-body-compact' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} style={style}>
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={markdownComponents}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
