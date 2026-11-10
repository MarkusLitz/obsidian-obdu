import { i18n } from "./i18n";
import { PRIMARY_NOTE_EXTENSIONS, parseNoteContent } from "./parser";
import {
	BlockMode,
	ObduNode,
	RawFileEntry,
	SizeMode,
	VaultGraph,
} from "./types";

export function normalizeVaultRelPath(p: string): string {
	const parts = p.replace(/\\/g, "/").split("/");
	const out: string[] = [];
	for (const seg of parts) {
		if (!seg || seg === ".") {
			continue;
		}
		if (seg === "..") {
			if (out.length === 0) {
				return "";
			}
			out.pop();
			continue;
		}
		out.push(seg);
	}
	return out.join("/");
}

export function isHiddenOrSystemSegment(seg: string): boolean {
	return seg.startsWith(".") || seg === "node_modules";
}

export function hasHiddenOrSystemPath(relPath: string): boolean {
	if (!relPath) {
		return false;
	}
	return relPath.split("/").some(isHiddenOrSystemSegment);
}

function getFileExtension(name: string): string {
	const idx = name.lastIndexOf(".");
	if (idx <= 0 || idx === name.length - 1) {
		return "";
	}
	return name.slice(idx + 1).toLowerCase();
}

function stripMdExtension(nameOrPath: string): string {
	return nameOrPath.toLowerCase().endsWith(".md")
		? nameOrPath.slice(0, -3)
		: nameOrPath;
}

function resolveRelativePath(baseFolder: string, relTarget: string): string | null {
	const combined = baseFolder ? `${baseFolder}/${relTarget}` : relTarget;
	const parts = combined.replace(/\\/g, "/").split("/");
	const stack: string[] = [];
	for (const seg of parts) {
		if (!seg || seg === ".") {
			continue;
		}
		if (seg === "..") {
			if (stack.length === 0) {
				return null; // Escapes vault root -> reject
			}
			stack.pop();
			continue;
		}
		stack.push(seg);
	}
	return stack.length > 0 ? stack.join("/") : null;
}

function commonPrefixScore(dirA: string, dirB: string): number {
	const a = dirA ? dirA.split("/") : [];
	const b = dirB ? dirB.split("/") : [];
	let shared = 0;
	const limit = Math.min(a.length, b.length);
	for (let i = 0; i < limit; i++) {
		if (a[i] === b[i]) {
			shared++;
		} else {
			break;
		}
	}
	return shared * 100 - Math.abs(a.length - b.length);
}

