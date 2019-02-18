# Tau Search README

Improve your search on vscode!

## Feature

You can use Tree View Mode and File View Mode:

### Tree View Mode

- Tau Tree View can hold multiple search result as root node!

### File View Mode

- You can also get the search result as a file!
- Result file will be deleted automatically when the workspace closed.<br/>
    But you can keep those files by move or rename them.

## Commands
- `Tau: Quick Search`: Search the word in workspace.
- `Tau: Detail Search`: Search the word in workspace with options.
- `Tau: Move to Next Result`: Select and show next result of Tau Tree View(Tree View Mode only).
- `Tau: Move to Previous Result`: Select and show previous result of Tau Tree View(Tree View Mode only).

## Configurations
- `tau.enableFileViewMode`: Enable to show search result as File View Mode.
- `tau.enableTreeViewMode`: Enable to show search result as Tree View Mode.
- `tau.search.encoding`: 
    Specify the text encoding for searcing.(this option conforms to "-E" option of [ripgrep](https://www.mankier.com/1/rg))
- `tau.outfile.encoding`:
    Specify the text encoding for result file.
- `tau.search.default.globe`: 
    Specify the include or exclude files for Quick Search.(this option conforms to "-g" option of [ripgrep](https://www.mankier.com/1/rg))
- `tau.search.default.raw`:
    You can set other options for Quick Search manually same as [ripgrep commandline option's format](https://www.mankier.com/1/rg).

## Tips
- In File View Mode, You shold set following configuration to avoid overwriting search result tab by another one.<br/>

```
 "workbench.editor.enablePreview": false
```

<br/>
<br/>
Happy vscoding!<br/>
Muraak.

