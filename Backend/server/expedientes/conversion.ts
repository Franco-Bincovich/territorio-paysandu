import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { HttpError } from '../security';
import { validateDocx } from './docx';
export { validateDocx } from './docx';

let active = false;
export async function convertDocxToPdf(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  if (active) throw new HttpError(429, 'EXPEDIENTES_CONVERSION_BUSY', 'Hay una conversión en proceso. Intentá nuevamente en unos instantes.');
  if (signal?.aborted) throw new HttpError(408, 'EXPEDIENTES_CONVERSION_CANCELLED', 'La conversión fue cancelada.');
  validateDocx(bytes);
  active = true;
  let directory: string | undefined;
  try {
    if (process.platform !== 'linux') throw new HttpError(503, 'EXPEDIENTES_CONVERSION_UNAVAILABLE', 'La exportación PDF requiere el contenedor de conversión.');
    directory = await mkdtemp(join(tmpdir(), 'tp-docx-'));
    const profile = join(directory, 'profile');
    await mkdir(join(profile, 'user'), { recursive: true });
    await writeFile(join(profile, 'user', 'registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Save/Document"><prop oor:name="LoadReadonly" oor:op="fuse"><value>true</value></prop></item></oor:items>', { mode: 0o600 });
    await writeFile(join(directory, 'document.docx'), bytes, { mode: 0o400 });
    const work = directory;
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      const child = spawn('/usr/bin/prlimit', ['--cpu=25:25', '--as=805306368:805306368', '--fsize=33554432:33554432', '--nofile=256:256', '--', '/usr/bin/python3', '/usr/local/lib/territorio/converter-sandbox.py', '/usr/bin/libreoffice', `-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', work, join(work, 'document.docx')], { cwd: work, detached: true, stdio: 'ignore', env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', HOME: work, TMPDIR: work, LANG: 'C.UTF-8', SAL_USE_VCLPLUGIN: 'svp' } });
      const stop = () => { timedOut = true; if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
      const timer = setTimeout(stop, 30000);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      child.once('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new HttpError(503, 'EXPEDIENTES_CONVERSION_UNAVAILABLE', 'El conversor PDF no está disponible.')); });
      child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', stop); if (timedOut || code !== 0) reject(new HttpError(timedOut ? 408 : 422, 'EXPEDIENTES_CONVERSION_FAILED', 'No se pudo convertir el documento a PDF.')); else resolve(); });
    });
    const output = join(directory, 'document.pdf');
    const info = await stat(output);
    if (!info.isFile() || info.size < 100 || info.size > 20 * 1024 * 1024) throw new Error();
    const pdf = await readFile(output);
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdf.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new Error();
    return pdf;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(422, 'EXPEDIENTES_CONVERSION_FAILED', 'No se pudo convertir el documento a PDF.'); }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { active = false; } }
}