export function buildVaultGraph(
	vaultName: string,
	entries: RawFileEntry[],
	bookmarkedPaths: Set<string>
): VaultGraph {
	const root: ObduNode = {
		name: vaultName || "/",
		relPath: "",
		ext: "",
		kind: "dir",
		isHidden: false,
		apparentBytes: 0,
		diskBytes: 0,
		mtime: 0,
		parent: null,
		children: [],
		outgoingNotes: [],
		incomingNotes: [],
		outgoingAttachments: [],
		incomingNoteOwners: [],
		brokenLinks: [],
		externalRefs: [],
		isBookmarked: false,
		emptyReason: "",
		displayBytes: 0,
		visibleItemCount: 0,
	};

	const nodesByPath = new Map<string, ObduNode>();
	nodesByPath.set("", root);

	const ensureDirNode = (dirRelPath: string): ObduNode => {
		const norm = normalizeVaultRelPath(dirRelPath);
		const existing = nodesByPath.get(norm);
		if (existing) {
			return existing;
		}
		const slashIdx = norm.lastIndexOf("/");
		const parentPath = slashIdx >= 0 ? norm.slice(0, slashIdx) : "";
		const name = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;
		const parentNode = ensureDirNode(parentPath);
		const hidden = parentNode.isHidden || isHiddenOrSystemSegment(name);
		const dirNode: ObduNode = {
			name,
			relPath: norm,
			ext: "",
			kind: "dir",
			isHidden: hidden,
			apparentBytes: 0,
			diskBytes: 0,
			mtime: 0,
			parent: parentNode,
			children: [],
			outgoingNotes: [],
			incomingNotes: [],
			outgoingAttachments: [],
			incomingNoteOwners: [],
			brokenLinks: [],
			externalRefs: [],
			isBookmarked: bookmarkedPaths.has(norm),
			emptyReason: "",
			displayBytes: 0,
			visibleItemCount: 0,
		};
		parentNode.children.push(dirNode);
		nodesByPath.set(norm, dirNode);
		return dirNode;
	};

	const allFiles: ObduNode[] = [];

	for (const entry of entries) {
		const norm = normalizeVaultRelPath(entry.relPath);
		if (!norm) {
			continue;
		}
		if (entry.isDir) {
			const dirNode = ensureDirNode(norm);
			if (entry.mtime > dirNode.mtime) {
				dirNode.mtime = entry.mtime;
			}
			continue;
		}
		if (nodesByPath.has(norm)) {
			continue;
		}
		const slashIdx = norm.lastIndexOf("/");
		const parentPath = slashIdx >= 0 ? norm.slice(0, slashIdx) : "";
		const name = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;
		const parentNode = ensureDirNode(parentPath);
		const hidden = parentNode.isHidden || isHiddenOrSystemSegment(name);
		const ext = getFileExtension(name);

		let kind: ObduNode["kind"];
		if (hidden) {
			kind = "system";
		} else if (PRIMARY_NOTE_EXTENSIONS.has(ext)) {
			kind = "note";
		} else {
			kind = "attachment";
		}

		const diskBytes =
			entry.diskBytes >= 0
				? entry.diskBytes
				: entry.apparentBytes === 0
					? 0
					: Math.ceil(entry.apparentBytes / 4096) * 4096;

		const fileNode: ObduNode = {
			name,
			relPath: norm,
			ext,
			kind,
			isHidden: hidden,
			apparentBytes: entry.apparentBytes,
			diskBytes,
			mtime: entry.mtime,
			parent: parentNode,
			children: [],
			outgoingNotes: [],
			incomingNotes: [],
			outgoingAttachments: [],
			incomingNoteOwners: [],
			brokenLinks: [],
			externalRefs: [],
			isBookmarked: bookmarkedPaths.has(norm),
			emptyReason: !hidden && entry.apparentBytes === 0 ? i18n().emptyZeroBytes : "",
			displayBytes: entry.apparentBytes,
			visibleItemCount: 1,
		};

		parentNode.children.push(fileNode);
		nodesByPath.set(norm, fileNode);
		allFiles.push(fileNode);
	}

	// Build active lookup indices (strictly excluding hidden/system folders like .obsidian, .trash, .git)
	const activeByLowerPath = new Map<string, ObduNode>();
	const activeByLowerName = new Map<string, ObduNode[]>();
	const activeNotesByLowerStem = new Map<string, ObduNode[]>();

	for (const fileNode of allFiles) {
		if (fileNode.isHidden || fileNode.kind === "system") {
			continue;
		}
		activeByLowerPath.set(fileNode.relPath.toLowerCase(), fileNode);

		const lowerName = fileNode.name.toLowerCase();
		const byName = activeByLowerName.get(lowerName) ?? [];
		byName.push(fileNode);
		activeByLowerName.set(lowerName, byName);

		if (fileNode.kind === "note") {
			const lowerStem = stripMdExtension(fileNode.name).toLowerCase();
			const byStem = activeNotesByLowerStem.get(lowerStem) ?? [];
			byStem.push(fileNode);
			activeNotesByLowerStem.set(lowerStem, byStem);
		}
	}

	const pickClosest = (candidates: ObduNode[], sourceDir: string): ObduNode => {
		if (candidates.length === 1) {
			return candidates[0];
		}
		let best = candidates[0];
		let bestScore = -Infinity;
		for (const c of candidates) {
			const cDir = c.parent?.relPath ?? "";
			const score = commonPrefixScore(sourceDir, cDir);
			if (score > bestScore || (score === bestScore && c.relPath < best.relPath)) {
				best = c;
				bestScore = score;
			}
		}
		return best;
	};

	const resolveTarget = (sourceNote: ObduNode, rawTarget: string): ObduNode | null => {
		const sourceDir = sourceNote.parent?.relPath ?? "";

		// 1. Explicit relative path (./ or ../)
		if (rawTarget.startsWith("./") || rawTarget.startsWith("../")) {
			const relResolved = resolveRelativePath(sourceDir, rawTarget);
			if (!relResolved) {
				return null;
			}
			const lowerRel = relResolved.toLowerCase();
			return (
				activeByLowerPath.get(lowerRel) ??
				activeByLowerPath.get(`${lowerRel}.md`) ??
				null
			);
		}

		const cleaned = rawTarget.replace(/^\/+/, "");
		if (!cleaned) {
			return null;
		}
		const lowerCleaned = cleaned.toLowerCase();

		// 2. Relative to current note's folder if subfolder path
		if (sourceDir) {
			const fromSource = `${sourceDir.toLowerCase()}/${lowerCleaned}`;
			const relHit =
				activeByLowerPath.get(fromSource) ??
				activeByLowerPath.get(`${fromSource}.md`);
			if (relHit) {
				return relHit;
			}
		}

		// 3. Exact path from vault root
		const rootHit =
			activeByLowerPath.get(lowerCleaned) ??
			activeByLowerPath.get(`${lowerCleaned}.md`);
		if (rootHit) {
			return rootHit;
		}

		// 4. Obsidian shortest-path / basename resolution (when target has no slash, or fallback basename)
		if (!cleaned.includes("/")) {
			const exactNameMatches = activeByLowerName.get(lowerCleaned);
			if (exactNameMatches && exactNameMatches.length > 0) {
				return pickClosest(exactNameMatches, sourceDir);
			}
			const stemMatches = activeNotesByLowerStem.get(stripMdExtension(lowerCleaned));
			if (stemMatches && stemMatches.length > 0) {
				return pickClosest(stemMatches, sourceDir);
			}
		}

		return null;
	};

	// Parse all active notes and wire edges
	const contentByPath = new Map<string, string>();
	for (const e of entries) {
		if (!e.isDir && typeof e.content === "string") {
			contentByPath.set(normalizeVaultRelPath(e.relPath), e.content);
		}
	}

	for (const note of allFiles) {
		if (note.kind !== "note" || note.isHidden) {
			continue;
		}
		const content = contentByPath.get(note.relPath) ?? "";
		const parsed = parseNoteContent(content, note.ext);
		note.externalRefs = parsed.externalRefs;
		note.emptyReason = parsed.emptyReason;

		const seenTargets = new Set<string>();
		const seenBroken = new Set<string>();

		for (const rawTarget of parsed.localTargets) {
			const targetNode = resolveTarget(note, rawTarget);
			if (!targetNode) {
				if (!seenBroken.has(rawTarget)) {
					seenBroken.add(rawTarget);
					note.brokenLinks.push(rawTarget);
				}
				continue;
			}
			if (targetNode.relPath === note.relPath) {
				continue; // Ignore self-reference
			}
			if (seenTargets.has(targetNode.relPath)) {
				continue;
			}
			seenTargets.add(targetNode.relPath);

			if (targetNode.kind === "note") {
				note.outgoingNotes.push(targetNode);
				targetNode.incomingNotes.push(note);
			} else if (targetNode.kind === "attachment") {
				note.outgoingAttachments.push(targetNode);
				targetNode.incomingNoteOwners.push(note);
			}
		}
	}

	// Deterministic ordering of owners for exact remainder-byte attribution
	for (const node of allFiles) {
		node.incomingNoteOwners.sort((a, b) => a.relPath.localeCompare(b.relPath));
		node.outgoingAttachments.sort((a, b) => b.apparentBytes - a.apparentBytes || a.relPath.localeCompare(b.relPath));
		node.outgoingNotes.sort((a, b) => a.relPath.localeCompare(b.relPath));
		node.incomingNotes.sort((a, b) => a.relPath.localeCompare(b.relPath));
	}

	// Mark empty active directories
	const markEmptyDirs = (dir: ObduNode): boolean => {
		if (dir.isHidden) {
			return false;
		}
		let hasActiveChild = false;
		for (const child of dir.children) {
			if (child.isHidden) {
				continue;
			}
			hasActiveChild = true;
			if (child.kind === "dir") {
				markEmptyDirs(child);
			}
		}
		if (!hasActiveChild && dir.relPath !== "") {
			dir.emptyReason = i18n().emptyFolder;
		}
		return hasActiveChild;
	};
	markEmptyDirs(root);

	let orphanAttachmentCount = 0;
	let orphanAttachmentBytes = 0;
	for (const f of allFiles) {
		if (
			f.kind === "attachment" &&
			!f.isHidden &&
			f.incomingNoteOwners.length === 0 &&
			!f.isBookmarked
		) {
			orphanAttachmentCount++;
			orphanAttachmentBytes += f.apparentBytes;
		}
	}

	recomputeDisplaySizes(root, allFiles, "logical", "apparent", true);
	const totalLogicalBytes = root.displayBytes;
	recomputeDisplaySizes(root, allFiles, "physical", "apparent", true);
	const totalPhysicalBytes = root.displayBytes;

	return {
		root,
		nodesByPath,
		allFiles,
		totalPhysicalBytes,
		totalLogicalBytes,
		orphanAttachmentCount,
		orphanAttachmentBytes,
	};
}

