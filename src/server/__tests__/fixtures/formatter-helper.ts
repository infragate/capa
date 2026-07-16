/**
 * Cross-platform stdin transform helper for tool-formatter tests.
 * Invoked as: bun <this-file> <mode>
 * Modes: replace | name | passthrough | fail | sleep
 */
export {};

const mode = process.argv[2] ?? 'passthrough';

if (mode === 'fail') {
  process.exit(1);
}

if (mode === 'sleep') {
  await Bun.sleep(5000);
  process.exit(0);
}

const input = await new Response(Bun.stdin).text();

if (mode === 'replace') {
  process.stdout.write(input.replace(/OLD/g, 'NEW'));
} else if (mode === 'name') {
  process.stdout.write(JSON.parse(input).name);
} else {
  process.stdout.write(input);
}
