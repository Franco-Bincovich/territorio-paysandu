import { SftpReader } from './reader';
import { HistoricalIndex, historicalLoader } from './historical-index';
import type { ImageReader } from '../image-reader';
import { FilesystemReader, filesystemEnvironment } from '../filesystem-images/reader';

export function createImageServices(env: NodeJS.ProcessEnv, reader?: ImageReader) {
  const filesystem = env.IMAGE_PROVIDER === 'filesystem';
  reader ??= filesystem ? new FilesystemReader(env) : new SftpReader(env);
  const mapped = filesystem ? filesystemEnvironment(env) : env;
  const historical = new HistoricalIndex(historicalLoader(reader, mapped), {
    timeoutMs: Number((filesystem ? env.FILESYSTEM_IMAGES_TIMEOUT_MS : env.SFTP_IMAGES_TIMEOUT_MS) ?? 10000),
    report: status => console.info(JSON.stringify({ event: 'historical_index', ...status })),
  });
  return { reader, historical };
}
type Services = ReturnType<typeof createImageServices>;
const state = globalThis as typeof globalThis & { __tpImagesV1?: Services; __tpImagesHooksV1?: boolean };
export function imageServices() {
  if (!state.__tpImagesV1) state.__tpImagesV1 = createImageServices({ ...process.env });
  state.__tpImagesV1.historical.start();
  return state.__tpImagesV1;
}
export function startImageServices() {
  if (process.env.IMAGE_PROVIDER !== 'filesystem' && (process.env.IMAGE_PROVIDER !== 'sftp' || process.env.SFTP_IMAGES_ENABLED !== 'true')) return;
  imageServices();
  if (!state.__tpImagesHooksV1) {
    state.__tpImagesHooksV1 = true;
    const stop = () => { void stopImageServices(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop); process.once('beforeExit', stop);
  }
}
export async function stopImageServices() {
  const services = state.__tpImagesV1;
  if (services) { const pending = services.historical.stop(); services.reader.close(); await pending; }
}