export function getRawNodeSize(node: ObduNode, blockMode: BlockMode): number {
	return blockMode === "blocks" ? node.diskBytes : node.apparentBytes;
}

export function getAttachmentShareForNote(
	attachment: ObduNode,
	ownerNote: ObduNode,
	blockMode: BlockMode
): number {
	const owners = attachment.incomingNoteOwners;
	const k = owners.length;
	if (k === 0) {
		return 0;
	}
	const raw = getRawNodeSize(attachment, blockMode);
	const idx = owners.findIndex((n) => n.relPath === ownerNote.relPath);
	if (idx < 0) {
		return 0;
	}
	const base = Math.floor(raw / k);
	const rem = raw % k;
	return base + (idx < rem ? 1 : 0);
}

/**
 * Recomputes `displayBytes` and `visibleItemCount` across the entire tree.
 * Guarantees exact byte conservation: Logical total === Physical total!
 */
export function recomputeDisplaySizes(
	root: ObduNode,
	allFiles: ObduNode[],
	sizeMode: SizeMode,
	blockMode: BlockMode,
	showHidden: boolean
): void {
	for (const file of allFiles) {
		if (!showHidden && file.isHidden) {
			file.displayBytes = 0;
			file.visibleItemCount = 0;
			continue;
		}
		const raw = getRawNodeSize(file, blockMode);
		if (sizeMode === "physical") {
			file.displayBytes = raw;
		} else {
			// Logical mode (bilanzneutral without double counting)
			if (file.kind === "note" && !file.isHidden) {
				let attributed = raw;
				for (const att of file.outgoingAttachments) {
					attributed += getAttachmentShareForNote(att, file, blockMode);
				}
				file.displayBytes = attributed;
			} else if (file.kind === "attachment" && !file.isHidden) {
				file.displayBytes = file.incomingNoteOwners.length > 0 ? 0 : raw;
			} else {
				file.displayBytes = raw;
			}
		}
		file.visibleItemCount = 1;
	}

	const aggregateDir = (dir: ObduNode): void => {
		if (!showHidden && dir.isHidden) {
			dir.displayBytes = 0;
			dir.visibleItemCount = 0;
			return;
		}
		let sumBytes = 0;
		let count = 0;
		let maxMtime = dir.mtime;
		for (const child of dir.children) {
			if (!showHidden && child.isHidden) {
				continue;
			}
			if (child.kind === "dir") {
				aggregateDir(child);
				sumBytes += child.displayBytes;
				count += child.visibleItemCount;
			} else {
				sumBytes += child.displayBytes;
				count += 1;
			}
			if (child.mtime > maxMtime) {
				maxMtime = child.mtime;
			}
		}
		dir.displayBytes = sumBytes;
		dir.visibleItemCount = count;
		dir.mtime = maxMtime;
	};

	aggregateDir(root);
}

