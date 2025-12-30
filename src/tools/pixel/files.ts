import fs from 'fs/promises';

export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonIfExists(
  absPath: string,
): Promise<unknown | null> {
  try {
    const text = await fs.readFile(absPath, 'utf8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
