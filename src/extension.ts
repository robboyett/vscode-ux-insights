// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
// import * as marked from 'marked'; // This line is removed as per the edit hint.

// Type representing a research file
interface ResearchFile {
    title: string;
    path: string;
    lastModified: Date;
}

// Default research folder search paths
const DEFAULT_SEARCH_PATHS = [
    './research-insights',
    './docs/research',
    './docs/ux',
    './research',
    './user-research',
    './insights'
];

// Utility to get all markdown files from a given folder
async function getMarkdownFilesFromPath(rootPath: string, folder: string): Promise<ResearchFile[]> {
    const files: ResearchFile[] = [];
    const folderUri = vscode.Uri.joinPath(vscode.Uri.file(rootPath), folder);
    try {
        const entries = await vscode.workspace.fs.readDirectory(folderUri);
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && name.endsWith('.md')) {
                const fileUri = vscode.Uri.joinPath(folderUri, name);
                const stat = await vscode.workspace.fs.stat(fileUri);
                const content = (await vscode.workspace.fs.readFile(fileUri)).toString();
                const titleMatch = content.match(/^#\s+(.+)$/m);
                files.push({
                    title: titleMatch ? titleMatch[1].trim() : name,
                    path: fileUri.fsPath,
                    lastModified: new Date(stat.mtime)
                });
            }
        }
    } catch (err) {
        // Folder may not exist, ignore
    }
    return files;
}

// Utility to auto-detect research folders in the workspace
function autoDetectResearchFolders(rootPath: string): string[] {
    const fs = require('fs');
    const keywords = [
        'research', 'ux', 'user-research', 'insights'
    ];
    const detected: string[] = [];
    try {
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const name = entry.name.toLowerCase();
                if (keywords.some(k => name.includes(k))) {
                    detected.push('./' + entry.name);
                }
            }
        }
        // Check docs/ subfolder for research-related directories
        if (entries.some((e: { isDirectory: () => boolean; name: string }) => e.isDirectory() && e.name === 'docs')) {
            const docsEntries = fs.readdirSync(path.join(rootPath, 'docs'), { withFileTypes: true });
            for (const entry of docsEntries) {
                if (entry.isDirectory()) {
                    const name = entry.name.toLowerCase();
                    if (keywords.some(k => name.includes(k))) {
                        detected.push('./docs/' + entry.name);
                    }
                }
            }
        }
    } catch (err) {
        // Ignore errors
    }
    return detected;
}

// Main function to discover research files (now uses config)
async function discoverResearchFiles(): Promise<ResearchFile[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];
    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('researchInsights');
    let searchPaths = config.get<string[]>('searchPaths', [
        './research-insights',
        './docs/research',
        './docs/ux',
        './research',
        './user-research',
        './insights'
    ]);
    const autoDetect = config.get<boolean>('autoDetect', true);
    if (autoDetect) {
        const detectedPaths = autoDetectResearchFolders(rootPath);
        // Avoid duplicates
        searchPaths = Array.from(new Set([...searchPaths, ...detectedPaths]));
    }
    let allFiles: ResearchFile[] = [];
    for (const folder of searchPaths) {
        const files = await getMarkdownFilesFromPath(rootPath, folder);
        allFiles = allFiles.concat(files);
    }
    // Sort by last modified, newest first
    return allFiles.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

const STOP_WORDS = new Set([
    'and', 'the', 'of', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'has', 'had', 'have', 'not', 'but', 'you', 'your', 'all', 'any', 'can', 'will', 'just', 'out', 'use', 'one', 'get', 'like', 'now', 'how', 'why', 'who', 'what', 'when', 'where', 'which', 'their', 'about', 'into', 'more', 'some', 'them', 'then', 'than', 'too', 'very', 'his', 'her', 'its', 'our', 'also', 'did', 'does', 'doing', 'on', 'in', 'to', 'by', 'as', 'at', 'be', 'is', 'it', 'if', 'or', 'so', 'an', 'a'
]);

