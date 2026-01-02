import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(rootDir);
const distDir = join(projectRoot, 'dist');

await mkdir(distDir, { recursive: true });

const indexSource = await readFile(join(projectRoot, 'index.js'), 'utf8');
const indexOutput = indexSource
  .replace('./src/altd.js', './altd.js')
  .replace('./package.json', '../package.json');

await writeFile(join(distDir, 'index.js'), indexOutput);
await copyFile(join(projectRoot, 'src', 'altd.js'), join(distDir, 'altd.js'));
