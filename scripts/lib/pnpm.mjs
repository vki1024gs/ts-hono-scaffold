import { execFileSync, spawn } from 'node:child_process';

const safeWindowsArgument = /^[A-Za-z0-9@/:._=-]+$/;

export function pnpmInvocation(args) {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...args],
    };
  }
  if (process.platform === 'win32') {
    if (args.some((argument) => !safeWindowsArgument.test(argument))) {
      throw new Error('Refusing to pass an unsafe argument to pnpm.cmd.');
    }
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', ['pnpm.cmd', ...args].join(' ')],
    };
  }
  return { command: 'pnpm', args };
}

export function runPnpmSync(args, options = {}) {
  const invocation = pnpmInvocation(args);
  return execFileSync(invocation.command, invocation.args, options);
}

export function spawnPnpm(args, options = {}) {
  const invocation = pnpmInvocation(args);
  return spawn(invocation.command, invocation.args, options);
}
