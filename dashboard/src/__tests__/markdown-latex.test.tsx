import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import MarkdownBody from '../components/MarkdownBody';
import { normalizeMath } from '../lib/markdown';

describe('normalizeMath delimiter rewrite', () => {
  it('rewrites \\(...\\) to $...$ and trims inner space', () => {
    expect(normalizeMath('a \\(x^2\\) b')).toBe('a $x^2$ b');
    expect(normalizeMath('a \\( x^2 \\) b')).toBe('a $x^2$ b');
  });

  it('rewrites \\[...\\] to a display $$ block', () => {
    expect(normalizeMath('\\[ \\sum x \\]').trim()).toBe('$$\n\\sum x\n$$');
  });

  it('promotes inline $$...$$ to a display block', () => {
    expect(normalizeMath('$$x$$').trim()).toBe('$$\nx\n$$');
  });

  it('leaves $ / \\( inside inline code untouched', () => {
    const src = 'use `\\(x\\)` and `$y$` literally';
    expect(normalizeMath(src)).toBe(src);
  });

  it('leaves \\( inside fenced code untouched', () => {
    const src = '```\nf(\\(x\\)) = $z$\n```';
    expect(normalizeMath(src)).toBe(src);
  });
});

describe('MarkdownBody LaTeX rendering', () => {
  it('renders $...$ inline math as KaTeX', () => {
    const { container } = render(<MarkdownBody>{'Mass: $E = mc^2$ done.'}</MarkdownBody>);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders \\(...\\) inline math as KaTeX (not literal parens)', () => {
    const { container } = render(<MarkdownBody>{'Pyth: \\(a^2 + b^2 = c^2\\) end.'}</MarkdownBody>);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders $$...$$ and \\[...\\] as display math', () => {
    const dollar = render(<MarkdownBody>{'$$\\int_0^1 x\\,dx$$'}</MarkdownBody>);
    expect(dollar.container.querySelector('.katex-display')).not.toBeNull();

    const bracket = render(<MarkdownBody>{'\\[ \\sum_{i=1}^n i \\]'}</MarkdownBody>);
    expect(bracket.container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does NOT treat $ inside a code block as math', () => {
    const { container } = render(
      <MarkdownBody>{'```bash\necho $HOME and \\(x\\)\n```'}</MarkdownBody>,
    );
    expect(container.querySelector('.katex')).toBeNull();
  });

  it('does NOT crash on malformed LaTeX', () => {
    expect(() =>
      render(<MarkdownBody>{'broken: $\\frac{1}{$ oops'}</MarkdownBody>),
    ).not.toThrow();
  });
});
