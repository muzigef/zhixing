import { stdin, stdout } from "node:process";

/** Reads a secret from an interactive terminal without echoing its characters. */
export async function readHiddenSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) throw new Error("secret_input_requires_tty");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (error?: Error): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (text === "\r" || text === "\n") return done();
      if (text === "\u0003") return done(new Error("secret_input_cancelled"));
      if (text === "\u007f" || text === "\b") { value = value.slice(0, -1); return; }
      if (!text.includes("\u001b")) value += text;
    };
    stdin.on("data", onData);
  });
}