function fuzzyMatchScore(openFile: string, researchFile: ResearchFile): number {
    // Get base name of open file (no extension)
    const openBase = openFile.split(/[\\/]/).pop()?.split('.')[0] || '';
    const openWords = openBase.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    const researchWords = (researchFile.title + ' ' + researchFile.path)
        .toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    for (const ow of openWords) {
        if (researchWords.includes(ow)) {
            return 100; // Only count as relevant if there is at least one exact word match
        }
    }
    return 0;
}

class SectionHeaderTreeItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'section-header';
        this.iconPath = new vscode.ThemeIcon('symbol-keyword');
        // Removed invalid 'selectable' property
    }
}

// Tree item for research files
class ResearchFileTreeItem extends vscode.TreeItem {
    constructor(public readonly file: ResearchFile) {
        super(file.title, vscode.TreeItemCollapsibleState.None);
        // Show source folder as a badge in the description
        const folder = vscode.workspace.asRelativePath(file.path).split(/[\\/]/)[0];
        this.tooltip = `${file.title}\n${file.path}`;
        this.description = `[${folder}] • ${file.lastModified.toLocaleDateString()}`;
        this.resourceUri = vscode.Uri.file(file.path);
        this.command = {
            command: 'ux-insights.openResearchFile',
            title: 'Open Research File',
            arguments: [file.path]
        };
    }
}

class RefreshTreeItem extends vscode.TreeItem {
    constructor() {
        super('Refresh', vscode.TreeItemCollapsibleState.None);
        this.command = {
            command: 'ux-insights.refreshResearchFiles',
            title: 'Refresh Research Files'
        };
        this.iconPath = new vscode.ThemeIcon('refresh');
    }
}

// TreeDataProvider for research files
class ResearchInsightsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;
    private researchFiles: ResearchFile[] = [];
    private watchers: vscode.FileSystemWatcher[] = [];
    private relevantFiles: ResearchFile[] = [];
    private lastOpenFile: string | undefined;

    constructor() {
        this.refresh();
        this.setupWatchers();
        vscode.window.onDidChangeActiveTextEditor(() => this.updateRelevance());
        this.updateRelevance();
    }

    async refresh(): Promise<void> {
        this.researchFiles = await discoverResearchFiles();
        // Sort by last modified, newest first
        this.researchFiles.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
        await this.updateRelevance();
        this._onDidChangeTreeData.fire();
        this.disposeWatchers();
        this.setupWatchers();
    }

    async updateRelevance() {
        const editor = vscode.window.activeTextEditor;
        const openFile = editor && editor.document && editor.document.fileName ? editor.document.fileName : '';
        if (openFile === this.lastOpenFile) return;
        this.lastOpenFile = openFile;
        if (!openFile) {
            this.relevantFiles = [];
        } else {
            // Compute strict exact word matches
            const scored = this.researchFiles.map(f => ({ f, score: fuzzyMatchScore(openFile, f) }));
            this.relevantFiles = scored.filter(s => s.score > 0)
                .map(s => s.f);
        }
        this._onDidChangeTreeData.fire();
        this.updateStatusBar();
    }

    updateStatusBar() {
        if (!statusBarItem) return;
        if (this.relevantFiles.length > 0) {
            statusBarItem.text = `$(light-bulb) Research Insight${this.relevantFiles.length > 1 ? 's' : ''} available`;
            statusBarItem.tooltip = `Relevant research file${this.relevantFiles.length > 1 ? 's' : ''} for this file. Click to view.`;
            statusBarItem.command = 'ux-insights.openResearchPanel';
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            const items: vscode.TreeItem[] = [new RefreshTreeItem()];
            if (this.relevantFiles.length > 0) {
                items.push(new SectionHeaderTreeItem('Relevant to Current File'));
                items.push(...this.relevantFiles.map(f => new ResearchFileTreeItem(f)));
            }
            items.push(new SectionHeaderTreeItem('All Research Files'));
            items.push(...this.researchFiles.map(f => new ResearchFileTreeItem(f)));
            return items;
        }
        return [];
    }

    private async setupWatchers() {
        this.disposeWatchers();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const rootPath = workspaceFolders[0].uri.fsPath;
        const config = vscode.workspace.getConfiguration('researchInsights');
        let searchPaths = config.get<string[]>('searchPaths', []);
        const autoDetect = config.get<boolean>('autoDetect', true);
        if (autoDetect) {
            const detectedPaths = autoDetectResearchFolders(rootPath);
            searchPaths = Array.from(new Set([...searchPaths, ...detectedPaths]));
        }
        for (const folder of searchPaths) {
            const absPath = vscode.Uri.joinPath(vscode.Uri.file(rootPath), folder);
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(absPath, '*.md'));
            watcher.onDidCreate(() => this.refresh());
            watcher.onDidDelete(() => this.refresh());
            watcher.onDidChange(() => this.refresh());
            this.watchers.push(watcher);
        }
    }

    private disposeWatchers() {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
    }

    dispose() {
        this.disposeWatchers();
    }
}

