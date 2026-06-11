import { describe, it, expect } from 'vitest';
import {
  collectDroppedEntries,
  mapWithConcurrency,
  splitRelPath,
} from './drop-entries';

// --- Minimal FileSystemEntry mocks (webkitGetAsEntry tree) ---

function fileEntry(name: string): any {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (onSuccess: (f: File) => void) => onSuccess(new File([name], name)),
  };
}

function dirEntry(name: string, children: any[]): any {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      // readEntries drains in batches and signals completion with [].
      let served = false;
      return {
        readEntries: (onSuccess: (entries: any[]) => void) => {
          onSuccess(served ? [] : children);
          served = true;
        },
      };
    },
  };
}

function makeDataTransfer(entries: any[]): DataTransfer {
  const items = entries.map((entry) => ({
    webkitGetAsEntry: () => entry,
  }));
  return {
    items: items as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
  } as unknown as DataTransfer;
}

describe('collectDroppedEntries', () => {
  it('flattens a dropped folder preserving relative paths + rootDir', async () => {
    const tree = dirEntry('myfolder', [
      fileEntry('a.txt'),
      dirEntry('sub', [fileEntry('b.txt')]),
    ]);

    const result = await collectDroppedEntries(makeDataTransfer([tree]));

    expect(result.hadDirectory).toBe(true);
    expect(result.files.map((f) => f.relPath).sort()).toEqual([
      'myfolder/a.txt',
      'myfolder/sub/b.txt',
    ]);
    expect(result.files.every((f) => f.rootDir === 'myfolder')).toBe(true);
  });

  it('treats loose top-level files as rootDir=null', async () => {
    const result = await collectDroppedEntries(makeDataTransfer([fileEntry('loose.pdf')]));

    expect(result.hadDirectory).toBe(false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relPath).toBe('loose.pdf');
    expect(result.files[0].rootDir).toBeNull();
  });

  it('falls back to dataTransfer.files when entries API is unavailable', async () => {
    const dt = {
      items: [] as unknown as DataTransferItemList,
      files: [new File(['x'], 'x.csv')] as unknown as FileList,
    } as unknown as DataTransfer;

    const result = await collectDroppedEntries(dt);

    expect(result.hadDirectory).toBe(false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relPath).toBe('x.csv');
    expect(result.files[0].rootDir).toBeNull();
  });
});

describe('splitRelPath', () => {
  const id = (s: string) => s;

  it('strips the root folder and returns subdir + filename', () => {
    expect(splitRelPath('myfolder/sub/a.txt', 'myfolder', id)).toEqual({
      subDir: 'sub',
      fileName: 'a.txt',
    });
  });

  it('returns empty subdir for a file directly under the root', () => {
    expect(splitRelPath('myfolder/a.txt', 'myfolder', id)).toEqual({
      subDir: '',
      fileName: 'a.txt',
    });
  });

  it('handles loose files (no rootDir)', () => {
    expect(splitRelPath('a.txt', null, id)).toEqual({ subDir: '', fileName: 'a.txt' });
  });

  it('sanitizes each directory segment', () => {
    const sanitize = (s: string) => s.replace(/[^a-z]/gi, '_');
    expect(splitRelPath('root/we ird/a.txt', 'root', sanitize)).toEqual({
      subDir: 'we_ird',
      fileName: 'a.txt',
    });
  });
});

describe('mapWithConcurrency', () => {
  it('returns results in input order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
  });
});
