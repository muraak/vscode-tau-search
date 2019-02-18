'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import { ExtensionContext, commands, window, workspace, Uri, ViewColumn, WebviewPanel, StatusBarAlignment, Range, Position, TextEditorRevealType, Selection } from 'vscode';
import * as vscode from 'vscode';
import * as child_process from "child_process";
import { tmpdir } from 'os';
import * as path from 'path';
import { appendFile, unlink } from 'fs';
import * as Moment from 'moment';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { SearchResultProvider, SearchResultTreeItem } from "./resultTree";


let genarated_tmp_files: string[] = [];
let searchResultProvider = new SearchResultProvider();
let treeView : vscode.TreeView<SearchResultTreeItem>;

const rg_path = path.join(vscode.env.appRoot, "node_modules.asar.unpacked", "vscode-ripgrep", "bin", "rg");

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {

	context.subscriptions.push(commands.registerCommand('tau.test', tauTest));
	context.subscriptions.push(commands.registerCommand('tau.quickSearch', tauQuickSearch));
	context.subscriptions.push(commands.registerCommand('tau.detailSearch', () => { showDetailSearchWebView(context); }));

	// it seems to I must implement special documentLinkProvider...
	// see: https://github.com/Microsoft/vscode-extension-samples/blob/master/contentprovider-sample/src/extension.ts
	
	context.subscriptions.push(commands.registerCommand('tau.moveToNext', () => {
		if (treeView !== undefined && treeView.selection.length > 0) {
			let destNode = searchResultProvider.getNextResult(treeView.selection[0]);
			if (destNode) {
				treeView.reveal(destNode, { select: true, focus: true });
				jumpTo(destNode.file, destNode.line);
			}
		}
	}));

	context.subscriptions.push(commands.registerCommand('tau.moveToPrevious', () => {
		if (treeView !== undefined && treeView.selection.length > 0) {
			let destNode = searchResultProvider.getPreviousResult(treeView.selection[0]);
			if (destNode) {
				treeView.reveal(destNode, { select: true, focus: true });
				jumpTo(destNode.file, destNode.line);
			}
		}
	}));
	

	// bind the function to context menu of search result
	// context.subscriptions.push(commands.registerCommand('searchResult.foldSameLevelNode', (node) => { 
		// searchResultProvider.foldNodesAtSameLevel(node.contextValue, node.search_id);
	// }));

	context.subscriptions.push(commands.registerCommand('searchResult.deleteNode', (node) => { 
		searchResultProvider.deleteNode(node);
	}));
	context.subscriptions.push(commands.registerCommand('searchResult.renameNode', (node) => { 
		window.showInputBox({prompt: "input the new name."}).then((value) => {
			if(node.contextValue !== 'file') {
				if(value) {
					searchResultProvider.renameNode(node, value);
				}
			}
		});
	}));

	// bind the function executed when search result item was selected 
	commands.registerCommand("tau.jumpToSearchResult", ((file, line) => {
		jumpTo(file, line);
	}));

	// searchResultProvider = new SearchResultProvider();

	// window.registerTreeDataProvider('searchResult', searchResultProvider);
	treeView = window.createTreeView<SearchResultTreeItem>("searchResult", { treeDataProvider: searchResultProvider });
}

function jumpTo(file :string, line :number) {
	workspace.openTextDocument(Uri.file(file)).then((doc) => {
		window.showTextDocument(doc, undefined, true/*preserve focus*/).then((editor) => {
			editor.selection = new Selection(new Position(line - 1, 0), new Position(line - 1, 0));
			editor.revealRange(new Range(new Position(line - 1, 0),new Position(line - 1, 0)), TextEditorRevealType.InCenter);
			// take the focus back to result view
			commands.executeCommand("workbench.view.extension.tau-search-result");
		});
	});
}

// this method is called when your extension is deactivated
export function deactivate() {

	// !HACK
	// I did wanted to delete this temp file when this file closed in VSCode.
	// And I tried to do it by using onDidCloseTextDocument
	// but this event didn't fire when I expected to.
	// I googled it and finally realized that 
	// it seems to be troublesome (I wasted my fuckin' weekend...)

	// remove tmp files
	genarated_tmp_files.forEach(element => {
		unlink(element, () => { });
	});

	// clear
	genarated_tmp_files = [];
}

async function tauTest() {
	child_process.execFile(
		rg_path, ["--version"],
		{ encoding: "buffer" },
		(error, stdout, stderr) => {
			if (stdout) {
				window.showInformationMessage("It works fine! => " + iconv.decode(stdout, getSearchEncoding()));
			}

			if (stderr) {
				window.showErrorMessage(iconv.decode(stderr, getSearchEncoding()));
			}
		});
}

async function tauQuickSearch() {
	const result = await window.showInputBox({
		prompt: 'input the search word.',
	});

	if (result) {
		tauDetailSearch({
			sword: result,
			globe: workspace.getConfiguration("tau", null).get<string>("search.default.globe"),
			raw: workspace.getConfiguration("tau", null).get<string>("quick.default.raw")
		});
	}
}

function tauDetailSearch(options_obj: any) {

	let sword = options_obj.sword;

	if(wv_panel)
	{
		wv_panel.dispose();
	}

	if (isString(sword)) {
		let options: string[] | undefined = undefined;
		let globe = options_obj.globe;
		if (isString(globe)) {
			if(globe !== "") {
				options = globe.replace(/\s/g, '').split(",").map((value) => { return "-g " + value; });
			}
		}
		
		let raw = options_obj.raw;
		if(isString(raw)) {
			if(raw !== "") {
				if(options){
					options = options.concat(raw.split(/\s|\n/g));
				}
				else {
					options = raw.split(/\s|\n/g);
				}
			}
		}

		execRgCommand(sword, options);
	}
}

