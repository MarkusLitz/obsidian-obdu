import { App, Modal } from "obsidian";
import { formatBytesNcdu, getAttachmentShareForNote } from "./graph";
import { getNumberLocale, i18n } from "./i18n";
import { sanitizeDisplayString } from "./parser";
import { isSafeVaultTarget, TRASH_ROOT } from "./trash";
import { BlockMode, DeletePlan, ObduNode } from "./types";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"avif",
	"svg",
]);

const TEXT_EXTENSIONS = new Set([
	"md",
	"txt",
	"canvas",
	"base",
	"json",
	"yaml",
	"yml",
	"css",
	"js",
	"ts",
	"mjs",
	"csv",
	"xml",
]);

export class ObduInfoModal extends Modal {
	private node: ObduNode;
	private blockMode: BlockMode;
	private onAfterClose?: () => void;

	constructor(
		app: App,
		node: ObduNode,
		blockMode: BlockMode,
		onAfterClose?: () => void
	) {
		super(app);
		this.node = node;
		this.blockMode = blockMode;
		this.onAfterClose = onAfterClose;
	}

	onClose(): void {
		this.contentEl.empty();
		this.onAfterClose?.();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("obdu-modal");
		const s = i18n();
		const numLoc = getNumberLocale();

		contentEl.createEl("h3", {
			text: s.infoTitle(sanitizeDisplayString(this.node.name)),
		});

		const table = contentEl.createDiv({ cls: "obdu-info-grid" });
		const addRow = (label: string, val: string): void => {
			table.createSpan({ cls: "obdu-info-key", text: label });
			table.createSpan({ cls: "obdu-info-val", text: val });
		};

		addRow(s.infoVaultPath, this.node.relPath || "/");
		addRow(s.infoType, this.describeKind(this.node));
		addRow(
			s.infoPhysicalSize,
			`${formatBytesNcdu(this.node.apparentBytes)} (${this.node.apparentBytes.toLocaleString(numLoc)} B)`
		);
		addRow(s.infoBlockSize, formatBytesNcdu(this.node.diskBytes));

		if (this.node.kind === "note") {
			let logical = this.node.apparentBytes;
			for (const att of this.node.outgoingAttachments) {
				logical += getAttachmentShareForNote(att, this.node, this.blockMode);
			}
			addRow(s.infoLogicalSize, formatBytesNcdu(logical));
		}

		if (this.node.mtime > 0) {
			addRow(
				s.infoModifiedAt,
				new Date(this.node.mtime).toLocaleString(numLoc)
			);
		}
		if (this.node.isBookmarked) {
			addRow(s.infoBookmarked, s.infoBookmarkedVal);
		}
		if (this.node.emptyReason) {
			addRow(s.infoEmptyStatus, this.node.emptyReason);
		}

		if (this.node.kind === "note") {
			addRow(
				s.infoLocalAttachments,
				`${this.node.outgoingAttachments.length}`
			);
			addRow(
				s.infoExternalMedia,
				`${this.node.externalRefs.length}`
			);
			addRow(
				s.infoNoteRefs,
				s.infoNoteRefsVal(
					this.node.outgoingNotes.length,
					this.node.incomingNotes.length
				)
			);
			if (this.node.brokenLinks.length > 0) {
				addRow(
					s.infoBrokenLinks,
					this.node.brokenLinks.map(sanitizeDisplayString).join(", ")
				);
			}
		} else if (this.node.kind === "attachment") {
			if (this.node.incomingNoteOwners.length === 0) {
				addRow(s.infoRefs, s.infoRefsOrphanVal);
			} else {
				addRow(
					s.infoUsedIn(this.node.incomingNoteOwners.length),
					this.node.incomingNoteOwners.map((n) => n.relPath).join(", ")
				);
			}
		}

		const footer = contentEl.createDiv({ cls: "obdu-modal-footer" });
		const closeBtn = footer.createEl("button", { text: s.infoCloseBtn });
		closeBtn.addEventListener("click", () => this.close());

		this.scope.register([], "i", () => {
			this.close();
			return false;
		});
	}

	private describeKind(n: ObduNode): string {
		const s = i18n();
		if (n.kind === "dir") return n.isHidden ? s.kindSystemDir : s.kindDir;
		if (n.kind === "note") return s.kindNote(n.ext);
		if (n.kind === "attachment") return s.kindAttachment(n.ext);
		return s.kindSystemFile;
	}
}

export class ObduHelpModal extends Modal {
	private onAfterClose?: () => void;

	constructor(app: App, onAfterClose?: () => void) {
		super(app);
		this.onAfterClose = onAfterClose;
	}

