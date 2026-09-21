import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { isIP } from 'node:net';
export function readEnvFile(root) {
  const file = path.join(root, '.env');
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}
export const isValidPort = (value) =>
  Number.isInteger(value) && value >= 1 && value <= 65535;
export const isValidHost = (value) =>
  value === 'localhost' || isIP(value) !== 0;
const safeApplicationName = (name) =>
  String(name)
    .replace(/^@/, '')
    .replace(/\/workspace$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'local-application';
export function defaultAppDataDir(
  applicationName,
  environment = process.env,
  platform = process.platform,
  home = os.homedir(),
) {
  const name = safeApplicationName(applicationName);
  if (platform === 'win32')
    return path.join(
      environment.APPDATA || path.join(home, 'AppData', 'Roaming'),
      name,
    );
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', name);
  return path.join(
    environment.XDG_DATA_HOME || path.join(home, '.local', 'share'),
    name,
  );
}
export function resolveAppDataDir(
  root,
  applicationName,
  environment = process.env,
) {
  const configured = String(environment.APP_DATA_DIR || '').trim();
  if (configured.includes('\0'))
    throw new Error('CONFIG_DATA_DIR: APP_DATA_DIR contains a null byte.');
  return path.resolve(
    configured
      ? path.isAbsolute(configured)
        ? configured
        : path.join(root, configured)
      : defaultAppDataDir(applicationName, environment),
  );
}
export function projectConfig(root, environment = process.env) {
  const rootPackage = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  const env = { ...readEnvFile(root), ...environment };
  const apiPort = Number(env.PORT || 18080),
    webPort = Number(env.VITE_PORT || 2711),
    apiHost = String(env.HOST || '127.0.0.1'),
    webHost = String(env.WEB_HOST || '127.0.0.1');
  const dataDir = resolveAppDataDir(root, rootPackage.name, env);
  if (!isValidPort(apiPort) || !isValidPort(webPort) || apiPort === webPort)
    throw new Error(
      'CONFIG_PORT: PORT and VITE_PORT must be distinct integers from 1 to 65535.',
    );
  if (!isValidHost(apiHost) || !isValidHost(webHost))
    throw new Error(
      'CONFIG_HOST: HOST and WEB_HOST must be IP addresses or localhost.',
    );
  if (env.AUTH_MODE && !['none', 'dev'].includes(env.AUTH_MODE))
    throw new Error(
      'CONFIG_AUTH: No authentication adapter enabled; remove AUTH_MODE or use none/dev.',
    );
  if (
    !['debug', 'info', 'warn', 'error', 'fatal'].includes(
      env.LOG_LEVEL || 'info',
    )
  )
    throw new Error('CONFIG_LOG_LEVEL: Use debug/info/warn/error/fatal.');
  return {
    rootPackage,
    scope: rootPackage.name.replace(/\/workspace$/, ''),
    env: {
      ...env,
      PORT: String(apiPort),
      HOST: apiHost,
      WEB_HOST: webHost,
      VITE_PORT: String(webPort),
      LOG_LEVEL: env.LOG_LEVEL || 'info',
      APP_DATA_DIR: dataDir,
    },
    dataDir,
    settingsDir: path.join(dataDir, 'settings'),
    backupDir: path.join(dataDir, 'backup'),
    logsDir: path.join(dataDir, 'logs'),
    stateFile: path.join(dataDir, 'app.json'),
    buildInfoFile: path.join(root, 'dist', 'build-info.json'),
    startLockFile: path.join(dataDir, 'start.lock'),
    legacyLogFile: path.join(dataDir, 'app.log'),
    apiPort,
    webPort,
    apiHost,
    webHost,
    apiOrigin:
      'http://' +
      (apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost) +
      ':' +
      apiPort,
    webOrigin:
      'http://' +
      (webHost === '0.0.0.0' ? '127.0.0.1' : webHost) +
      ':' +
      webPort,
  };
}
