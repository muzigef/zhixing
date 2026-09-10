import { configureLocalSigning, listSigningIdentities, localSigningConfig } from "./macos-signing.mjs";

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === "--list")) {
  const identities = listSigningIdentities();
  const instructions = identities.length
    ? "选择知行专用证书的完整指纹，运行 npm --prefix desktop run signing:configure -- <SHA-1 指纹>，无需重复创建证书。"
    : "没有可用的代码签名身份不代表没有证书。已有证书时先检查代码签名用途、关联私钥和该用途的信任状态，不要重复创建同名证书。详见 docs/macos-local-signing.md。";
  console.log(JSON.stringify({ identities, instructions }, null, 2));
} else if (args.length === 1) {
  const fingerprint = configureLocalSigning(args[0]);
  console.log(JSON.stringify({ configured: true, fingerprint, configFile: localSigningConfig, privateKeyExported: false }));
} else throw new Error("Usage: signing:configure -- [--list | <certificate SHA-1 fingerprint>]");