// Webview panel for displaying research markdown
class ResearchPanel {
    public static currentPanel: ResearchPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, filePath: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._update(filePath);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri, filePath: string) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        if (ResearchPanel.currentPanel) {
            ResearchPanel.currentPanel._panel.reveal(column);
            ResearchPanel.currentPanel._update(filePath);
        } else {
            const panel = vscode.window.createWebviewPanel(
                'researchPanel',
                'Research Insight',
                column || vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                }
            );
            ResearchPanel.currentPanel = new ResearchPanel(panel, extensionUri, filePath);
        }
    }

    public dispose() {
        ResearchPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private async _update(filePath: string) {
        try {
            const content = await util.promisify(fs.readFile)(filePath, 'utf8');
            this._panel.title = path.basename(filePath);
            this._panel.webview.html = await this._getContentHtml(content);
        } catch (err) {
            this._panel.webview.html = `<h2>Error loading file</h2><pre>${err}</pre>`;
        }
    }

    private async _getContentHtml(content: string): Promise<string> {
        const marked = await import('marked');
        const htmlContent = marked.parse(content);
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    line-height: 1.6;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                }
                h1 {
                    color: var(--vscode-textLink-foreground);
                    border-bottom: 2px solid var(--vscode-textLink-foreground);
                }
                h2 {
                    color: var(--vscode-textPreformat-foreground);
                    margin-top: 30px;
                }
                button.back-button {
                    margin-bottom: 20px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                }
            </style>
        </head>
        <body>
            ${htmlContent}
        </body>
        </html>`;
    }
}

// Command to open main research panel with file selector
type FileSelectorItem = { label: string; description: string; filePath: string };

async function showResearchFileSelector(context: vscode.ExtensionContext) {
    const files = await discoverResearchFiles();
    if (files.length === 0) {
        vscode.window.showInformationMessage('No research files found.');
        return;
    }
    const items: FileSelectorItem[] = files.map(f => ({
        label: f.title,
        description: `[${vscode.workspace.asRelativePath(f.path).split(/[\\/]/)[0]}] • ${f.lastModified.toLocaleDateString()}`,
        filePath: f.path
    }));
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a research file to view',
        matchOnDescription: true
    });
    if (pick) {
        ResearchPanel.createOrShow(context.extensionUri, pick.filePath);
    }
}

let statusBarItem: vscode.StatusBarItem | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ux-insights" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('ux-insights.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from ux-insights!');
	});

	context.subscriptions.push(disposable);

    // Register the research insights tree view
    const provider = new ResearchInsightsProvider();
    vscode.window.registerTreeDataProvider('uxInsightsSidebar', provider);

    // Register a command to refresh the tree view
    context.subscriptions.push(
        vscode.commands.registerCommand('ux-insights.refreshResearchFiles', () => provider.refresh())
    );

    // Placeholder: Register a command to open a research file (to be implemented with webview)
    context.subscriptions.push(
        vscode.commands.registerCommand('ux-insights.openResearchFile', (filePath: string) => {
            ResearchPanel.createOrShow(context.extensionUri, filePath);
        })
    );

    // Register a command to open the main research panel (file selector)
    context.subscriptions.push(
        vscode.commands.registerCommand('ux-insights.openResearchPanel', () => showResearchFileSelector(context))
    );

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.hide();
    context.subscriptions.push(statusBarItem);
}

// This method is called when your extension is deactivated
export function deactivate() {}