	onClose(): void {
		this.contentEl.empty();
		this.onAfterClose?.();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("obdu-modal");
		const s = i18n();

		contentEl.createEl("h3", { text: s.helpTitle });

		const grid = contentEl.createDiv({ cls: "obdu-help-grid" });
		for (const [key, desc] of s.helpBindings) {
			grid.createEl("code", { cls: "obdu-help-key", text: key });
			grid.createSpan({ cls: "obdu-help-desc", text: desc });
		}

		const footer = contentEl.createDiv({ cls: "obdu-modal-footer" });
		const btn = footer.createEl("button", { text: s.helpCloseBtn });
		btn.addEventListener("click", () => this.close());

		this.scope.register([], "?", () => {
			this.close();
			return false;
		});
	}
}

export class ObduPreviewModal extends Modal {
	private node: ObduNode;
	private onAfterClose?: () => void;

	constructor(app: App, node: ObduNode, onAfterClose?: () => void) {
		super(app);
		this.node = node;
		this.onAfterClose = onAfterClose;
	}

	onClose(): void {
		this.contentEl.empty();
		this.onAfterClose?.();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("obdu-modal", "obdu-preview-modal");
		const s = i18n();

		contentEl.createEl("h3", {
			text: s.previewTitle(
				sanitizeDisplayString(this.node.relPath || this.node.name),
				formatBytesNcdu(this.node.apparentBytes)
			),
		});

		const body = contentEl.createDiv({ cls: "obdu-preview-body" });

		if (!isSafeVaultTarget(this.node.relPath) || this.node.kind === "dir") {
			body.createEl("p", {
				text: s.previewFolderDesc(this.node.children.length),
			});
		} else if (IMAGE_EXTENSIONS.has(this.node.ext)) {
			const src = this.app.vault.adapter.getResourcePath(this.node.relPath);
			body.createEl("img", {
				cls: "obdu-preview-img",
				attr: { src, alt: sanitizeDisplayString(this.node.name) },
			});
		} else if (this.node.ext === "pdf") {
			const src = this.app.vault.adapter.getResourcePath(this.node.relPath);
			body.createEl("iframe", {
				cls: "obdu-preview-pdf",
				attr: { src },
			});
		} else if (TEXT_EXTENSIONS.has(this.node.ext) && this.node.apparentBytes <= 512 * 1024) {
			void this.loadTextPreview(body);
		} else {
			body.createEl("p", {
				text: s.previewUnsupported(
					this.node.ext,
					formatBytesNcdu(this.node.apparentBytes)
				),
			});
		}

		const footer = contentEl.createDiv({ cls: "obdu-modal-footer" });
		const btn = footer.createEl("button", { text: s.previewCloseBtn });
		btn.addEventListener("click", () => this.close());

		for (const key of [" ", "p"]) {
			this.scope.register([], key, () => {
				this.close();
				return false;
			});
		}
	}

	private async loadTextPreview(body: HTMLElement): Promise<void> {
		const s = i18n();
		try {
			const text = await this.app.vault.adapter.read(this.node.relPath);
			const snippet =
				text.length > 12000
					? `${text.slice(0, 12000)}\n${s.previewTruncated}`
					: text;
			body.createEl("pre", {
				cls: "obdu-preview-text",
				text: snippet || s.previewEmptyText,
			});
		} catch {
			body.createEl("p", { text: s.previewReadError });
		}
	}
}

export class ObduSmartDeleteModal extends Modal {
	private plan: DeletePlan;
	private onConfirmDelete: (opts: {
		permanent: boolean;
		includeExclusiveAttachments: boolean;
	}) => Promise<void>;
	private onAfterClose?: () => void;

	private permanent = false;
	private includeExclusive = true;

	constructor(
		app: App,
		plan: DeletePlan,
		onConfirmDelete: (opts: {
			permanent: boolean;
			includeExclusiveAttachments: boolean;
		}) => Promise<void>,
		onAfterClose?: () => void
	) {
		super(app);
		this.plan = plan;
		this.permanent = plan.isInsideTrash;
		this.includeExclusive = plan.exclusiveAttachments.length > 0;
		this.onConfirmDelete = onConfirmDelete;
		this.onAfterClose = onAfterClose;
	}

	onClose(): void {
		this.contentEl.empty();
		this.onAfterClose?.();
	}

	onOpen(): void {
		this.render();

		this.scope.register([], "Enter", () => {
			void this.confirm();
			return false;
		});
		this.scope.register([], "y", () => {
			void this.confirm();
			return false;
		});
		this.scope.register([], "n", () => {
			this.close();
			return false;
		});
		this.scope.register([], "a", () => {
			if (this.plan.exclusiveAttachments.length > 0) {
				this.includeExclusive = !this.includeExclusive;
				this.render();
			}
			return false;
		});
		this.scope.register([], "x", () => {
			if (!this.plan.isInsideTrash) {
				this.permanent = !this.permanent;
				this.render();
			}
			return false;
		});
	}

