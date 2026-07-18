const REQUIRED_NODE_VERSION = "24.8";

/** Fails early so native database binaries and local evidence use one tested runtime. */
export function assertSupportedNodeVersion(version = process.versions.node): void {
  if (!version.startsWith(`${REQUIRED_NODE_VERSION}.`)) {
    throw new Error(`unsupported_node_version: 需要 Node ${REQUIRED_NODE_VERSION}.x，当前为 ${version}`);
  }
}
