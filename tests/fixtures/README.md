# 测试资料夹具

`documents/` 中的资料由 `npm run fixtures:generate` 生成，均为无敏感、小体积测试数据。

- `text.pdf`：有文字层，验证 PDF 页面提取与引用。
- `scanned.pdf`：空文字层，验证 `ocr_required`。
- `many-pages.pdf`：501 页输入，验证页数配额拒绝。
- `encrypted.pdf`：预生成的加密 PDF，验证 `encrypted_pdf` 分类。
- `invalid.pdf`：损坏输入，验证解析失败与回滚。
- `notes.md`：Markdown 分块与 anchor 引用。

真实用户资料、`inbox/`、`data/` 和 `db/` 不得作为自动化测试 fixture。
