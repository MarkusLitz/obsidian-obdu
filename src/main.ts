import { Plugin, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { i18n } from "./i18n";
import { ObduNcduView } from "./ncdu-view";
import { ObduVaultScanner } from "./scanner";
import { ObduSettingTab } from "./settings";
import { ObduTrashService } from "./trash";
import { DEFAULT_SETTINGS, ObduSettings, VIEW_TYPE_OBDU } from "./types";

/**
 * Security Architecture Note:
 * `obdu` (Obsidian Plugin Edition) is a purely local, client-side Obsidian plugin operating
 * exclusively through Obsidian's sandboxed Vault & DataAdapter APIs (no HTTP server, no remote
 * API endpoints, no authentication/session cookies, no SQL database, and no file upload handlers).
 * All DOM elements are constructed strictly via safe Obsidian DOM APIs (`createEl`/`createDiv`/
 * `textContent` without `innerHTML`), and all `.trash`/delete file paths enforce strict canonical
 * vault-boundary validation (`isSafeVaultTarget`).
 *
 * TODO(security): If remote sync, cloud storage APIs, or local HTTP endpoints are ever added in
 * the future, implement server-side authentication/OAuth, MFA, CSRF tokens, rate limiting,
 * strict CSP/CORS headers, and parameterized storage queries.
 */
export default class ObduPlugin extends Plugin {
	settings: ObduSettings = { ...DEFAULT_SETTINGS };
	scanner!: ObduVaultScanner;
	trashService!: ObduTrashService;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.scanner = new ObduVaultScanner(this.app);
		this.trashService = new ObduTrashService(this.app);

		this.registerView(
			VIEW_TYPE_OBDU,
			(leaf) => new ObduNcduView(leaf, this)
		);

		this.addRibbonIcon("hard-drive", i18n().ribbonTooltip, () => {
			void this.activateObduView();
		});

		this.addCommand({
			id: "open-disk-usage",
			name: i18n().cmdOpenDiskUsage,
			callback: () => {
				void this.activateObduView();
			},
		});

		this.addCommand({
			id: "open-orphans",
			name: i18n().cmdOpenOrphans,
			callback: async () => {
				const view = await this.activateObduView();
				await view?.switchToTab("orphans");
			},
		});

		this.addCommand({
			id: "analyze-active-folder",
			name: i18n().cmdAnalyzeActiveFolder,
			callback: async () => {
				const active = this.app.workspace.getActiveFile();
				const view = await this.activateObduView();
				if (active && view) {
					await view.openAtFolderOrFile(active.path);
				}
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
				menu.addItem((item) => {
					item.setTitle(i18n().menuAnalyzeInObdu)
						.setIcon("hard-drive")
						.onClick(async () => {
							const view = await this.activateObduView();
							await view?.openAtFolderOrFile(file.path);
						});
				});
			})
		);

		this.addSettingTab(new ObduSettingTab(this.app, this));
	}

	onunload(): void {
		// Views are automatically managed by Obsidian workspace lifecycle
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<ObduSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(loaded ?? {}),
			defaultSizeMode:
				loaded?.defaultSizeMode === "logical" ? "logical" : "physical",
			defaultShowHidden:
				typeof loaded?.defaultShowHidden === "boolean"
					? loaded.defaultShowHidden
					: DEFAULT_SETTINGS.defaultShowHidden,
			defaultBarStyle:
				loaded?.defaultBarStyle === "bar" ||
				loaded?.defaultBarStyle === "percent" ||
				loaded?.defaultBarStyle === "none"
					? loaded.defaultBarStyle
					: "both",
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateObduView(): Promise<ObduNcduView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_OBDU);

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_OBDU,
				active: true,
			});
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
			if (leaf.view instanceof ObduNcduView) {
				leaf.view.focusTerminal();
				return leaf.view;
			}
		}
		return null;
	}
}
