import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { expect, it } from "vitest";
import { runPythonTests } from "../src/python-runner.js";

it("runs actual Python unittest through the same file/network/process boundary", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-python-boundary-")));
  const secret = path.join(root, "synthetic.txt"), escaped = path.join(root, "escaped.txt");
  await fs.writeFile(secret, "synthetic Python fixture");
  const server = net.createServer(socket => socket.end());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const script = `import unittest, os, socket, subprocess, sys
class Boundary(unittest.TestCase):
 def test_boundary(self):
  with self.assertRaises(OSError):
   open(${JSON.stringify(secret)}).read()
  with self.assertRaises(OSError):
   open(${JSON.stringify(escaped)}, 'w').write('escape')
  with self.assertRaises(OSError):
   socket.create_connection(('127.0.0.1', ${port}), timeout=0.5)
  with self.assertRaises(OSError):
   subprocess.run([sys.executable, '-I', '-S', '-c', 'print(123)'], timeout=0.5, check=True)
  with open('owned.txt', 'w') as output:
   output.write('owned')
  with open('owned.txt') as output:
   self.assertEqual(output.read(), 'owned')
`;
  try {
    const result = await runPythonTests({ "test_boundary.py": script }, ["test_boundary.py"], AbortSignal.timeout(20_000), 10_000);
    expect(result, JSON.stringify(result)).toMatchObject({ status: "completed", exitCode: 0 });
    expect(result.stderr).toContain("Ran 1 test");
    await expect(fs.stat(escaped)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
