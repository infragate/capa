/**
 * Dependency-free interactive single-select prompt using raw stdin.
 * Falls back to a numbered-list prompt when raw mode is unavailable.
 */

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Prompt the user to select one option from a list.
 * Requires a TTY; throws if stdin is not interactive.
 */
export async function selectPrompt(
  message: string,
  options: SelectOption[]
): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive prompt requires a TTY. Pass --provider <id> instead.');
  }

  if (options.length === 0) {
    throw new Error('No options available to select from.');
  }

  if (options.length === 1) {
    return options[0].value;
  }

  try {
    return await rawSelect(message, options);
  } catch {
    return numberedSelect(message, options);
  }
}

async function rawSelect(
  message: string,
  options: SelectOption[]
): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  let selectedIndex = 0;

  const cleanup = () => {
    try { stdin.setRawMode(false); } catch {}
    stdin.pause();
    stdin.removeAllListeners('data');
    for (let i = 0; i <= options.length; i++) {
      stdout.write(`\x1B[K\n`);
    }
    stdout.write(`\x1B[${options.length + 1}A`);
    stdout.write('\x1B[?25h'); // show cursor
  };

  const render = () => {
    stdout.write('\x1B[?25l'); // hide cursor
    stdout.write(`\r\x1B[K${message}\n`);
    for (let i = 0; i < options.length; i++) {
      const prefix = i === selectedIndex ? '❯ ' : '  ';
      const highlight = i === selectedIndex ? '\x1B[36m' : '\x1B[90m';
      stdout.write(`\x1B[K${highlight}${prefix}${options[i].label}\x1B[0m\n`);
    }
    stdout.write(`\x1B[${options.length + 1}A`);
  };

  stdin.setRawMode(true);
  stdin.resume();

  try {
    render();

    return await new Promise<string>((resolve, reject) => {
      const onData = (data: Buffer) => {
        const key = data.toString();

        if (key === '\x03') {
          cleanup();
          reject(new Error('User cancelled'));
          return;
        }

        if (key === '\r' || key === '\n') {
          cleanup();
          resolve(options[selectedIndex].value);
          return;
        }

        if (key === '\x1B[A' || key === 'k') {
          selectedIndex = (selectedIndex - 1 + options.length) % options.length;
          render();
        } else if (key === '\x1B[B' || key === 'j') {
          selectedIndex = (selectedIndex + 1) % options.length;
          render();
        }
      };

      stdin.on('data', onData);
    });
  } catch (err) {
    cleanup();
    throw err;
  }
}

async function numberedSelect(
  message: string,
  options: SelectOption[]
): Promise<string> {
  const stdout = process.stdout;

  stdout.write(`${message}\n`);
  for (let i = 0; i < options.length; i++) {
    stdout.write(`  ${i + 1}) ${options[i].label}\n`);
  }
  stdout.write('Enter number: ');

  return new Promise<string>((resolve, reject) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (line: string) => {
      rl.close();
      const num = parseInt(line.trim(), 10);
      if (isNaN(num) || num < 1 || num > options.length) {
        reject(new Error(`Invalid selection: ${line.trim()}`));
        return;
      }
      resolve(options[num - 1].value);
    });

    rl.on('close', () => {
      reject(new Error('Input stream closed'));
    });
  });
}
