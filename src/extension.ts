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
import { SearchResultProvider, SearchResultTreeItem, SearchResultTree } from "./resultTree";


let genarated_tmp_files: {reesult_file_path: string, search_id: string}[] = [];
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

	context.subscriptions.push(commands.registerCommand('tau.searchResult.deleteNode', (node) => { 
		searchResultProvider.deleteNode(node);
	}));
	context.subscriptions.push(commands.registerCommand('tau.searchResult.renameNode', (node) => { 
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
		unlink(element.reesult_file_path, () => { });
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

	// set up quickPick
	let qp = window.createQuickPick();
	qp.items = genarated_tmp_files
		.filter((value)=>{ 
			return fs.existsSync(value.reesult_file_path) && (!isEnabletTreeViewMode() || searchResultProvider.isExistInRoots(value.search_id));
		 })
		.map((value) => { return {label: value.search_id, description: ":history", alwaysShow: true}; });
	// set current selection text as initial value
	if(window.activeTextEditor) {
		qp.value =  window.activeTextEditor.document.getText(
						new Range(window.activeTextEditor!.selection.start, window.activeTextEditor!.selection.end));
	}
	
	qp.onDidChangeValue((value) =>{
		qp.items = [{label: value, description: ":current input"}].concat(genarated_tmp_files.map((value) => { 
			return {label: value.search_id, description: ":history", alwaysShow: true};
		}));
	});
	qp.onDidAccept(() =>{
		if(qp.selectedItems[0].description === ":history") {
			// show result file that is already exist.
			showHistory(qp.selectedItems[0].label);
			qp.dispose();
		}
		else {
			// execute search by ripgrep
			tauDetailSearch({
				sword: qp.value,
				globe: workspace.getConfiguration("tau", null).get<string>("search.default.globe"),
				raw: workspace.getConfiguration("tau", null).get<string>("quick.default.raw")
			});
			qp.dispose();
		}
	});

	// reveal quickPick for quickSearch
	qp.show();
}

function showHistory(search_id: string) :boolean {

	let succeed = true;

	if (isEnableFileViewMode()) {
		let tgt_file = genarated_tmp_files.find((value) => { return search_id === value.search_id; });
		if (tgt_file) {
			workspace.openTextDocument(Uri.file(tgt_file.reesult_file_path)).then(document => {
				window.showTextDocument(document);
			});
		}
		else {
			window.showInformationMessage(`Search result "${search_id}" was already removed. Please search again.`);
		}
	}

	if(isEnabletTreeViewMode()) {
		let tgt_root = searchResultProvider.getRoot(search_id);
		if(tgt_root) {
			treeView.reveal(tgt_root, {select: true, focus: true});
		}
		else {
			window.showInformationMessage(`Search result "${search_id}" was already removed from TreeView. Please search again.`);
		}
	}

	return succeed;
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

function isEnableFileViewMode(): Boolean {
	const result = vscode.workspace.getConfiguration("tau", null).get<Boolean>("enableFileViewMode");
	return result ? result : false;
}

function isEnabletTreeViewMode(): Boolean {
	const result = vscode.workspace.getConfiguration("tau", null).get<Boolean>("enableTreeViewMode");
	return result ? result : false;
}

function execRgCommand(input: string, options?: string[]) {

	const outfileEncoding = vscode.workspace.getConfiguration("tau", null).get<string>("outfile.encoding");

	if (isEnableFileViewMode() === false && isEnabletTreeViewMode() === false) {
		vscode.window.showInformationMessage("Both of view mode is disabled.\nEnable either or both of them from configuration.");
		return;
	}

	const search_id = getSearchId(input);
	const tmp_file_name = getTmpFileName(input);
	const file_path = path.join(tmpdir(), tmp_file_name);
	const file_uri = Uri.file(file_path);

	if (isEnableFileViewMode() === true) {
		try {
			fs.appendFileSync(file_path, "");
		}
		catch (e) {
			vscode.window.showErrorMessage(e.message);
			return;
		}

		// add to internal manage array
		genarated_tmp_files.push({ reesult_file_path: file_path, search_id: search_id });

		// show result file
		workspace.openTextDocument(file_uri).then(document => {
			window.showTextDocument(document);
		});
	}

	if (isEnabletTreeViewMode() === true) {
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
		let error: any = undefined;
		proc.stdout.on('data', (data) => {

			// STD OUT
			data = data.toString(); // buf -> string

			if (isEnabletTreeViewMode() === true && error === undefined) {
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

			if (isEnableFileViewMode() === true) {
				// convert absolute path to that of relative if necessary.
				// if(workspace.getConfiguration("rg", null).get<boolean>("enableRelativePath")) {
				// 	data = data.replace(new RegExp((vscode.workspace.workspaceFolders![0]!.uri.fsPath + path.sep).replace(/(\\|\/|\.)/g, "\\$1"), 'g'), "");
				// }
				appendFile(file_path, iconv.encode(data, outfileEncoding!), err => {
					if (err) {
						window.showErrorMessage(err.message);
					}
				});
			}
		});

		proc.stderr.on('data', (data) => {

			// STD ERROR
			data = data.toString(); // buf -> string

			if (isEnabletTreeViewMode() === true && error === undefined) {
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

			if (isEnableFileViewMode() === true) {
				// convert absolute path to that of relative if necessary.
				// if(workspace.getConfiguration("rg", null).get<boolean>("enableRelativePath")) {
				// 	data = data.replace(new RegExp((vscode.workspace.workspaceFolders![0]!.uri.fsPath + path.sep).replace(/(\\|\/|\.)/g, "\\$1"), 'g'), "");
				// }
				appendFile(file_path, iconv.encode(data, outfileEncoding!), err => {
					if (err) {
						window.showErrorMessage(err.message);
					}
				});
			}
		});

		proc.on("exit", () => {
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
		
		// bind variables to html elements
		const cheerio = require('cheerio');
		let $ = cheerio.load(getDetailSearchViewHtml(context));
		// bind current selection text
		const active_txt_editor = window.activeTextEditor;
		
		if(active_txt_editor) {
			const select_txt = active_txt_editor.document.getText(
								new Range(window.activeTextEditor!.selection.start, window.activeTextEditor!.selection.end));
			
			$("#sword").val(select_txt?select_txt:"");
		}
		// bind globe option
		$("#globe").val(workspace.getConfiguration("tau", null).get<string>("search.default.globe"));
		// bind raw option
		$("#raw").val(workspace.getConfiguration("tau", null).get<string>("search.default.raw"));

		
		// set html to webview
		wv_panel.webview.html =$.html();

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
