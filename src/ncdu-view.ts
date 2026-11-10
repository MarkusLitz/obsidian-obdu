import { ItemView, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";
import {
	formatBytesNcdu,
	getAttachmentShareForNote,
	getNodeBadge,
	getNodeFlag,
	getRawNodeSize,
	normalizeVaultRelPath,
	recomputeDisplaySizes,
} from "./graph";
import { i18n } from "./i18n";
import type ObduPlugin from "./main";
import {
	ObduHelpModal,
	ObduInfoModal,
	ObduPreviewModal,
	ObduSmartDeleteModal,
} from "./modals";
import { sanitizeDisplayString } from "./parser";
import { buildDeletePlan, isSafeVaultTarget } from "./trash";
import {
	BarStyle,
	BlockMode,
	DisplayRow,
	NavFrame,
	ObduNode,
	OrphanScope,
	SizeMode,
	SortKey,
	VaultGraph,
	VIEW_TYPE_OBDU,
	ViewTab,
} from "./types";

const BAR_WIDTH = 12;

export class ObduNcduView extends ItemView {
	private plugin: ObduPlugin;
	private graph: VaultGraph | null = null;
	private isLoading = false;

	private viewTab: ViewTab = "tree";
	private orphanScope: OrphanScope = "attachments";
	private sizeMode: SizeMode;
	private blockMode: BlockMode = "apparent";
	private showHidden: boolean;
	private showCounts = false;
	private barStyle: BarStyle;
	private sortKey: SortKey = "size";
	private sortAsc = false;

	private currentMode: "dir" | "note" | "attachment" = "dir";
	private currentPath = "";
	private navStack: NavFrame[] = [];

	private filterActive = false;
	private filterQuery = "";

	private rows: DisplayRow[] = [];
	private selectedIndex = 0;

	private rootWrapperEl!: HTMLElement;
	private listBodyEl!: HTMLElement;
	private filterInputEl: HTMLInputElement | null = null;

	private collator = new Intl.Collator(undefined, {
		numeric: true,
		sensitivity: "base",
	});

	constructor(leaf: WorkspaceLeaf, plugin: ObduPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.sizeMode = plugin.settings.defaultSizeMode;
		this.showHidden = plugin.settings.defaultShowHidden;
		this.barStyle = plugin.settings.defaultBarStyle;
	}

	getViewType(): string {
		return VIEW_TYPE_OBDU;
	}

	getDisplayText(): string {
		return i18n().viewDisplayText;
	}

	getIcon(): string {
		return "hard-drive";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("obdu-view-content");

		this.rootWrapperEl = this.contentEl.createDiv({
			cls: "obdu-terminal",
			attr: { tabindex: "0" },
		});

		// Listen at window level while this obdu leaf is active and no modal/input is open,
		// ensuring 100% uninterrupted ncdu keyboard navigation even after modal closes or tab switches.
		this.registerDomEvent(window, "keydown", (evt: KeyboardEvent) => {
			if (this.app.workspace.getActiveViewOfType(ObduNcduView) !== this) {
				return;
			}
			if (
				document.querySelector(
					".modal-container, .prompt, .suggestion-container"
				)
			) {
				return;
			}
			const activeEl = document.activeElement as HTMLElement | null;
			if (
				activeEl &&
				(activeEl.tagName === "INPUT" ||
					activeEl.tagName === "TEXTAREA" ||
					activeEl.isContentEditable)
			) {
				return;
			}
			this.handleKeyDown(evt);
		});

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) {
					this.focusTerminal();
				}
			})
		);

		await this.rescanVault();
		this.focusTerminal();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	focusTerminal(): void {
		window.setTimeout(() => {
			if (!this.filterActive && this.rootWrapperEl?.isConnected) {
				this.rootWrapperEl.focus({ preventScroll: true });
			}
		}, 10);
	}

	async openAtFolderOrFile(relPath: string): Promise<void> {
		if (!this.graph) {
			await this.rescanVault();
		}
		if (!this.graph) {
			return;
		}
		const norm = normalizeVaultRelPath(relPath);
		const node = this.graph.nodesByPath.get(norm);
		this.viewTab = "tree";
		this.navStack = [];
		if (!node) {
			this.currentMode = "dir";
			this.currentPath = "";
		} else if (node.kind === "dir") {
			this.currentMode = "dir";
			this.currentPath = node.relPath;
		} else {
			this.currentMode = "dir";
			this.currentPath = node.parent?.relPath ?? "";
		}
		this.selectedIndex = 0;
		this.rebuildAndRender(
			node && node.kind !== "dir" ? `node:${node.relPath}` : undefined
		);
		this.focusTerminal();
	}

	async switchToTab(tab: ViewTab): Promise<void> {
		if (!this.graph) {
			await this.rescanVault();
		}
		this.viewTab = tab;
		this.selectedIndex = 0;
		this.rebuildAndRender();
		this.focusTerminal();
	}

	async rescanVault(preserveSelectionKey?: string): Promise<void> {
		if (this.isLoading) {
			return;
		}
		const keepKey = preserveSelectionKey ?? this.rows[this.selectedIndex]?.key;
		this.isLoading = true;
		this.renderLoading();
		try {
			this.graph = await this.plugin.scanner.scanVault();
			if (this.currentPath && !this.graph.nodesByPath.has(this.currentPath)) {
				this.currentMode = "dir";
				this.currentPath = "";
				this.navStack = [];
			}
			this.recalculateSizes();
			this.rebuildAndRender(keepKey);
		} finally {
			this.isLoading = false;
		}
	}

	private recalculateSizes(): void {
		if (!this.graph) {
			return;
		}
		recomputeDisplaySizes(
			this.graph.root,
			this.graph.allFiles,
			this.sizeMode,
			this.blockMode,
			this.showHidden
		);
	}

	private renderLoading(): void {
		if (!this.rootWrapperEl) {
			return;
		}
		const s = i18n();
		this.rootWrapperEl.empty();
		const box = this.rootWrapperEl.createDiv({ cls: "obdu-loading" });
		box.createDiv({
			cls: "obdu-loading-title",
			text: s.loadingTitle,
		});
		box.createDiv({
			cls: "obdu-loading-sub",
			text: s.loadingSub,
		});
	}

	private rebuildAndRender(preferredKey?: string): void {
		if (!this.graph || !this.rootWrapperEl) {
			return;
		}

		this.rows = this.computeRows();
		if (preferredKey) {
			const idx = this.rows.findIndex((r) => r.key === preferredKey);
			if (idx >= 0) {
				this.selectedIndex = idx;
			}
		}
		if (this.selectedIndex >= this.rows.length) {
			this.selectedIndex = Math.max(0, this.rows.length - 1);
		}
		if (this.selectedIndex < 0) {
			this.selectedIndex = 0;
		}

		this.renderView();
	}

	private computeRows(): DisplayRow[] {
		if (!this.graph) {
			return [];
		}

		let rawRows: DisplayRow[] = [];

		if (this.viewTab === "tree") {
			rawRows = this.buildTreeModeRows();
		} else if (this.viewTab === "orphans") {
			rawRows = this.buildOrphansTabRows();
		} else if (this.viewTab === "largest") {
			rawRows = this.buildLargestFilesRows();
		} else {
			rawRows = this.buildIssuesTabRows();
		}

		const q = this.filterQuery.trim().toLowerCase();
		if (!q) {
			return rawRows;
		}
		return rawRows.filter(
			(r) =>
				r.role === "parent" ||
				r.label.toLowerCase().includes(q) ||
				r.badge.toLowerCase().includes(q)
		);
	}

	private buildTreeModeRows(): DisplayRow[] {
		const graph = this.graph!;
		const target = graph.nodesByPath.get(this.currentPath) ?? graph.root;
		const rows: DisplayRow[] = [];

		if (this.navStack.length > 0 || target.relPath !== "") {
			rows.push({
				key: "parent:..",
				role: "parent",
				flag: " ",
				bytes: 0,
				showBar: false,
				label: "/..",
				badge: "",
			});
		}

		if (this.currentMode === "dir") {
			const children = target.children.filter(
				(c) => this.showHidden || !c.isHidden
			);
			this.sortNodes(children);
			for (const child of children) {
				const prefix = child.kind === "dir" ? "/" : "";
				rows.push({
					key: `node:${child.relPath}`,
					role: "tree-node",
					flag: getNodeFlag(child),
					bytes: child.displayBytes,
					itemCount: child.visibleItemCount,
					showBar: true,
					label: `${prefix}${sanitizeDisplayString(child.name)}`,
					badge: getNodeBadge(child, this.sizeMode),
					node: child,
				});
			}
			return rows;
		}

		const s = i18n();

		if (this.currentMode === "note") {
			const selfBytes = getRawNodeSize(target, this.blockMode);
			rows.push({
				key: `self:${target.relPath}`,
				role: "note-self",
				flag: target.emptyReason ? "e" : " ",
				bytes: selfBytes,
				itemCount: 1,
				showBar: true,
				label: s.rowNoteSelfLabel(sanitizeDisplayString(target.name)),
				badge: target.emptyReason || s.rowNoteSelfBadge,
				node: target,
			});

			for (const att of target.outgoingAttachments) {
				const share = getAttachmentShareForNote(att, target, this.blockMode);
				const full = getRawNodeSize(att, this.blockMode);
				const owners = att.incomingNoteOwners.length;
				const badge =
					owners > 1
						? s.rowNoteAttachmentSharedBadge(
								owners,
								formatBytesNcdu(full),
								att.relPath
							)
						: att.relPath;
				rows.push({
					key: `att:${att.relPath}`,
					role: "note-attachment",
					flag: owners > 1 ? "S" : " ",
					bytes: this.sizeMode === "logical" ? share : full,
					itemCount: 1,
					showBar: true,
					label: s.rowNoteAttachmentLabel(sanitizeDisplayString(att.name)),
					badge,
					node: att,
				});
			}

			for (const ext of target.externalRefs) {
				const tag =
					ext.provider === "gdrive" ? "Google Drive" : s.rowExternalWebMedia;
				rows.push({
					key: `ext:${ext.url}`,
					role: "note-external",
					flag: "@",
					bytes: 0,
					showBar: false,
					label: s.rowExternalLabel(ext.label),
					badge: s.rowExternalZeroBytes(tag),
					externalRef: ext,
				});
			}

			for (const outNote of target.outgoingNotes) {
				rows.push({
					key: `out:${outNote.relPath}`,
					role: "note-outgoing",
					flag: ">",
					bytes: outNote.displayBytes,
					showBar: false,
					label: s.rowOutgoingNoteLabel(
						sanitizeDisplayString(outNote.relPath)
					),
					badge: s.rowOutgoingNoteBadge,
					node: outNote,
				});
			}

			for (const inNote of target.incomingNotes) {
				rows.push({
					key: `in:${inNote.relPath}`,
					role: "note-backlink",
					flag: "<",
					bytes: inNote.displayBytes,
					showBar: false,
					label: s.rowBacklinkNoteLabel(
						sanitizeDisplayString(inNote.relPath)
					),
					badge: s.rowBacklinkNoteBadge,
					node: inNote,
				});
			}

			for (const broken of target.brokenLinks) {
				rows.push({
					key: `broken:${broken}`,
					role: "note-broken",
					flag: "!",
					bytes: 0,
					showBar: false,
					label: s.rowBrokenLinkLabel(sanitizeDisplayString(broken)),
					badge: s.rowBrokenLinkBadge,
					brokenTarget: broken,
				});
			}

			return rows;
		}

		const attBytes = getRawNodeSize(target, this.blockMode);
		rows.push({
			key: `self:${target.relPath}`,
			role: "note-self",
			flag: getNodeFlag(target),
			bytes: attBytes,
			itemCount: 1,
			showBar: true,
			label: s.rowAttachmentSelfLabel(sanitizeDisplayString(target.relPath)),
			badge:
				target.incomingNoteOwners.length === 0
					? s.rowAttachmentOrphanBadge
					: s.rowAttachmentReferencedBadge(target.incomingNoteOwners.length),
			node: target,
		});

		for (const owner of target.incomingNoteOwners) {
			rows.push({
				key: `owner:${owner.relPath}`,
				role: "attachment-owner",
				flag: "<",
				bytes: owner.displayBytes,
				showBar: false,
				label: s.rowAttachmentOwnerLabel(sanitizeDisplayString(owner.relPath)),
				badge: s.rowAttachmentOwnerBadge,
				node: owner,
			});
		}

		return rows;
	}

	private buildOrphansTabRows(): DisplayRow[] {
		const graph = this.graph!;
		const candidates: ObduNode[] = [];
		for (const f of graph.allFiles) {
			if (f.isHidden || f.kind === "system" || f.isBookmarked) {
				continue;
			}
			if (f.kind === "attachment" && f.incomingNoteOwners.length === 0) {
				if (this.orphanScope === "attachments" || this.orphanScope === "all") {
					candidates.push(f);
				}
			} else if (
				f.kind === "note" &&
				f.incomingNotes.length === 0 &&
				(this.orphanScope === "notes" || this.orphanScope === "all")
			) {
				candidates.push(f);
			}
		}

		const sorted = [...candidates].sort((a, b) => {
			const sa = getRawNodeSize(a, this.blockMode);
			const sb = getRawNodeSize(b, this.blockMode);
			return this.compareBySort(a, b, sa, sb);
		});

		return sorted.map((f) => ({
			key: `orphan:${f.relPath}`,
			role: "tree-node",
			flag: f.kind === "attachment" ? "O" : " ",
			bytes: getRawNodeSize(f, this.blockMode),
			itemCount: 1,
			showBar: true,
			label: sanitizeDisplayString(f.relPath),
			badge: f.kind === "attachment" ? "orphan attachment" : "0 backlinks",
			node: f,
		}));
	}

	private buildLargestFilesRows(): DisplayRow[] {
		const graph = this.graph!;
		const candidates = graph.allFiles.filter(
			(f) => this.showHidden || !f.isHidden
		);

		const sorted = [...candidates].sort((a, b) => {
			const sa =
				this.sizeMode === "logical" && a.kind === "note"
					? a.displayBytes
					: getRawNodeSize(a, this.blockMode);
			const sb =
				this.sizeMode === "logical" && b.kind === "note"
					? b.displayBytes
					: getRawNodeSize(b, this.blockMode);
			return sb - sa || this.collator.compare(a.relPath, b.relPath);
		});

		return sorted.slice(0, 200).map((node) => {
			const bytes =
				this.sizeMode === "logical" && node.kind === "note"
					? node.displayBytes
					: getRawNodeSize(node, this.blockMode);
			return {
				key: `top:${node.relPath}`,
				role: "tree-node",
				flag: getNodeFlag(node),
				bytes,
				itemCount: 1,
				showBar: true,
				label: sanitizeDisplayString(node.relPath),
				badge: getNodeBadge(node, this.sizeMode),
				node,
			};
		});
	}

	private buildIssuesTabRows(): DisplayRow[] {
		const graph = this.graph!;
		const rows: DisplayRow[] = [];

		const brokenMap = new Map<string, ObduNode[]>();
		for (const f of graph.allFiles) {
			if (f.kind === "note" && !f.isHidden && f.brokenLinks.length > 0) {
				for (const target of f.brokenLinks) {
					const arr = brokenMap.get(target) ?? [];
					arr.push(f);
					brokenMap.set(target, arr);
				}
			}
		}

		const s = i18n();
		for (const [target, sources] of Array.from(brokenMap.entries()).sort((a, b) =>
			b[1].length - a[1].length || this.collator.compare(a[0], b[0])
		)) {
			rows.push({
				key: `issue-broken:${target}`,
				role: "diagnostic-broken",
				flag: "!",
				bytes: 0,
				showBar: false,
				label: s.rowDiagnosticBrokenLabel(sanitizeDisplayString(target)),
				badge: s.rowDiagnosticBrokenBadge(
					sources.length,
					sources.map((src) => src.name).join(", ")
				),
				node: sources[0],
				brokenTarget: target,
				brokenSources: sources,
			});
		}

		const collectEmpty = (dir: ObduNode): void => {
			for (const c of dir.children) {
				if (c.isHidden) {
					continue;
				}
				if (c.emptyReason) {
					rows.push({
						key: `issue-empty:${c.relPath}`,
						role: "diagnostic-empty",
						flag: "e",
						bytes: c.apparentBytes,
						showBar: false,
						label: `${c.kind === "dir" ? "/" : ""}${sanitizeDisplayString(c.relPath)}`,
						badge: c.emptyReason,
						node: c,
					});
				}
				if (c.kind === "dir") {
					collectEmpty(c);
				}
			}
		};
		collectEmpty(graph.root);

		return rows;
	}

	private sortNodes(nodes: ObduNode[]): void {
		nodes.sort((a, b) =>
			this.compareBySort(a, b, a.displayBytes, b.displayBytes)
		);
	}

	private compareBySort(
		a: ObduNode,
		b: ObduNode,
		sizeA: number,
		sizeB: number
	): number {
		let cmp = 0;
		switch (this.sortKey) {
			case "size":
				cmp = sizeB - sizeA;
				break;
			case "name":
				if (a.kind === "dir" && b.kind !== "dir") return -1;
				if (a.kind !== "dir" && b.kind === "dir") return 1;
				cmp = this.collator.compare(a.name, b.name);
				break;
			case "items":
				cmp = b.visibleItemCount - a.visibleItemCount;
				break;
			case "mtime":
				cmp = b.mtime - a.mtime;
				break;
		}
		if (cmp === 0) {
			cmp = this.collator.compare(a.relPath, b.relPath);
		}
		return this.sortAsc ? -cmp : cmp;
	}

	private renderView(): void {
		if (!this.graph || !this.rootWrapperEl) {
			return;
		}
		const s = i18n();
		this.rootWrapperEl.empty();

		const topBar = this.rootWrapperEl.createDiv({ cls: "obdu-topbar" });
		topBar.createSpan({
			cls: "obdu-topbar-title",
			text: s.topBarTitle,
		});

		const pills = topBar.createDiv({ cls: "obdu-topbar-pills" });
		const modePill = pills.createEl("button", {
			cls: `obdu-pill ${this.sizeMode === "logical" ? "is-active" : ""}`,
			text: this.sizeMode === "logical" ? s.pillLogical : s.pillPhysical,
		});
		modePill.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleSizeMode();
			this.focusTerminal();
		});

		const blockPill = pills.createEl("button", {
			cls: `obdu-pill ${this.blockMode === "blocks" ? "is-active" : ""}`,
			text: this.blockMode === "apparent" ? s.pillBytes : s.pillBlocks,
		});
		blockPill.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleBlockMode();
			this.focusTerminal();
		});

		const dotPill = pills.createEl("button", {
			cls: `obdu-pill ${this.showHidden ? "is-active" : ""}`,
			text: this.showHidden ? s.pillDotfilesOn : s.pillDotfilesOff,
		});
		dotPill.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleHidden();
			this.focusTerminal();
		});

		const subBar = this.rootWrapperEl.createDiv({ cls: "obdu-subbar" });
		const tabGroup = subBar.createDiv({ cls: "obdu-tabs" });

		const addTabBtn = (tab: ViewTab, label: string): void => {
			const b = tabGroup.createEl("button", {
				cls: `obdu-tab-btn ${this.viewTab === tab ? "is-selected" : ""}`,
				text: label,
			});
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				this.viewTab = tab;
				this.selectedIndex = 0;
				this.rebuildAndRender();
				this.focusTerminal();
			});
		};

		addTabBtn("tree", s.tabTree);
		addTabBtn("orphans", s.tabOrphans(this.graph.orphanAttachmentCount));
		addTabBtn("largest", s.tabLargest);
		addTabBtn("issues", s.tabIssues);

		if (this.viewTab === "orphans") {
			const scopeBtn = tabGroup.createEl("button", {
				cls: "obdu-tab-btn is-accent",
				text: s.scopeFilter(this.orphanScope),
			});
			scopeBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.cycleOrphanScope();
				this.focusTerminal();
			});
		}

		const pathLine = subBar.createDiv({ cls: "obdu-pathline" });
		pathLine.setText(`--- ${this.describeCurrentLocation()} ---`);

		if (Platform.isMobile) {
			const touchBar = this.rootWrapperEl.createDiv({ cls: "obdu-touchbar" });
			const mkTouch = (lbl: string, fn: () => void): void => {
				const btn = touchBar.createEl("button", {
					cls: "obdu-touch-btn",
					text: lbl,
				});
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					fn();
				});
			};
			mkTouch(s.touchBack, () => this.navigateBack());
			mkTouch(s.touchOpen, () => this.activateSelectedRow());
			mkTouch(s.touchInfo, () => this.openInfoForSelected());
			mkTouch(s.touchPreview, () => this.openPreviewForSelected());
			mkTouch(s.touchTab, () => void this.openSelectedInObsidian());
			mkTouch(s.touchDelete, () => this.promptDeleteSelected());
		}

		if (this.filterActive || this.filterQuery) {
			const filterBar = this.rootWrapperEl.createDiv({ cls: "obdu-filterbar" });
			filterBar.createSpan({ cls: "obdu-filter-prefix", text: "/" });
			this.filterInputEl = filterBar.createEl("input", {
				cls: "obdu-filter-input",
				type: "text",
				value: this.filterQuery,
				placeholder: s.filterPlaceholder,
			});
			this.filterInputEl.addEventListener("input", () => {
				this.filterQuery = this.filterInputEl?.value ?? "";
				this.selectedIndex = 0;
				this.rows = this.computeRows();
				this.renderRowsOnly();
			});
			this.filterInputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter" || evt.key === "ArrowDown") {
					evt.preventDefault();
					evt.stopPropagation();
					this.filterActive = false;
					this.focusTerminal();
				} else if (evt.key === "Escape") {
					evt.preventDefault();
					evt.stopPropagation();
					this.filterQuery = "";
					this.filterActive = false;
					this.rebuildAndRender();
					this.focusTerminal();
				}
			});
			if (this.filterActive) {
				window.setTimeout(() => this.filterInputEl?.focus(), 0);
			}
		}

		this.listBodyEl = this.rootWrapperEl.createDiv({ cls: "obdu-list" });
		this.renderRowsOnly();

		const footer = this.rootWrapperEl.createDiv({ cls: "obdu-footer" });
		const totalSize = this.graph.root.displayBytes;
		footer.createSpan({
			cls: "obdu-footer-stats",
			text: s.footerStats(
				formatBytesNcdu(totalSize),
				this.graph.orphanAttachmentCount,
				formatBytesNcdu(this.graph.orphanAttachmentBytes),
				this.sortKey,
				this.sortAsc ? "↑" : "↓"
			),
		});
		footer.createSpan({
			cls: "obdu-footer-hints",
			text: s.footerHints,
		});
	}

	private renderRowsOnly(): void {
		if (!this.listBodyEl) {
			return;
		}
		this.listBodyEl.empty();

		if (this.rows.length === 0) {
			this.listBodyEl.createDiv({
				cls: "obdu-empty-state",
				text: i18n().emptyListState,
			});
			return;
		}

		let maxBytes = 0;
		let sumBytes = 0;
		for (const r of this.rows) {
			if (r.showBar) {
				if (r.bytes > maxBytes) {
					maxBytes = r.bytes;
				}
				sumBytes += r.bytes;
			}
		}

		this.rows.forEach((row, idx) => {
			const rowEl = this.listBodyEl.createDiv({
				cls: `obdu-row ${idx === this.selectedIndex ? "is-selected" : ""} flag-${this.flagCssSuffix(row.flag)}`,
			});

			rowEl.createSpan({
				cls: "obdu-col-flag",
				text: row.flag,
			});

			rowEl.createSpan({
				cls: "obdu-col-size",
				text: row.role === "parent" ? "" : formatBytesNcdu(row.bytes),
			});

			if (this.barStyle !== "none") {
				rowEl.createSpan({
					cls: "obdu-col-bar",
					text: row.showBar
						? this.formatNcduBar(row.bytes, maxBytes, sumBytes)
						: "",
				});
			}

			if (this.showCounts) {
				rowEl.createSpan({
					cls: "obdu-col-count",
					text:
						row.itemCount !== undefined && row.role !== "parent"
							? `${row.itemCount}`
							: "",
				});
			}

			rowEl.createSpan({
				cls: `obdu-col-name ${row.node?.kind === "dir" || row.role === "parent" ? "is-dir" : ""} ${row.node?.kind === "note" ? "is-note" : ""} ${row.node?.isHidden ? "is-hidden-entry" : ""}`,
				text: row.label,
			});

			if (row.badge) {
				rowEl.createSpan({
					cls: "obdu-col-badge",
					text: row.badge,
				});
			}

			rowEl.addEventListener("pointerup", (e: PointerEvent) => {
				if (e.pointerType === "touch") {
					if (this.selectedIndex === idx) {
						this.activateSelectedRow();
					} else {
						this.selectedIndex = idx;
						this.updateSelectionHighlight();
					}
				}
			});

			rowEl.addEventListener("click", (e: MouseEvent) => {
				// Touch already handled via pointerup
				if ((e as unknown as PointerEvent).pointerType === "touch") {
					return;
				}
				this.selectedIndex = idx;
				this.updateSelectionHighlight();
				this.focusTerminal();
			});

			rowEl.addEventListener("dblclick", () => {
				this.selectedIndex = idx;
				this.activateSelectedRow();
			});

			if (idx === this.selectedIndex) {
				window.requestAnimationFrame(() => {
					rowEl.scrollIntoView({ block: "nearest" });
				});
			}
		});
	}

	private updateSelectionHighlight(): void {
		if (!this.listBodyEl) {
			return;
		}
		const children = this.listBodyEl.children;
		for (let i = 0; i < children.length; i++) {
			const el = children[i] as HTMLElement;
			if (i === this.selectedIndex) {
				el.addClass("is-selected");
				el.scrollIntoView({ block: "nearest" });
			} else {
				el.removeClass("is-selected");
			}
		}
	}

	private formatNcduBar(
		bytes: number,
		maxBytes: number,
		sumBytes: number
	): string {
		const pct = sumBytes > 0 ? (bytes / sumBytes) * 100 : 0;
		const pctStr = `${pct.toFixed(1).padStart(5, " ")}%`;
		const filled =
			maxBytes > 0 ? Math.round((bytes / maxBytes) * BAR_WIDTH) : 0;
		const hashes = "#".repeat(Math.max(0, Math.min(BAR_WIDTH, filled)));
		const spaces = " ".repeat(Math.max(0, BAR_WIDTH - hashes.length));
		const barStr = `[${hashes}${spaces}]`;

		if (this.barStyle === "both") {
			return `${pctStr} ${barStr}`;
		}
		if (this.barStyle === "bar") {
			return barStr;
		}
		if (this.barStyle === "percent") {
			return `[${pctStr}]`;
		}
		return "";
	}

	private flagCssSuffix(flag: string): string {
		switch (flag) {
			case "O":
				return "orphan";
			case "!":
				return "broken";
			case "S":
				return "shared";
			case "e":
				return "empty";
			case "@":
				return "external";
			default:
				return "normal";
		}
	}

	private describeCurrentLocation(): string {
		if (!this.graph) {
			return "/";
		}
		const s = i18n();
		const vaultPrefix = `/${this.graph.root.name}`;
		if (this.viewTab === "orphans") {
			return `${vaultPrefix} :: ${s.locOrphans}`;
		}
		if (this.viewTab === "largest") {
			return `${vaultPrefix} :: ${s.locLargest}`;
		}
		if (this.viewTab === "issues") {
			return `${vaultPrefix} :: ${s.locIssues}`;
		}
		const suffix = this.currentPath ? `/${this.currentPath}` : "";
		if (this.currentMode === "note") {
			return `${vaultPrefix}${suffix} ${s.locNoteInspection}`;
		}
		if (this.currentMode === "attachment") {
			return `${vaultPrefix}${suffix} ${s.locAttachmentRefs}`;
		}
		return `${vaultPrefix}${suffix}`;
	}

	private handleKeyDown(evt: KeyboardEvent): void {
		if (evt.metaKey || evt.ctrlKey || evt.altKey) {
			return;
		}

		const key = evt.key;
		switch (key) {
			case "ArrowDown":
			case "j":
				evt.preventDefault();
				evt.stopPropagation();
				this.moveSelection(1);
				return;
			case "ArrowUp":
			case "k":
				evt.preventDefault();
				evt.stopPropagation();
				this.moveSelection(-1);
				return;
			case "PageDown":
				evt.preventDefault();
				evt.stopPropagation();
				this.moveSelection(15);
				return;
			case "PageUp":
				evt.preventDefault();
				evt.stopPropagation();
				this.moveSelection(-15);
				return;
			case "Home":
				evt.preventDefault();
				evt.stopPropagation();
				this.moveSelection(-this.rows.length);
				return;
			case "End":
				evt.preventDefault();
				evt.stopPropagation();
				this.moveSelection(this.rows.length);
				return;
			case "Enter":
			case "ArrowRight":
			case "l":
				evt.preventDefault();
				evt.stopPropagation();
				this.activateSelectedRow();
				return;
			case "Backspace":
			case "ArrowLeft":
			case "h":
				evt.preventDefault();
				evt.stopPropagation();
				this.navigateBack();
				return;
			case "m":
			case "Tab":
				evt.preventDefault();
				evt.stopPropagation();
				this.toggleSizeMode();
				return;
			case "a":
				evt.preventDefault();
				evt.stopPropagation();
				this.toggleBlockMode();
				return;
			case ".":
			case "e":
				evt.preventDefault();
				evt.stopPropagation();
				this.toggleHidden();
				return;
			case "c":
				evt.preventDefault();
				evt.stopPropagation();
				this.showCounts = !this.showCounts;
				this.renderRowsOnly();
				return;
			case "g":
				evt.preventDefault();
				evt.stopPropagation();
				this.cycleBarStyle();
				return;
			case "s":
				evt.preventDefault();
				evt.stopPropagation();
				this.setSort("size");
				return;
			case "n":
				evt.preventDefault();
				evt.stopPropagation();
				this.setSort("name");
				return;
			case "C":
				evt.preventDefault();
				evt.stopPropagation();
				this.setSort("items");
				return;
			case "M":
				evt.preventDefault();
				evt.stopPropagation();
				this.setSort("mtime");
				return;
			case "1":
				evt.preventDefault();
				evt.stopPropagation();
				void this.switchToTab("tree");
				return;
			case "2":
				evt.preventDefault();
				evt.stopPropagation();
				void this.switchToTab("orphans");
				return;
			case "3":
				evt.preventDefault();
				evt.stopPropagation();
				void this.switchToTab("largest");
				return;
			case "4":
				evt.preventDefault();
				evt.stopPropagation();
				void this.switchToTab("issues");
				return;
			case "t":
				if (this.viewTab === "orphans") {
					evt.preventDefault();
					evt.stopPropagation();
					this.cycleOrphanScope();
				}
				return;
			case "/":
				evt.preventDefault();
				evt.stopPropagation();
				this.filterActive = true;
				this.renderView();
				return;
			case "Escape":
				if (this.filterQuery) {
					evt.preventDefault();
					evt.stopPropagation();
					this.filterQuery = "";
					this.filterActive = false;
					this.rebuildAndRender();
				}
				return;
			case "i":
				evt.preventDefault();
				evt.stopPropagation();
				this.openInfoForSelected();
				return;
			case "p":
			case " ":
				evt.preventDefault();
				evt.stopPropagation();
				this.openPreviewForSelected();
				return;
			case "o":
				evt.preventDefault();
				evt.stopPropagation();
				void this.openSelectedInObsidian();
				return;
			case "f":
				evt.preventDefault();
				evt.stopPropagation();
				this.revealSelectedInFinder();
				return;
			case "d":
				evt.preventDefault();
				evt.stopPropagation();
				this.promptDeleteSelected();
				return;
			case "r":
				evt.preventDefault();
				evt.stopPropagation();
				void this.rescanVault();
				return;
			case "?":
				evt.preventDefault();
				evt.stopPropagation();
				new ObduHelpModal(this.app, () => this.focusTerminal()).open();
				return;
			case "q":
				evt.preventDefault();
				evt.stopPropagation();
				this.leaf.detach();
				return;
		}
	}

	private moveSelection(delta: number): void {
		if (this.rows.length === 0) {
			return;
		}
		const next = Math.max(
			0,
			Math.min(this.rows.length - 1, this.selectedIndex + delta)
		);
		if (next !== this.selectedIndex) {
			this.selectedIndex = next;
			this.updateSelectionHighlight();
		}
	}

	private activateSelectedRow(): void {
		const row = this.rows[this.selectedIndex];
		if (!row) {
			return;
		}
		if (row.role === "parent") {
			this.navigateBack();
			return;
		}
		if (row.role === "note-external" && row.externalRef) {
			window.open(row.externalRef.url, "_blank", "noopener,noreferrer");
			return;
		}
		if (row.role === "note-self" && row.node) {
			void this.openNodeInObsidian(row.node);
			return;
		}
		if (!row.node) {
			return;
		}

		if (this.viewTab === "tree") {
			this.navStack.push({
				mode: this.currentMode,
				targetPath: this.currentPath,
				selectedRowKey: row.key,
				scrollTop: this.listBodyEl?.scrollTop ?? 0,
			});
		} else {
			this.viewTab = "tree";
			this.navStack = [
				{
					mode: "dir",
					targetPath: row.node.parent?.relPath ?? "",
					selectedRowKey: `node:${row.node.relPath}`,
					scrollTop: 0,
				},
			];
		}

		if (row.node.kind === "dir") {
			this.currentMode = "dir";
			this.currentPath = row.node.relPath;
		} else if (row.node.kind === "note") {
			this.currentMode = "note";
			this.currentPath = row.node.relPath;
		} else if (row.node.kind === "attachment") {
			this.currentMode = "attachment";
			this.currentPath = row.node.relPath;
		} else {
			this.navStack.pop();
			new ObduPreviewModal(this.app, row.node, () =>
				this.focusTerminal()
			).open();
			return;
		}

		this.filterQuery = "";
		this.filterActive = false;
		this.selectedIndex = 0;
		this.rebuildAndRender();
	}

	private navigateBack(): void {
		if (this.viewTab !== "tree") {
			this.viewTab = "tree";
			this.selectedIndex = 0;
			this.rebuildAndRender();
			return;
		}
		if (this.navStack.length > 0) {
			const prev = this.navStack.pop()!;
			this.currentMode = prev.mode;
			this.currentPath = prev.targetPath;
			this.rebuildAndRender(prev.selectedRowKey);
			if (this.listBodyEl && prev.scrollTop > 0) {
				this.listBodyEl.scrollTop = prev.scrollTop;
			}
			return;
		}
		if (this.currentPath !== "" && this.graph) {
			const curNode = this.graph.nodesByPath.get(this.currentPath);
			const parentPath = curNode?.parent?.relPath ?? "";
			const prevKey = curNode ? `node:${curNode.relPath}` : undefined;
			this.currentMode = "dir";
			this.currentPath = parentPath;
			this.rebuildAndRender(prevKey);
		}
	}

	private toggleSizeMode(): void {
		this.sizeMode = this.sizeMode === "physical" ? "logical" : "physical";
		this.recalculateSizes();
		this.rebuildAndRender(this.rows[this.selectedIndex]?.key);
	}

	private toggleBlockMode(): void {
		this.blockMode = this.blockMode === "apparent" ? "blocks" : "apparent";
		this.recalculateSizes();
		this.rebuildAndRender(this.rows[this.selectedIndex]?.key);
	}

	private toggleHidden(): void {
		this.showHidden = !this.showHidden;
		this.recalculateSizes();
		this.rebuildAndRender(this.rows[this.selectedIndex]?.key);
	}

	private cycleBarStyle(): void {
		const order: BarStyle[] = ["both", "bar", "percent", "none"];
		const idx = order.indexOf(this.barStyle);
		this.barStyle = order[(idx + 1) % order.length];
		this.renderView();
	}

	private cycleOrphanScope(): void {
		const order: OrphanScope[] = ["attachments", "notes", "all"];
		const idx = order.indexOf(this.orphanScope);
		this.orphanScope = order[(idx + 1) % order.length];
		this.selectedIndex = 0;
		this.rebuildAndRender();
	}

	private setSort(key: SortKey): void {
		if (this.sortKey === key) {
			this.sortAsc = !this.sortAsc;
		} else {
			this.sortKey = key;
			this.sortAsc = key === "name";
		}
		this.rebuildAndRender(this.rows[this.selectedIndex]?.key);
	}

	private getSelectedNode(): ObduNode | null {
		const row = this.rows[this.selectedIndex];
		return row?.node ?? null;
	}

	private openInfoForSelected(): void {
		const node = this.getSelectedNode();
		if (!node) {
			return;
		}
		new ObduInfoModal(this.app, node, this.blockMode, () =>
			this.focusTerminal()
		).open();
	}

	private openPreviewForSelected(): void {
		const node = this.getSelectedNode();
		if (!node) {
			return;
		}
		new ObduPreviewModal(this.app, node, () => this.focusTerminal()).open();
	}

	private async openSelectedInObsidian(): Promise<void> {
		const row = this.rows[this.selectedIndex];
		if (row?.externalRef) {
			window.open(row.externalRef.url, "_blank", "noopener,noreferrer");
			return;
		}
		const node = this.getSelectedNode();
		if (!node) {
			return;
		}
		await this.openNodeInObsidian(node);
	}

	private async openNodeInObsidian(node: ObduNode): Promise<void> {
		const abstract = this.app.vault.getAbstractFileByPath(node.relPath);
		if (abstract instanceof TFile) {
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.openFile(abstract);
		} else {
			new Notice(i18n().noticeSystemOrTrashFile(node.relPath));
		}
	}

	private revealSelectedInFinder(): void {
		const node = this.getSelectedNode();
		if (!node || !isSafeVaultTarget(node.relPath)) {
			return;
		}
		const appWithFinder = this.app as unknown as {
			showInFolder?: (path: string) => void;
		};
		if (typeof appWithFinder.showInFolder === "function") {
			appWithFinder.showInFolder(node.relPath);
		} else {
			new Notice(i18n().noticeShowInFolderDesktopOnly);
		}
	}

	private promptDeleteSelected(): void {
		const node = this.getSelectedNode();
		if (!node || !isSafeVaultTarget(node.relPath)) {
			return;
		}
		const plan = buildDeletePlan(node);
		new ObduSmartDeleteModal(
			this.app,
			plan,
			async (opts) => {
				const s = i18n();
				const nextRow =
					this.rows[this.selectedIndex + 1] ??
					this.rows[this.selectedIndex - 1];
				const res = await this.plugin.trashService.executeDelete(
					plan,
					opts
				);
				if (!res.ok) {
					new Notice(s.noticeDeleteFailed(res.error ?? s.errUnknown));
					return;
				}
				new Notice(
					opts.permanent || plan.isInsideTrash
						? s.noticeDeletedPermanently(node.name)
						: s.noticeMovedToTrash(node.name)
				);
				if (this.currentPath === node.relPath) {
					this.navigateBack();
				}
				await this.rescanVault(nextRow?.key);
				this.focusTerminal();
			},
			() => this.focusTerminal()
		).open();
	}
}
