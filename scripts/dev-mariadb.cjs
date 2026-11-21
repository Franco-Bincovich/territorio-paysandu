// Explicit local QA launcher. Never pass --env-file or secrets as CLI arguments.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { execFileSync, spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const mariaConfig = 'Backend/server/mariadb/.env.local';

function configurationRoot() {
  if (fs.existsSync(path.join(root, mariaConfig))) return root;
  // Linked worktrees share the original checkout's private configuration files.
  // Resolve that checkout through Git instead of copying files with credentials.
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    if (common && fs.existsSync(path.join(path.dirname(common), mariaConfig))) return path.dirname(common);
  } catch {
    return undefined;
  }
}

function configuration(configRoot = configurationRoot()) {
  if (!configRoot) throw Error('Configuración local MariaDB incompleta.');
  const local = parseEnv(fs.readFileSync(path.join(configRoot, mariaConfig), 'utf8'));
  // Do not import NODE_OPTIONS, NEXT_PUBLIC_* or unrelated providers from this file.
  const env = { ...process.env };
  for (const key of ['AUTH_PROVIDER', 'MARIADB_AUTH_TEST_ENABLED', 'APP_ORIGIN', 'DATA_MODE',
    'MARIADB_HOST', 'MARIADB_PORT', 'MARIADB_DATABASE', 'MARIADB_USER', 'MARIADB_PASSWORD',
    'MARIADB_TLS', 'MARIADB_TLS_CA_FILE', 'CONSULTATIONS_WRITE_ENABLED',
    'CONSULTATIONS_SCHEMA_METADATA_VIEW', 'ADMINISTRATION_ENABLED', 'ADMINISTRATION_WRITE_ENABLED']) {
    if (Object.hasOwn(local, key)) env[key] = local[key];
  }
  const institutionalPath = path.join(configRoot, 'Backend/server/institutional/.env.local');
  if (fs.existsSync(institutionalPath)) {
    const source = parseEnv(fs.readFileSync(institutionalPath, 'utf8'));
    for (const key of ['INSTITUTIONAL_ENABLED', 'INSTITUTIONAL_HOST', 'INSTITUTIONAL_PORT',
      'INSTITUTIONAL_DATABASE', 'INSTITUTIONAL_USER', 'INSTITUTIONAL_PASSWORD', 'INSTITUTIONAL_TLS', 'INSTITUTIONAL_TLS_CA_FILE']) {
      if (Object.hasOwn(source, key)) env[key] = source[key];
    }
  }
  if (local.AUTH_PROVIDER !== 'mariadb-test' || local.MARIADB_AUTH_TEST_ENABLED !== 'true' ||
    env.NODE_ENV === 'production') throw Error('Habilitar explícitamente MariaDB de prueba, fuera de producción.');
  if (env.APP_ORIGIN !== 'http://127.0.0.1:3105')
    throw Error('El arranque local requiere APP_ORIGIN=http://127.0.0.1:3105.');
  if (!['MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD'].every(k => !!local[k]) ||
    local.MARIADB_DATABASE !== 'auxiliares') throw Error('Configuración local MariaDB incompleta.');
  if (env.MARIADB_TLS === 'false' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw Error('Este arranque requiere TLS con validación de certificados.');
  if ((env.NODE_OPTIONS ?? '').includes('--env-file'))
    throw Error('Quitá --env-file de NODE_OPTIONS en esta terminal antes de iniciar.');
  env.NODE_ENV = 'development';
  const sftp = require('./load-sftp-env.cjs').sftpEnvironment(env, configRoot);
  return require('./load-security-env.cjs').securityEnvironment(sftp, configRoot);
}

if (require.main === module) {
  try {
    const configRoot = configurationRoot();
    const maria = !!configRoot || !process.argv.includes('--auto');
    const env = maria ? configuration(configRoot) : process.env;
    const dependencies = path.join(root, 'node_modules');
    const args = [path.join(dependencies, 'next/dist/bin/next'), 'dev', 'Frontend', '--hostname', '127.0.0.1'];
    // Turbopack cannot resolve a dependency junction outside its worktree root.
    if (fs.existsSync(dependencies) && fs.realpathSync(dependencies) !== dependencies) args.push('--webpack');
    if (maria) args.push('--port', '3105');
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', () => { console.error('No se pudo iniciar Next local.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
  } catch (error) {
    // File/parser errors may contain input; only show our controlled messages.
    const safe = ['Habilitar explícitamente', 'El arranque local requiere', 'Configuración local',
      'Este arranque requiere', 'Quitá --env-file'];
    console.error(safe.some(prefix => error.message?.startsWith(prefix)) ? error.message :
      'No se pudo leer la configuración local MariaDB. No se inició Next.');
    process.exitCode = 1;
  }
}
module.exports = { configuration };
