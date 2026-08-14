<img width="1440" height="898" alt="image" src="https://github.com/user-attachments/assets/e8327743-5bd0-4fe2-90f5-a9060794566b" />
<img width="381" height="370" alt="image" src="https://github.com/user-attachments/assets/767c91e4-9f7c-455f-b15c-03d76d506b9b" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/289694ff-6440-4cdc-84d0-ed394bd083c7" />

# Notebook ↔ Zotero Backlink

[中文](#中文说明) | [English](#english)

An unofficial local bridge between Gemini Notebook (NotebookLM) and Zotero.

It lets researchers save Notebook content to Zotero and locate cited passages
in the corresponding PDF without uploading the Zotero library or local PDFs to
a third-party server.

### Current versions

| Component | Version / compatibility |
| --- | --- |
| Zotero add-on | 0.2.6 |
| Chrome extension | 0.2.5 (Manifest V3) |
| Zotero | Zotero 9 |
| Gemini Notebook / NotebookLM | Current web version at `notebook.google.com` and `notebooklm.google.com` |

Gemini Notebook is a continuously updated Google web service and does not have
a fixed desktop-style version number for this project to pin.

## English

### Components

- **Chrome extension** — captures selected text, open Studio notes, and cited
  source passages from Gemini Notebook.
- **Zotero add-on** — saves the captured content to the currently selected
  Zotero item or searches for the cited passage in its PDF attachment.

### Features

- Save selected Notebook text as a Zotero child note.
- Save the currently opened Studio output as a Zotero child note.
- Extract source text from a Notebook citation popup.
- Locate the cited passage in the corresponding Zotero PDF.
- Create a native Zotero highlight when PDF coordinates are available.
- Fall back to Zotero's visible search box when a native highlight cannot be
  created.

### Privacy and scope

Communication takes place locally through `127.0.0.1:23119`. The add-on only
operates on the item currently selected by the user in Zotero. The browser
cannot request arbitrary Zotero items or retrieve local Zotero files.

### Installation

#### Zotero add-on

1. Download the latest `.xpi` file from
   [Releases](https://github.com/Wang-Wen-Hui/notebook-zotero-backlink/releases).
2. In Zotero, open **Tools → Plugins**.
3. Click the gear menu and select **Install Plugin From File**.
4. Select the downloaded `.xpi` and restart Zotero.

#### Chrome extension

1. Download and extract the Chrome extension ZIP from
   [Releases](https://github.com/Wang-Wen-Hui/notebook-zotero-backlink/releases).
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing
   `manifest.json`.

### Usage

1. Select the target literature item or its PDF attachment in Zotero.
2. Open the corresponding notebook in Gemini Notebook.
3. Open the Chrome extension and choose the required action:
   - save selected text;
   - save the current Studio output; or
   - locate a cited source passage in the PDF.

To locate a citation, first click its citation number in Notebook and keep the
source popup open. If Zotero uses its search fallback, the displayed search
marks are temporary and disappear when the search box is closed.

### Build the Zotero add-on

```powershell
cd zotero-addon
pnpm install --frozen-lockfile
pnpm run lint:check
pnpm run build
```

The generated XPI is written to
`zotero-addon/.scaffold/build/notebook-zotero-backlink.xpi`.

### Compatibility

- Zotero 9
- Chrome/Chromium browsers with Manifest V3 extension support
- `notebook.google.com` and `notebooklm.google.com`

### Known limitations

- The target Zotero item must be selected manually.
- A Notebook citation popup must be open before locating its source passage.
- Changes to the Notebook web interface may require updates to the extraction
  rules.
- Batch processing of every citation in one response is not yet supported.

## 中文说明

这是一个非官方的 Gemini Notebook（NotebookLM）与 Zotero 本地桥接工具，由
Chrome 扩展和 Zotero 插件组成。

它可以将 Notebook 中选中的文字或当前打开的 Studio 生成物保存为 Zotero
子笔记，也可以提取引用弹窗中的原文，并在当前选中文献的 PDF 中定位对应位置。

当前组件版本为 Zotero 插件 **0.2.6**、Chrome 扩展 **0.2.5**，面向
**Zotero 9**。Google 的 Gemini Notebook 是持续更新的网页服务，没有固定的
桌面软件版本号；本项目支持 `notebook.google.com` 和
`notebooklm.google.com`。

浏览器与 Zotero 仅通过本机 `127.0.0.1:23119` 通信。插件只操作用户当前在
Zotero 中选中的条目，不允许浏览器读取任意 Zotero 条目或本地 PDF 文件。

详细安装与使用方法见上方 English 部分。安装包请从
[Releases](https://github.com/Wang-Wen-Hui/notebook-zotero-backlink/releases)
页面下载。

## License

[MIT](LICENSE)

This is an independent experimental project and is not affiliated with Google
or Zotero.