function isString(x: any): x is string {
	return typeof x === "string";
}

function execRgCommand(input: string, options?: string[]) {

	const enableFileViewMode = vscode.workspace.getConfiguration("tau", null).get<Boolean>("enableFileViewMode");
	const enableTreeViewMode = vscode.workspace.getConfiguration("tau", null).get<Boolean>("enableTreeViewMode");

	if(enableFileViewMode === false && enableTreeViewMode === false) {
		vscode.window.showInformationMessage("Both of view mode is disabled.\nEnable either or both of them from configuration.");
		return;
	}
	
	const search_id = getSearchId(input);
	const tmp_file_name = getTmpFileName(input);
	const file_path = path.join(tmpdir(), tmp_file_name);
	const file_uri = Uri.file(file_path);
	
	if(enableFileViewMode === true) {
		try {
			fs.appendFileSync(file_path, "");
		}
		catch (e) {
			vscode.window.showErrorMessage(e.message);
			return;
		}

		// add to internal manage array
		genarated_tmp_files.push(file_path);

		// show result file
		workspace.openTextDocument(file_uri).then(document => {
			window.showTextDocument(document);
		});
	}

	if(enableTreeViewMode === true) {
		// add tree to search result
		searchResultProvider.add(search_id);
		// show search result view
		commands.executeCommand("workbench.view.extension.tau-search-result");
	}

	if (workspace.workspaceFolders) {
		let dir_path: string = workspace.workspaceFolders[0].uri.fsPath;
		let args = ["--line-number", input, dir_path, "-E " + getSearchEncoding()];
		if (options) {
			args = args.concat(options);
		}

		let proc = child_process.spawn("rg", args, { shell: true, cwd: path.dirname(rg_path) });
		proc.stdout.setEncoding("utf-8");

		// Reveal status bar icon while searching.
		let icon = window.createStatusBarItem(StatusBarAlignment.Right);
		icon.color = "yellow";
		icon.text = "$(pulse)tau searching...";
		icon.show();

		// Register procedures on recive output from ripgrep.
		let error :any = undefined;
		proc.stdout.on('data', (data) => {

			// STD OUT
			data = data.toString(); // buf -> string

			if (enableTreeViewMode === true && error === undefined) {
				try {
					// update tree
					// We don't convert abs path  to rel path here 
					// because tree should know abs path of result for jumping. 
					searchResultProvider.update(search_id, data);
				} catch (e) {
					window.showErrorMessage(e.toString());
					error = e;
					searchResultProvider.refresh();
				}
			}

			if (enableFileViewMode === true) {
				// convert absolute path to that of relative if necessary.
				// if(workspace.getConfiguration("rg", null).get<boolean>("enableRelativePath")) {
				// 	data = data.replace(new RegExp((vscode.workspace.workspaceFolders![0]!.uri.fsPath + path.sep).replace(/(\\|\/|\.)/g, "\\$1"), 'g'), "");
				// }
				appendFile(file_path, data, err => {
					if (err) {
						window.showErrorMessage(err.message);
					}
				});
			}
		});

		proc.stderr.on('data', (data) => {
	
			// STD ERROR
			data = data.toString(); // buf -> string

			if (enableTreeViewMode === true && error === undefined) {
				try {
					// update tree
					// We don't convert abs path  to rel path here 
					// because tree should know abs path of result for jumping. 
					searchResultProvider.update(search_id, data);
				} catch (e) {
					window.showErrorMessage(e.toString());
					error = e;
					searchResultProvider.refresh();
				}
			}

			if (enableFileViewMode === true) {
				// convert absolute path to that of relative if necessary.
				// if(workspace.getConfiguration("rg", null).get<boolean>("enableRelativePath")) {
				// 	data = data.replace(new RegExp((vscode.workspace.workspaceFolders![0]!.uri.fsPath + path.sep).replace(/(\\|\/|\.)/g, "\\$1"), 'g'), "");
				// }
				appendFile(file_path, data, err => {
					if (err) {
						window.showErrorMessage(err.message);
					}
				});
			}
		});

		proc.on("exit", () =>{
			icon.dispose();
		});
	}
}

function getTmpFileName(sword: string): string {
	let file_name = "tau-search-result_";
	file_name += sword + "_";
	file_name += Moment().format("YYYYMMDDHHmmssSSS");
	return file_name + ".log";
}

function getSearchId(sword: string) :string {
	return sword + "_" + Moment().format("YYYYMMDDHHmmssSSS");
}

function getSearchEncoding() {
	let encoding = workspace.getConfiguration("tau", null).get<string>("search.encoding");
	return (encoding) ? encoding : "utf-8";
}

let wv_panel: WebviewPanel | undefined = undefined;

function showDetailSearchWebView(context: ExtensionContext) {

	if (wv_panel) {
		wv_panel.reveal(ViewColumn.Beside);
	}
	else {
		// create and show webview panel
		wv_panel = window.createWebviewPanel(
			"tauDetailSearch", "Tau Detail Search", ViewColumn.Beside, { enableScripts: true });
		wv_panel.webview.html = getDetailSearchViewHtml(context);

		// Handle messages from the webview
		wv_panel.webview.onDidReceiveMessage(message => {
			switch (message.command) {
				case 'detailSearch':
					tauDetailSearch(message);
					return;
			}
		});

		// Release the wv_panel when that is disposed
		wv_panel.onDidDispose(() => {
			wv_panel = undefined;
		});
	}
}

function getDetailSearchViewHtml(context: ExtensionContext) {
	return fs.readFileSync(
		Uri.file(path.join(context.extensionPath, 'html', 'detailSearch.html')).fsPath,
		'utf8');
}