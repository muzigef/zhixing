# 测试资料夹具

`documents/` 中的资料均为无敏感测试数据。`npm run fixtures:generate` 会生成文字/空文字层/超页数/损坏 PDF 与 Markdown；`encrypted.pdf` 是单独预置的加密夹具，不由该脚本重新生成。

- `text.pdf`：有文字层，验证 PDF 页面提取与引用。
- `scanned.pdf`：空文字层，验证 `ocr_required`。
- `many-pages.pdf`：501 页输入，验证页数配额拒绝。
- `encrypted.pdf`：预生成的加密 PDF，验证 `encrypted_pdf` 分类。
- `invalid.pdf`：损坏输入，验证解析失败与回滚。
- `notes.md`：Markdown 分块与 anchor 引用。

真实用户资料、`inbox/`、`data/` 和 `db/` 不得作为自动化测试 fixture。