	private async confirm(): Promise<void> {
		const opts = {
			permanent: this.permanent,
			includeExclusiveAttachments: this.includeExclusive,
		};
		this.close();
		await this.onConfirmDelete(opts);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("obdu-modal");
		const s = i18n();

		contentEl.createEl("h3", {
			text: s.deleteTitle(sanitizeDisplayString(this.plan.target.name)),
		});

		contentEl.createEl("p", {
			cls: "obdu-delete-path",
			text: s.deletePath(this.plan.target.relPath),
		});

		if (this.plan.incomingBacklinks.length > 0) {
			const warnBox = contentEl.createDiv({ cls: "obdu-warn-box" });
			warnBox.createEl("strong", {
				text: s.deleteWarnBacklinks(this.plan.incomingBacklinks.length),
			});
			const ul = warnBox.createEl("ul");
			for (const src of this.plan.incomingBacklinks.slice(0, 6)) {
				ul.createEl("li", { text: src.relPath });
			}
			if (this.plan.incomingBacklinks.length > 6) {
				ul.createEl("li", {
					text: s.deleteMoreItems(this.plan.incomingBacklinks.length - 6),
				});
			}
		}

		if (this.plan.exclusiveAttachments.length > 0) {
			const attBox = contentEl.createDiv({ cls: "obdu-option-box" });
			const label = attBox.createEl("label", { cls: "obdu-checkbox-row" });
			const cb = label.createEl("input", { type: "checkbox" });
			cb.checked = this.includeExclusive;
			cb.addEventListener("change", () => {
				this.includeExclusive = cb.checked;
				this.render();
			});
			const exBytes =
				this.plan.reclaimableBytesWithAttachments -
				this.plan.reclaimableBytesTargetOnly;
			label.createSpan({
				text: s.deleteCascadeCheckbox(
					this.plan.exclusiveAttachments.length,
					formatBytesNcdu(exBytes)
				),
			});

			const list = attBox.createEl("ul", { cls: "obdu-compact-list" });
			for (const att of this.plan.exclusiveAttachments.slice(0, 5)) {
				list.createEl("li", {
					text: `${att.relPath} (${formatBytesNcdu(att.apparentBytes)})`,
				});
			}
			if (this.plan.exclusiveAttachments.length > 5) {
				list.createEl("li", {
					text: s.deleteMoreItems(this.plan.exclusiveAttachments.length - 5),
				});
			}
		}

		if (this.plan.sharedAttachments.length > 0) {
			const sharedInfo = contentEl.createDiv({ cls: "obdu-shared-note" });
			sharedInfo.createSpan({
				text: s.deleteSharedProtected(this.plan.sharedAttachments.length),
			});
		}

		if (!this.plan.isInsideTrash) {
			const modeBox = contentEl.createDiv({ cls: "obdu-option-box" });
			const modeLabel = modeBox.createEl("label", { cls: "obdu-checkbox-row" });
			const modeCb = modeLabel.createEl("input", { type: "checkbox" });
			modeCb.checked = this.permanent;
			modeCb.addEventListener("change", () => {
				this.permanent = modeCb.checked;
				this.render();
			});
			modeLabel.createSpan({
				text: s.deletePermanentCheckbox(TRASH_ROOT),
			});
		} else {
			contentEl.createDiv({
				cls: "obdu-warn-box",
				text: s.deleteAlreadyInTrashWarn,
			});
		}

		const totalReclaim = this.includeExclusive
			? this.plan.reclaimableBytesWithAttachments
			: this.plan.reclaimableBytesTargetOnly;

		const footer = contentEl.createDiv({ cls: "obdu-modal-footer" });
		footer.createSpan({
			cls: "obdu-reclaim-summary",
			text: s.deleteScopeSummary(formatBytesNcdu(totalReclaim)),
		});

		const btnGroup = footer.createDiv({ cls: "obdu-btn-group" });
		const cancelBtn = btnGroup.createEl("button", { text: s.deleteCancelBtn });
		cancelBtn.addEventListener("click", () => this.close());

		const confirmBtn = btnGroup.createEl("button", {
			cls: "mod-warning",
			text: this.permanent
				? s.deleteConfirmPermanentBtn
				: s.deleteConfirmTrashBtn,
		});
		confirmBtn.addEventListener("click", () => {
			void this.confirm();
		});
	}
}
