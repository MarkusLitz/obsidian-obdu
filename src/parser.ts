import { i18n, setLocaleOverride } from "./i18n";
import { EmptyReason, ExternalRef } from "./types";

export { i18n, setLocaleOverride };

export const PRIMARY_NOTE_EXTENSIONS = new Set(["md", "canvas", "base"]);

export interface ParsedNoteResult {
	localTargets: string[];
	externalRefs: ExternalRef[];
	hasActiveTasks: boolean;
	emptyReason: EmptyReason;
}

const IGNORED_URI_PREFIXES = [
	"mailto:",
	"tel:",
	"obsidian:",
	"evernote:",
	"javascript:",
	"data:",
	"about:",
	"file:",
];

/**
 * Sanitizes control / ANSI escape characters from untrusted labels or paths.
 */
export function sanitizeDisplayString(input: string): string {
	let out = "";
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
			out += " ";
		} else {
			out += input[i];
		}
	}
	return out.trim();
}

export function extractGoogleDriveId(url: string): string | null {
	const fileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
	if (fileMatch) {
		return fileMatch[1];
	}
	const idParamMatch = url.match(
		/drive\.google\.com\/(?:open|thumbnail|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i
	);
	if (idParamMatch) {
		return idParamMatch[1];
	}
	return null;
}

function cleanExternalLabel(rawLabel: string, fallbackUrl: string): string {
	const cleaned = sanitizeDisplayString(rawLabel.replace(/^📁\s*/, ""));
	if (cleaned && !cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
		return cleaned;
	}
	const driveId = extractGoogleDriveId(fallbackUrl);
	if (driveId) {
		return `Google Drive (${driveId.slice(0, 12)}…)`;
	}
	try {
		const parsed = new URL(fallbackUrl);
		const lastSeg = decodeURIComponent(
			parsed.pathname.split("/").filter(Boolean).pop() ?? ""
		);
		if (lastSeg && lastSeg !== "image.jpg" && lastSeg !== "preview" && lastSeg !== "view") {
			return sanitizeDisplayString(lastSeg);
		}
		return sanitizeDisplayString(`${parsed.hostname}${parsed.pathname.slice(0, 32)}`);
	} catch {
		return sanitizeDisplayString(fallbackUrl.slice(0, 48));
	}
}

function splitFrontmatter(content: string): {
	frontmatter: string | null;
	body: string;
} {
	if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
		return { frontmatter: null, body: content };
	}
	const firstNewline = content.indexOf("\n");
	const rest = content.slice(firstNewline + 1);
	const closeMatch = rest.match(/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
	if (!closeMatch || closeMatch.index === undefined) {
		return { frontmatter: null, body: content };
	}
	const fm = rest.slice(0, closeMatch.index);
	const body = rest.slice(closeMatch.index + closeMatch[0].length);
	return { frontmatter: fm, body };
}

/**
 * Detects whether YAML frontmatter contains active TaskPulse tasks under `tasks:`.
 * Empty `tasks: []` returns false; actual list items (`- id: ...` / `- title: ...`) return true.
 */
export function hasActiveFrontmatterTasks(frontmatter: string | null): boolean {
	if (!frontmatter) {
		return false;
	}
	const lines = frontmatter.split(/\r?\n/);
	let inTasksBlock = false;
	for (const line of lines) {
		if (!inTasksBlock) {
			const match = line.match(/^tasks:[ \t]*(.*)$/);
			if (match) {
				const inlineVal = match[1].trim();
				if (inlineVal === "[]" || inlineVal === "null" || inlineVal === "~") {
					return false;
				}
				if (inlineVal.startsWith("[") && inlineVal.length > 2) {
					return true;
				}
				inTasksBlock = true;
			}
			continue;
		}
		if (/^[A-Za-z0-9_-]+:/.test(line)) {
			inTasksBlock = false;
			continue;
		}
		if (/^[ \t]*-[ \t]+\S+/.test(line)) {
			return true;
		}
	}
	return false;
}

/**
 * Replaces fenced code blocks (``` / ~~~) and inline code (`...`) with spaces
 * so example syntax inside documentation notes is never parsed as real links.
 */
export function maskCodeSegments(markdown: string): string {
	const lines = markdown.split("\n");
	let inFence = false;
	let fenceChar = "";
	let fenceLen = 0;

	const maskedLines = lines.map((line) => {
		const trimmedStart = line.replace(/^[ \t]{0,3}/, "");
		const fenceMatch = trimmedStart.match(/^(`{3,}|~{3,})/);
		if (fenceMatch) {
			const seq = fenceMatch[1];
			if (!inFence) {
				inFence = true;
				fenceChar = seq[0];
				fenceLen = seq.length;
				return "";
			} else if (
				seq[0] === fenceChar &&
				seq.length >= fenceLen &&
				trimmedStart.slice(seq.length).trim() === ""
			) {
				inFence = false;
				fenceChar = "";
				fenceLen = 0;
				return "";
			}
		}
		if (inFence) {
			return "";
		}
		// Mask inline code spans (`...` or ``...``) on a single line
		return line.replace(/(`+)([^`]*?)\1/g, " ");
	});

	return maskedLines.join("\n");
}

function normalizeLocalTargetCandidate(raw: string): string | null {
	let target = raw.trim();
	if (!target) {
		return null;
	}
	// Strip surrounding < > if present
	if (target.startsWith("<") && target.endsWith(">")) {
		target = target.slice(1, -1).trim();
	}
	// Strip optional markdown link title: path/to/file.png "Title"
	const titleMatch = target.match(/^(\S+)\s+(?:"[^"]*"|'[^']*')$/);
	if (titleMatch) {
		target = titleMatch[1];
	}

	const lower = target.toLowerCase();
	if (
		lower.startsWith("http://") ||
		lower.startsWith("https://") ||
		lower.startsWith("//") ||
		IGNORED_URI_PREFIXES.some((p) => lower.startsWith(p))
	) {
		return null;
	}

	// Strip #heading / #^block and ?query
	const hashIdx = target.indexOf("#");
	if (hashIdx === 0) {
		return null; // Pure self-anchor (#Heading)
	}
	if (hashIdx > 0) {
		target = target.slice(0, hashIdx);
	}
	const queryIdx = target.indexOf("?");
	if (queryIdx >= 0) {
		target = target.slice(0, queryIdx);
	}

	try {
		target = decodeURIComponent(target);
	} catch {
		// Keep raw if malformed percent sequence
	}

	target = target.replace(/\\/g, "/").trim();
	if (!target) {
		return null;
	}
	return target;
}

export function parseNoteContent(content: string, ext: string): ParsedNoteResult {
	const lowerExt = ext.toLowerCase();
	const localSet = new Set<string>();
	const driveById = new Map<string, ExternalRef>();
	const webByUrl = new Map<string, ExternalRef>();

	const addExternal = (url: string, label: string, isMediaEmbed: boolean): void => {
		const trimmedUrl = url.trim();
		const driveId = extractGoogleDriveId(trimmedUrl);
		if (driveId) {
			const existing = driveById.get(driveId);
			const candidateLabel = cleanExternalLabel(label, trimmedUrl);
			if (
				!existing ||
				(existing.label.startsWith("Google Drive (") &&
					!candidateLabel.startsWith("Google Drive ("))
			) {
				driveById.set(driveId, {
					url: trimmedUrl,
					label: candidateLabel,
					provider: "gdrive",
				});
			}
			return;
		}
		if (isMediaEmbed && /^https?:\/\//i.test(trimmedUrl)) {
			if (!webByUrl.has(trimmedUrl)) {
				webByUrl.set(trimmedUrl, {
					url: trimmedUrl,
					label: cleanExternalLabel(label, trimmedUrl),
					provider: "web",
				});
			}
		}
	};

	if (content.length === 0) {
		return {
			localTargets: [],
			externalRefs: [],
			hasActiveTasks: false,
			emptyReason: i18n().emptyZeroBytes,
		};
	}

	if (content.trim().length === 0) {
		return {
			localTargets: [],
			externalRefs: [],
			hasActiveTasks: false,
			emptyReason: i18n().emptyWhitespace,
		};
	}

	if (lowerExt === "canvas") {
		try {
			const parsed = JSON.parse(content) as {
				nodes?: Array<{ type?: string; file?: string; text?: string; url?: string }>;
			};
			const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
			if (nodes.length === 0) {
				return {
					localTargets: [],
					externalRefs: [],
					hasActiveTasks: false,
					emptyReason: i18n().emptyFrontmatter,
				};
			}
			for (const n of nodes) {
				if (n.type === "file" && typeof n.file === "string") {
					const loc = normalizeLocalTargetCandidate(n.file);
					if (loc) {
						localSet.add(loc);
					}
				} else if (n.type === "text" && typeof n.text === "string") {
					const inner = parseNoteContent(n.text, "md");
					for (const t of inner.localTargets) {
						localSet.add(t);
					}
					for (const e of inner.externalRefs) {
						addExternal(e.url, e.label, true);
					}
				} else if (n.type === "link" && typeof n.url === "string") {
					addExternal(n.url, n.url, true);
				}
			}
		} catch {
			// Ignore malformed canvas JSON safely
		}
		return {
			localTargets: Array.from(localSet),
			externalRefs: [...driveById.values(), ...webByUrl.values()],
			hasActiveTasks: false,
			emptyReason: "",
		};
	}

	const { frontmatter, body } = splitFrontmatter(content);
	const hasActiveTasks = hasActiveFrontmatterTasks(frontmatter);

	let emptyReason: EmptyReason = "";
	if (frontmatter !== null && body.trim().length === 0 && !hasActiveTasks) {
		emptyReason = i18n().emptyFrontmatter;
	}

	// 1. Extract wikilinks inside YAML frontmatter if present
	if (frontmatter) {
		const fmWikiRegex = /!?\[\[([^[\]\r\n]+)\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = fmWikiRegex.exec(frontmatter)) !== null) {
			const rawTarget = m[1].split("|")[0];
			const loc = normalizeLocalTargetCandidate(rawTarget);
			if (loc) {
				localSet.add(loc);
			}
		}
	}

	const masked = maskCodeSegments(body);

	// 2. Wikilinks & embeds: ![[target|alias]] or [[target|alias]]
	const wikiRegex = /(!?)\[\[([^[\]\r\n]+)\]\]/g;
	let wm: RegExpExecArray | null;
	while ((wm = wikiRegex.exec(masked)) !== null) {
		const parts = wm[2].split("|");
		const rawTarget = parts[0].trim();
		if (/^https?:\/\//i.test(rawTarget)) {
			addExternal(rawTarget, parts[1] ?? rawTarget, wm[1] === "!");
			continue;
		}
		const loc = normalizeLocalTargetCandidate(rawTarget);
		if (loc) {
			localSet.add(loc);
		}
	}

	// 3. Standard Markdown links & images: ![alt](<url>) or [label](url)
	const mdAngleRegex = /(!?)\[([^[\]\r\n]*)\]\(<([^>\r\n]+)>\)/g;
	let mam: RegExpExecArray | null;
	while ((mam = mdAngleRegex.exec(masked)) !== null) {
		const isEmbed = mam[1] === "!";
		const label = mam[2].split("|")[0];
		const rawUrl = mam[3].trim();
		if (/^https?:\/\//i.test(rawUrl)) {
			addExternal(rawUrl, label, isEmbed);
		} else {
			const loc = normalizeLocalTargetCandidate(rawUrl);
			if (loc) {
				localSet.add(loc);
			}
		}
	}

	const mdRegex = /(!?)\[([^[\]\r\n]*)\]\(([^()\r\n]+(?:\([^()\r\n]*\)[^()\r\n]*)*)\)/g;
	let mm: RegExpExecArray | null;
	while ((mm = mdRegex.exec(masked)) !== null) {
		const isEmbed = mm[1] === "!";
		const label = mm[2].split("|")[0];
		const rawUrl = mm[3].trim();
		if (rawUrl.startsWith("<") && rawUrl.endsWith(">")) {
			continue; // Handled above
		}
		if (/^https?:\/\//i.test(rawUrl)) {
			addExternal(rawUrl, label, isEmbed);
		} else {
			const loc = normalizeLocalTargetCandidate(rawUrl);
			if (loc) {
				localSet.add(loc);
			}
		}
	}

	// 4. HTML media tags (<img src="...">, <iframe src="...">, <video src="...">, <audio src="...">, <source src="...">)
	const htmlMediaRegex = /<(?:img|iframe|video|audio|source)\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
	let hm: RegExpExecArray | null;
	while ((hm = htmlMediaRegex.exec(masked)) !== null) {
		const src = hm[1].trim();
		const altMatch = hm[0].match(/\balt=["']([^"']+)["']/i);
		const label = altMatch ? altMatch[1] : "";
		if (/^https?:\/\//i.test(src)) {
			addExternal(src, label, true);
		} else {
			const loc = normalizeLocalTargetCandidate(src);
			if (loc) {
				localSet.add(loc);
			}
		}
	}

	return {
		localTargets: Array.from(localSet),
		externalRefs: [...driveById.values(), ...webByUrl.values()],
		hasActiveTasks,
		emptyReason,
	};
}