export function formatBytesNcdu(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let val = bytes / 1024;
	let u = 0;
	while (val >= 1024 && u < units.length - 1) {
		val /= 1024;
		u++;
	}
	return `${val.toFixed(1)} ${units[u]}`;
}

export function getNodeFlag(node: ObduNode): string {
	if (node.isHidden) {
		return " ";
	}
	if (node.kind === "dir") {
		return node.emptyReason ? "e" : " ";
	}
	if (node.kind === "note") {
		if (node.brokenLinks.length > 0) {
			return "!";
		}
		if (node.emptyReason) {
			return "e";
		}
		return " ";
	}
	if (node.kind === "attachment") {
		if (node.incomingNoteOwners.length === 0 && !node.isBookmarked) {
			return "O";
		}
		if (node.incomingNoteOwners.length >= 2) {
			return "S";
		}
	}
	return " ";
}

export function getNodeBadge(node: ObduNode, sizeMode: SizeMode): string {
	if (node.isHidden) {
		return "";
	}
	if (node.kind === "note") {
		const parts: string[] = [];
		if (node.outgoingAttachments.length > 0) {
			parts.push(`${node.outgoingAttachments.length} att`);
		}
		if (node.externalRefs.length > 0) {
			parts.push(`${node.externalRefs.length} ext`);
		}
		if (node.outgoingNotes.length > 0 || node.incomingNotes.length > 0) {
			parts.push(`${node.outgoingNotes.length}→ ${node.incomingNotes.length}←`);
		}
		if (node.brokenLinks.length > 0) {
			parts.push(`${node.brokenLinks.length} broken!`);
		}
		return parts.join(" · ");
	}
	if (node.kind === "attachment") {
		const owners = node.incomingNoteOwners.length;
		if (owners === 0) {
			return node.isBookmarked ? i18n().badgeBookmarked : i18n().badgeOrphan;
		}
		if (sizeMode === "logical") {
			return owners === 1
				? i18n().badgeAttributedTo(node.incomingNoteOwners[0].name)
				: `shared (${owners}x)`;
		}
		return owners === 1
			? `→ ${node.incomingNoteOwners[0].name}`
			: `shared (${owners}x)`;
	}
	return node.emptyReason ? i18n().badgeEmptyDir : "";
}
