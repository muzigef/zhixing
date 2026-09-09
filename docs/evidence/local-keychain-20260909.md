# 2026-09-09 本机钥匙串与系统加密补验

**结论：已安装的知行 0.9.0 在当前 macOS 用户下通过本机系统加密验收，原“等待系统授权”的当前待办关闭。** 本轮没有修改源码或重新安装应用。原有失败记录及其他安装快照的结果保持不变。

应用位于 `~/Applications/知行.app`，冻结来源 `e0efa006a7d0a48a46044fee48d4aba44e44bb9f`，codeHash `7b1491e4f0403e6bbbe1672cb2ea50cd28df45db7fe2f77a321b3637656881c6`。启动前 `codesign --verify --deep --strict` 退出 0；版本和 app.asar 哈希另见[机器回执](local-keychain-20260909.json)。应用未重新签名。

## 实际执行

2026-09-09 14:09（北京时间），使用已安装应用和独立临时数据目录进行三步检查，退出码 0：

| 检查 | 结果 |
| --- | --- |
| Electron 原生 safeStorage 加密、解密 | 原生能力可用，合成字符串往返一致，密文不含该明文；约 9.2 秒 |
| 通过应用的 configure-deepseek IPC 保存合成配置 | 使用安装包内实际加密存储实现；独立目录中的密文文件权限 0600，未出现合成明文；33 ms |
| 退出、重新启动同一个安装应用后读取 | 配置来源仍为 desktop，读取刚才的合成密文并经原生 safeStorage 解密，值相同；12 ms |

随后执行原有验收门禁，仍针对同一安装应用，退出码 0：

```sh
ZHIXING_DESKTOP_NATIVE_CIPHER=1 \
ZHIXING_DESKTOP_LIVE_CHECK=0 \
ZHIXING_DESKTOP_EXECUTABLE="$HOME/Applications/知行.app/Contents/MacOS/知行" \
node desktop/scripts/smoke.mjs
```

实际输出同时包含 `Native cipher passed` 与 `Desktop UI passed`，原生加密在现有 20 秒等待期限内通过。不是只验证配置状态或 mock cipher。合成存储探针原文、日志及哈希保存在机器回执及其关联的 `.txt` 文件中；探针是本次本机执行的历史记录，路径不可直接套用到其他机器。

## 范围与数据处理

- 启动后核对实际 userData 必须等于新建临时目录；两次启动使用同一目录以验证持久化，最后只清理这个临时目录。
- Pi 指向独立空测试目录，真实模型调用禁用，旧 Keychain 配置复用禁用；未读取用户 API Key、Pi 认证或聊天资料。
- 合成配置不是有效 API Key，仅用于存储验证。没有验证真实密钥有效性，也没有向 DeepSeek 发送请求。
- 已提示用户处理可能出现的系统窗口。工具没有读取或操作 SecurityAgent，未记录用户选了哪个授权按钮；成功依据是实际加解密与重启结果。
- 本次证明当前应用签名身份及当前本机用户可使用系统加密。未来应用重签名、用户或钥匙串环境变化时，系统可能重新询问，应按实际状态复验。

文档更新后执行完整 `CI=1 npm run verify`：131 个测试文件、631 项测试，另跑 integration 9 项和 eval 6 项，全部通过；新增文档链接、探针/日志哈希、安装包未变更核对和敏感模式扫描通过。

本机系统授权不再列为当前阻塞。真实教学效果与正式签名、公证仍待相应条件；独立子 Agent 继续按用户要求暂缓。
