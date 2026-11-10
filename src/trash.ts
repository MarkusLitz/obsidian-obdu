import type { App } from "obsidian";
import { i18n } from "./i18n";
import { DeletePlan, ObduNode } from "./types";

export const TRASH_ROOT = ".trash";

const GENERIC_ATTACHMENT_FOLDER_NAMES = new Set([
	"attachments",
	"assets",
	"_resources",
	"files",
	"media",
]);

export function normalizeSlashPath(raw: string): string {
	return raw.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Validates that a vault-relative path is strictly inside the vault root
 * with no traversal (`..`), backslashes, null bytes, or protected root deletion.
 */
export function isSafeVaultTarget(rawPath: string): boolean {
	if (!rawPath || rawPath.includes("\0") || rawPath.includes("\\")) {
		return false;
	}
	const trimmed = rawPath.trim();
	if (!trimmed || trimmed === "." || trimmed === "/" || trimmed === "..") {
		return false;
	}
	const rawSegments = trimmed.split("/");
	if (rawSegments.some((s) => !s || s === "." || s === "..")) {
		return false;
	}
	if (
		rawSegments[0].startsWith(".") &&
		rawSegments.length === 1 &&
		rawSegments[0] !== TRASH_ROOT
	) {
		return false;
	}
	return true;
}

export function collectSubtreeNodes(node: ObduNode): ObduNode[] {
	const out: ObduNode[] = [];
	const walk = (n: ObduNode): void => {
		out.push(n);
		for (const c of n.children) {
			walk(c);
		}
	};
	walk(node);
	return out;
}

export function buildDeletePlan(target: ObduNode): DeletePlan {
	const isInsideTrash =
		target.relPath === TRASH_ROOT || target.relPath.startsWith(`${TRASH_ROOT}/`);

	const subtree = collectSubtreeNodes(target);
	const deletedPaths = new Set<string>(subtree.map((n) => n.relPath));

	const exclusiveMap = new Map<string, ObduNode>();
	const sharedMap = new Map<string, ObduNode>();
	const backlinkMap = new Map<string, ObduNode>();

	let targetFileBytes = 0;
	for (const item of subtree) {
		if (item.kind !== "dir") {
			targetFileBytes += item.apparentBytes;
		}
		if (item.kind === "note") {
			for (const att of item.outgoingAttachments) {
				if (deletedPaths.has(att.relPath)) {
					continue;
				}
				const usedOutside = att.incomingNoteOwners.some(
					(owner) => !deletedPaths.has(owner.relPath)
				);
				if (usedOutside) {
					sharedMap.set(att.relPath, att);
				} else {
					exclusiveMap.set(att.relPath, att);
				}
			}
			for (const inc of item.incomingNotes) {
				if (!deletedPaths.has(inc.relPath)) {
					backlinkMap.set(inc.relPath, inc);
				}
			}
		} else if (item.kind === "attachment") {
			for (const owner of item.incomingNoteOwners) {
				if (!deletedPaths.has(owner.relPath)) {
					backlinkMap.set(owner.relPath, owner);
				}
			}
		}
	}

	let exclusiveBytes = 0;
	for (const att of exclusiveMap.values()) {
		exclusiveBytes += att.apparentBytes;
	}

	return {
		target,
		isInsideTrash,
		exclusiveAttachments: Array.from(exclusiveMap.values()).sort(
			(a, b) => b.apparentBytes - a.apparentBytes
		),
		sharedAttachments: Array.from(sharedMap.values()),
		incomingBacklinks: Array.from(backlinkMap.values()),
		reclaimableBytesTargetOnly: targetFileBytes,
		reclaimableBytesWithAttachments: targetFileBytes + exclusiveBytes,
	};
}

export class ObduTrashService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async executeDelete(
		plan: DeletePlan,
		options: { permanent: boolean; includeExclusiveAttachments: boolean }
	): Promise<{ ok: boolean; error?: string }> {
		const targetPath = plan.target.relPath;
		if (!isSafeVaultTarget(targetPath)) {
			return { ok: false, error: i18n().errInvalidTarget };
		}

		const itemsToDelete: ObduNode[] = [plan.target];
		const candidateParentFolders = new Set<string>();

		if (options.includeExclusiveAttachments && plan.exclusiveAttachments.length > 0) {
			for (const att of plan.exclusiveAttachments) {
				if (isSafeVaultTarget(att.relPath)) {
					itemsToDelete.push(att);
					if (att.parent && att.parent.relPath) {
						candidateParentFolders.add(att.parent.relPath);
					}
				}
			}
		}
		if (plan.target.parent && plan.target.parent.relPath) {
			candidateParentFolders.add(plan.target.parent.relPath);
		}

		const permanent = plan.isInsideTrash || options.permanent;

		try {
			for (const node of itemsToDelete) {
				if (permanent) {
					await this.removePermanently(node.relPath, node.kind === "dir");
				} else {
					await this.moveToVaultTrash(node.relPath);
				}
			}

			// Clean up newly emptied per-note attachment folders (protecting root attachment dirs)
			for (const folderRel of candidateParentFolders) {
				await this.cleanupEmptyAttachmentFolder(folderRel);
			}

			return { ok: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : i18n().errUnknown;
			return { ok: false, error: msg };
		}
	}

	private async moveToVaultTrash(relPath: string): Promise<void> {
		if (!isSafeVaultTarget(relPath)) {
			throw new Error(i18n().errInvalidPath);
		}
		const adapter = this.app.vault.adapter;
		const safeSource = normalizeSlashPath(relPath);
		if (!(await adapter.exists(safeSource))) {
			return;
		}

		let destPath = normalizeSlashPath(`${TRASH_ROOT}/${safeSource}`);
		if (await adapter.exists(destPath)) {
			const stamp = new Date()
				.toISOString()
				.replace(/[:.]/g, "-")
				.slice(0, 19);
			const dotIdx = destPath.lastIndexOf(".");
			const slashIdx = destPath.lastIndexOf("/");
			if (dotIdx > slashIdx + 1) {
				destPath = `${destPath.slice(0, dotIdx)} (${stamp})${destPath.slice(dotIdx)}`;
			} else {
				destPath = `${destPath} (${stamp})`;
			}
		}

		await this.ensureParentFoldersExist(destPath);
		const abstract = this.app.vault.getAbstractFileByPath?.(safeSource);
		if (abstract && this.app.fileManager?.renameFile) {
			await this.app.fileManager.renameFile(abstract, destPath);
		} else {
			await adapter.rename(safeSource, destPath);
		}
	}

	private async removePermanently(relPath: string, isDir: boolean): Promise<void> {
		if (!isSafeVaultTarget(relPath)) {
			throw new Error(i18n().errInvalidPath);
		}
		const safePath = normalizeSlashPath(relPath);
		const abstract = this.app.vault.getAbstractFileByPath?.(safePath);
		if (abstract && typeof this.app.fileManager?.trashFile === "function") {
			await this.app.fileManager.trashFile(abstract);
			return;
		}
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(safePath))) {
			return;
		}
		if (isDir) {
			await adapter.rmdir(safePath, true);
		} else {
			await adapter.remove(safePath);
		}
	}

	private async ensureParentFoldersExist(targetFilePath: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const parts = normalizeSlashPath(targetFilePath).split("/");
		parts.pop();
		let current = "";
		for (const seg of parts) {
			if (!seg || seg === "..") {
				continue;
			}
			current = current ? `${current}/${seg}` : seg;
			if (!(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
		}
	}

	private getConfiguredAttachmentRoot(): string {
		const vaultWithConfig = this.app.vault as unknown as {
			getConfig?: (key: string) => unknown;
		};
		const raw = vaultWithConfig.getConfig?.("attachmentFolderPath");
		if (typeof raw !== "string") {
			return "";
		}
		const cleaned = normalizeSlashPath(raw.replace(/^\.\//, "")).toLowerCase();
		return cleaned === "." ? "" : cleaned;
	}

	private async cleanupEmptyAttachmentFolder(folderRelPath: string): Promise<void> {
		const norm = normalizeSlashPath(folderRelPath);
		if (!norm || !isSafeVaultTarget(norm)) {
			return;
		}
		const lower = norm.toLowerCase();
		const segments = lower.split("/");
		const baseName = segments[segments.length - 1] ?? "";
		const configuredRoot = this.getConfiguredAttachmentRoot();

		// Never delete a root or category-level attachment folder itself
		if (
			GENERIC_ATTACHMENT_FOLDER_NAMES.has(baseName) ||
			(configuredRoot && lower === configuredRoot)
		) {
			return;
		}

		// Only auto-clean subfolders that reside inside an attachment directory
		const hasAttachmentAncestor =
			segments
				.slice(0, -1)
				.some((seg) => GENERIC_ATTACHMENT_FOLDER_NAMES.has(seg)) ||
			Boolean(configuredRoot && lower.startsWith(`${configuredRoot}/`));
		if (!hasAttachmentAncestor) {
			return;
		}
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(norm))) {
				return;
			}
			const listed = await adapter.list(norm);
			const nonDsFiles = listed.files.filter(
				(f) => !f.toLowerCase().endsWith("/.ds_store")
			);
			if (nonDsFiles.length === 0 && listed.folders.length === 0) {
				await adapter.rmdir(norm, true);
			}
		} catch {
			// Ignore non-critical folder cleanup errors
		}
	}
}
