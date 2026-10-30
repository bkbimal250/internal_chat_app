import { parseArgs } from 'node:util';
import { stdin as input, stdout as output } from 'node:process';
import { loadEnv } from '../../config/env.js';
import { createDatabase } from '../index.js';
import { recoverAdministrator } from './admin-recovery.js';

function usage() {
  output.write(
    'Usage: npm run recover:admin -- --username <admin-username> --confirm\n' +
      'Reads the new password from stdin. TTY prompts twice without echo.\n' +
      'Non-TTY: pipe the password and confirmation as two lines.\n' +
      'Does not create accounts. Does not print the password or hash.\n',
  );
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readHidden(prompt) {
  output.write(prompt);
  const previousRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  let value = '';
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      input.off('data', onData);
      try {
        input.setRawMode(Boolean(previousRaw));
      } catch {
        input.setRawMode(false);
      }
      output.write('\n');
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (char) => {
      if (char === '\u0003') {
        finish(new Error('Cancelled'));
        process.exitCode = 130;
        return;
      }
      if (char === '\n' || char === '\r') {
        finish(null, value);
        return;
      }
      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      if (char === '\u0015') {
        value = '';
        return;
      }
      if (char.length === 1 && char.charCodeAt(0) >= 32) value += char;
    };
    input.on('data', onData);
  });
}

async function readPassword() {
  if (input.isTTY) {
    const first = await readHidden('New administrator password: ');
    const second = await readHidden('Confirm password: ');
    if (first !== second) throw new Error('Passwords do not match');
    return first;
  }
  const lines = (await readStdinText())
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    .filter((line) => line.length > 0);
  if (lines.length >= 2) {
    if (lines[0] !== lines[1]) throw new Error('Passwords do not match');
    return lines[0];
  }
  if (lines.length === 1) return lines[0];
  throw new Error('Password is required on stdin');
}

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    confirm: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help || !values.username || !values.confirm) {
  usage();
  process.exitCode = values.help ? 0 : 1;
  if (!values.help) output.write('Refusing to run without --username and --confirm.\n');
  process.exit(process.exitCode);
}

const config = loadEnv();
const database = createDatabase(config);
try {
  const password = await readPassword();
  const result = await recoverAdministrator(database.db, {
    username: values.username,
    password,
  });
  output.write(
    `Administrator recovered (${result.username}). Sessions revoked: ${result.revoked}. ` +
      `Password change is required at next login.` +
      (result.status === 'suspended' ? ' Account remains suspended until reactivated.\n' : '\n'),
  );
} catch (error) {
  process.exitCode = 1;
  output.write(`${error instanceof Error ? error.message : 'Recovery failed'}\n`);
} finally {
  await database.close();
}
