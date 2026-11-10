import { App, TFile, normalizePath } from "obsidian";
import { PRIMARY_NOTE_EXTENSIONS } from "./parser";
import { buildVaultGraph, hasHiddenOrSystemPath, normalizeVaultRelPath } from "./graph";
import { RawFileEntry, VaultGraph } from "./types";

const MAX_NOTE_PARSE_BYTES = 4 * 1024 * 1024;
const STAT_CONCURRENCY = 24;

interface BookmarkItemJson {
	type?: string;
	path?: string;
	items?: BookmarkItemJson[];
}

export class ObduVaultScanner {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async scanVault(): Promise<VaultGraph> {
		const [bookmarkedPaths, entries] = await Promise.all([
			this.loadBookmarkedPaths(),
			this.walkAdapter(""),
		]);

		return buildVaultGraph(this.app.vault.getName(), entries, bookmarkedPaths);
	}

	private async loadBookmarkedPaths(): Promise<Set<string>> {
		const result = new Set<string>();
		const configDir = normalizeVaultRelPath(this.app.vault.configDir);
		const bookmarksPath = normalizePath(`${configDir}/bookmarks.json`);
		try {
			if (!(await this.app.vault.adapter.exists(bookmarksPath))) {
				return result;
			}
			const raw = await this.app.vault.adapter.read(bookmarksPath);
			const parsed = JSON.parse(raw) as { items?: BookmarkItemJson[] };
			const collect = (items?: BookmarkItemJson[]): void => {
				if (!Array.isArray(items)) {
					return;
				}
				for (const item of items) {
					if (typeof item?.path === "string" && item.path.trim()) {
						result.add(normalizeVaultRelPath(item.path));
					}
					if (Array.isArray(item?.items)) {
						collect(item.items);
					}
				}
			};
			collect(parsed?.items);
		} catch {
			// Ignore missing or invalid bookmarks.json safely
		}
		return result;
	}

	private async walkAdapter(rootDir: string): Promise<RawFileEntry[]> {
		const adapter = this.app.vault.adapter;
		const entries: RawFileEntry[] = [];
		const dirQueue: string[] = [rootDir];
		const visitedDirs = new Set<string>();

		while (dirQueue.length > 0) {
			const currentDir = dirQueue.shift()!;
			const normDir = normalizeVaultRelPath(currentDir);
			if (visitedDirs.has(normDir)) {
				continue;
			}
			visitedDirs.add(normDir);

			let listed: { files: string[]; folders: string[] };
			try {
				listed = await adapter.list(normDir);
			} catch {
				continue;
			}

			for (const rawSubDir of listed.folders) {
				const subDir = normalizeVaultRelPath(rawSubDir);
				if (!subDir || visitedDirs.has(subDir)) {
					continue;
				}
				let mtime = 0;
				try {
					const st = await adapter.stat(subDir);
					mtime = st?.mtime ?? 0;
				} catch {
					// Keep mtime = 0
				}
				entries.push({
					relPath: subDir,
					name: subDir.split("/").pop() ?? subDir,
					isDir: true,
					apparentBytes: 0,
					diskBytes: 0,
					mtime,
				});
				dirQueue.push(subDir);
			}

			// Stat & optionally read active note files in bounded parallel batches
			const files = listed.files;
			for (let i = 0; i < files.length; i += STAT_CONCURRENCY) {
				const batch = files.slice(i, i + STAT_CONCURRENCY);
				const batchEntries = await Promise.all(
					batch.map(async (rawFile): Promise<RawFileEntry | null> => {
						const relPath = normalizeVaultRelPath(rawFile);
						if (!relPath) {
							return null;
						}
						try {
							const st = await adapter.stat(relPath);
							if (!st || st.type === "folder") {
								return null;
							}
							const size = Math.max(0, st.size ?? 0);
							const mtime = st.mtime ?? 0;
							const name = relPath.split("/").pop() ?? relPath;
							const extIdx = name.lastIndexOf(".");
							const ext =
								extIdx > 0 ? name.slice(extIdx + 1).toLowerCase() : "";

							let content: string | undefined;
							if (
								!hasHiddenOrSystemPath(relPath) &&
								PRIMARY_NOTE_EXTENSIONS.has(ext) &&
								size <= MAX_NOTE_PARSE_BYTES
							) {
								try {
									const abstract =
										this.app.vault.getAbstractFileByPath(relPath);
									if (abstract instanceof TFile) {
										content = await this.app.vault.cachedRead(abstract);
									} else {
										content = await adapter.read(relPath);
									}
								} catch {
									content = "";
								}
							}

							return {
								relPath,
								name,
								isDir: false,
								apparentBytes: size,
								diskBytes: size === 0 ? 0 : Math.ceil(size / 4096) * 4096,
								mtime,
								content,
							};
						} catch {
							return null;
						}
					})
				);

				for (const item of batchEntries) {
					if (item) {
						entries.push(item);
					}
				}
			}
		}

		return entries;
	}
}
