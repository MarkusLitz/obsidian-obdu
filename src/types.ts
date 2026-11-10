export type NodeKind = "dir" | "note" | "attachment" | "system";

export type SizeMode = "physical" | "logical";
export type BlockMode = "apparent" | "blocks";
export type BarStyle = "both" | "bar" | "percent" | "none";
export type SortKey = "size" | "name" | "items" | "mtime";
export type ViewTab = "tree" | "orphans" | "largest" | "issues";
export type OrphanScope = "attachments" | "notes" | "all";

export type EmptyReason =
	| ""
	| "0 Bytes"
	| "Whitespace only"
	| "Frontmatter only"
	| "Empty folder"
	| "Nur Leerzeichen"
	| "Nur Frontmatter"
	| "Leerer Ordner";

export interface ExternalRef {
	url: string;
	label: string;
	provider: "gdrive" | "web";
}

export interface RawFileEntry {
	relPath: string;
	name: string;
	isDir: boolean;
	apparentBytes: number;
	diskBytes: number;
	mtime: number;
	content?: string;
}

export interface ObduNode {
	name: string;
	relPath: string;
	ext: string;
	kind: NodeKind;
	isHidden: boolean;
	apparentBytes: number;
	diskBytes: number;
	mtime: number;
	parent: ObduNode | null;
	children: ObduNode[];

	outgoingNotes: ObduNode[];
	incomingNotes: ObduNode[];
	outgoingAttachments: ObduNode[];
	incomingNoteOwners: ObduNode[];
	brokenLinks: string[];
	externalRefs: ExternalRef[];
	isBookmarked: boolean;
	emptyReason: EmptyReason;

	/** Recomputed dynamically whenever SizeMode / BlockMode / showHidden changes */
	displayBytes: number;
	visibleItemCount: number;
}

export interface VaultGraph {
	root: ObduNode;
	nodesByPath: Map<string, ObduNode>;
	allFiles: ObduNode[];
	totalPhysicalBytes: number;
	totalLogicalBytes: number;
	orphanAttachmentCount: number;
	orphanAttachmentBytes: number;
}

export interface NavFrame {
	mode: "dir" | "note" | "attachment";
	targetPath: string;
	selectedRowKey: string;
	scrollTop: number;
}

export type RowRole =
	| "parent"
	| "tree-node"
	| "note-self"
	| "note-attachment"
	| "note-external"
	| "note-outgoing"
	| "note-backlink"
	| "note-broken"
	| "attachment-owner"
	| "diagnostic-broken"
	| "diagnostic-empty";

export interface DisplayRow {
	key: string;
	role: RowRole;
	flag: string; // ' ', 'O', '!', 'S', 'e', '@', '>'
	bytes: number;
	itemCount?: number;
	showBar: boolean;
	label: string;
	badge: string;
	node?: ObduNode;
	externalRef?: ExternalRef;
	brokenTarget?: string;
	brokenSources?: ObduNode[];
}

export interface DeletePlan {
	target: ObduNode;
	isInsideTrash: boolean;
	exclusiveAttachments: ObduNode[];
	sharedAttachments: ObduNode[];
	incomingBacklinks: ObduNode[];
	reclaimableBytesWithAttachments: number;
	reclaimableBytesTargetOnly: number;
}

export interface ObduSettings {
	defaultSizeMode: SizeMode;
	defaultShowHidden: boolean;
	defaultBarStyle: BarStyle;
}

export const DEFAULT_SETTINGS: ObduSettings = {
	defaultSizeMode: "physical",
	defaultShowHidden: true,
	defaultBarStyle: "both",
};

export const VIEW_TYPE_OBDU = "obdu-ncdu-view";
