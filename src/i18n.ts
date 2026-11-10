import { EmptyReason } from "./types";

export type ObduLocale = "en" | "de";

let localeOverride: ObduLocale | null = null;

export function setLocaleOverride(locale: ObduLocale | null): void {
	localeOverride = locale;
}

export function getObduLocale(): ObduLocale {
	if (localeOverride === "en" || localeOverride === "de") {
		return localeOverride;
	}
	try {
		if (typeof window !== "undefined") {
			const stored = window.localStorage?.getItem("language");
			if (stored && stored.toLowerCase().startsWith("de")) {
				return "de";
			}
			if (stored && stored.toLowerCase().startsWith("en")) {
				return "en";
			}
			const winMoment = (
				window as unknown as { moment?: { locale?: () => string } }
			).moment;
			const momentLoc = winMoment?.locale?.();
			if (momentLoc && momentLoc.toLowerCase().startsWith("de")) {
				return "de";
			}
		}
		if (
			typeof navigator !== "undefined" &&
			navigator.language?.toLowerCase().startsWith("de")
		) {
			return "de";
		}
	} catch {
		// Ignore environment access errors in headless tests
	}
	return "en";
}

export function isGermanLocale(): boolean {
	return getObduLocale() === "de";
}

export function getNumberLocale(): string {
	return isGermanLocale() ? "de-CH" : "en-US";
}

export const STRINGS = {
	en: {
		ribbonTooltip: "Open disk usage analyzer",
		cmdOpenDiskUsage: "Open vault disk usage",
		cmdOpenOrphans: "Show orphaned files by size",
		cmdAnalyzeActiveFolder: "Analyze active note folder",
		menuAnalyzeInObdu: "Analyze disk usage",
		viewDisplayText: "Disk usage",

		// Settings (strict Sentence case)
		settingSizeModeName: "Default size mode",
		settingSizeModeDesc:
			"Physical shows actual file sizes in place; logical attributes linked local attachments to their notes while conserving total vault bytes (toggle anytime with m).",
		settingSizeModePhysical: "Physical (classic ncdu)",
		settingSizeModeLogical: "Logical (include referenced attachments)",
		settingShowHiddenName: "Show system and dot folders on startup",
		settingShowHiddenDesc:
			"Include configuration, .trash, and .git folders in disk usage calculations (toggle anytime with . or e).",
		settingBarStyleName: "Default progress bar style",
		settingBarStyleDesc:
			"Choose how usage bars are rendered (cycle anytime with g).",
		settingBarStyleBoth: "Percentage and bar",
		settingBarStyleBar: "Bar only",
		settingBarStylePercent: "Percentage only",
		settingBarStyleNone: "Hidden",

		// Empty reasons & badges
		emptyZeroBytes: "0 Bytes" as EmptyReason,
		emptyWhitespace: "Whitespace only" as EmptyReason,
		emptyFrontmatter: "Frontmatter only" as EmptyReason,
		emptyFolder: "Empty folder" as EmptyReason,
		badgeEmptyDir: "empty",
		badgeBookmarked: "bookmarked",
		badgeOrphan: "orphan",
		badgeAttributedTo: (name: string) => `attributed → ${name}`,

		// Trash & errors
		errInvalidTarget: "Invalid or protected target path.",
		errInvalidPath: "Invalid path.",
		errUnknown: "Unknown error",

		// View loading & empty
		loadingTitle: "Scanning vault disk usage…",
		loadingSub: "Analyzing file tree, attachments, and references.",
		emptyListState: "No entries in this view.",

		// Topbar & tabs
		topBarTitle: "obdu 0.1.0 ~ Use arrow keys or j/k to navigate, ? for help",
		pillLogical: "[m] LOGICAL (with att.)",
		pillPhysical: "[m] PHYSICAL",
		pillBytes: "[a] BYTES",
		pillBlocks: "[a] BLOCKS",
		pillDotfilesOn: "[.] DOTFILES: ON",
		pillDotfilesOff: "[.] DOTFILES: OFF",
		tabTree: "[1] File tree",
		tabOrphans: (count: number) => `[2] Orphans (${count})`,
		tabLargest: "[3] Largest",
		tabIssues: "[4] Issues",
		scopeFilter: (scope: "attachments" | "notes" | "all") =>
			`[t] Filter: ${
				scope === "attachments"
					? "Attachments"
					: scope === "notes"
						? "Notes"
						: "All"
			}`,

		// Touchbar
		touchBack: "← Back",
		touchOpen: "↵ Open",
		touchInfo: "i Info",
		touchPreview: "p Preview",
		touchTab: "o Tab",
		touchDelete: "d Delete",

		// Filterbar & footer
		filterPlaceholder:
			"Filter (Enter = return focus to list, Esc = clear filter)…",
		footerStats: (
			totalSize: string,
			orphanCount: number,
			orphanSize: string,
			sortKey: string,
			arrow: string
		) =>
			` Total: ${totalSize} | Orphans: ${orphanCount} (${orphanSize}) | Sort: ${sortKey}${arrow}`,
		footerHints:
			"[Enter] Open  [Backspace] Back  [c] Count  [i] Info  [p] Preview  [o] Obsidian  [d] Delete  [?] Help",

		// Location descriptions
		locOrphans: "Orphaned files",
		locLargest: "Largest files in vault",
		locIssues: "Broken links and empty items",
		locNoteInspection: "[Note inspection]",
		locAttachmentRefs: "[Attachment references]",

		// Tree drill-down rows
		rowNoteSelfLabel: (name: string) => `[Note text] ${name}`,
		rowNoteSelfBadge: "Enter = open in Obsidian",
		rowNoteAttachmentLabel: (name: string) => `[Attachment] ${name}`,
		rowNoteAttachmentSharedBadge: (
			owners: number,
			fullSize: string,
			relPath: string
		) => `shared (${owners}x, total ${fullSize}) · ${relPath}`,
		rowExternalLabel: (label: string) => `[External] ${label}`,
		rowExternalWebMedia: "Web media",
		rowExternalZeroBytes: (tag: string) => `${tag} (0 B local)`,
		rowOutgoingNoteLabel: (relPath: string) => `→ Linked note: ${relPath}`,
		rowOutgoingNoteBadge: "Outgoing link",
		rowBacklinkNoteLabel: (relPath: string) => `← Backlink from: ${relPath}`,
		rowBacklinkNoteBadge: "Incoming link",
		rowBrokenLinkLabel: (target: string) => `! Missing target: ${target}`,
		rowBrokenLinkBadge: "Broken link",
		rowAttachmentSelfLabel: (relPath: string) => `[File] ${relPath}`,
		rowAttachmentOrphanBadge: "ORPHAN – not referenced by any note",
		rowAttachmentReferencedBadge: (count: number) =>
			`Referenced by ${count} note(s)`,
		rowAttachmentOwnerLabel: (relPath: string) => `← Used in: ${relPath}`,
		rowAttachmentOwnerBadge: "Enter = jump to note",
		rowDiagnosticBrokenLabel: (target: string) =>
			`! Broken link: "${target}"`,
		rowDiagnosticBrokenBadge: (count: number, names: string) =>
			`in ${count} note(s): ${names}`,

		// Notices
		noticeSystemOrTrashFile: (relPath: string) =>
			`"${relPath}" is a system or trash file outside the active Obsidian index (use "p" for preview or "f" to reveal in file manager).`,
		noticeShowInFolderDesktopOnly:
			"Revealing files in the system file manager is only supported on desktop.",
		noticeDeleteFailed: (err: string) => `Delete failed: ${err}`,
		noticeDeletedPermanently: (name: string) =>
			`"${name}" deleted permanently.`,
		noticeMovedToTrash: (name: string) => `"${name}" moved to .trash.`,

		// Modals: Info
		infoTitle: (name: string) => `File and reference info: ${name}`,
		infoVaultPath: "Vault path:",
		infoType: "Type:",
		infoPhysicalSize: "Physical size:",
		infoBlockSize: "Block size (4 KiB):",
		infoLogicalSize: "Logical total size:",
		infoModifiedAt: "Modified:",
		infoBookmarked: "Bookmarked:",
		infoBookmarkedVal: "Yes (protected from orphan warning)",
		infoEmptyStatus: "Empty status:",
		infoLocalAttachments: "Local attachments:",
		infoExternalMedia: "External media / Drive:",
		infoNoteRefs: "Note references:",
		infoNoteRefsVal: (outCount: number, inCount: number) =>
			`${outCount} outgoing (→), ${inCount} incoming (←)`,
		infoBrokenLinks: "Broken links (!):",
		infoRefs: "References:",
		infoRefsOrphanVal: "0 notes (ORPHAN – unreferenced file)",
		infoUsedIn: (count: number) => `Used in (${count}):`,
		infoCloseBtn: "Close (Esc / i)",
		kindSystemDir: "System / dot folder",
		kindDir: "Folder",
		kindNote: (ext: string) => `Note (.${ext})`,
		kindAttachment: (ext: string) => `Attachment (.${ext || "bin"})`,
		kindSystemFile: "System file",

		// Modals: Help
		helpTitle: "Keyboard shortcuts (ncdu style)",
		helpCloseBtn: "Close (? / Esc)",
		helpBindings: [
			[
				"↑ / ↓ or k / j",
				"Move selection up / down (also PgUp, PgDn, Home, End)",
			],
			[
				"Enter / → / l",
				"Open folder, inspect note references, or inspect attachment owners",
			],
			["← / h / Backspace", "Navigate back one level in history"],
			[
				"m or Tab",
				"Toggle size mode: Physical ↔ Logical (with attachments, byte-neutral)",
			],
			["a", "Toggle apparent size (bytes) ↔ disk blocks (4 KiB)"],
			[". or e", "Show or hide system and dot folders (.trash, .git, etc.)"],
			["c", "Show or hide item count column per folder"],
			[
				"s / n / C / M",
				"Sort by size, name, item count, or modified date (press again to reverse)",
			],
			["g", "Cycle progress bar style ([% + bar] / [bar] / [%] / hidden)"],
			[
				"1 / 2 / 3 / 4",
				"Switch view: 1 Tree · 2 Orphans · 3 Largest files · 4 Broken links & empty",
			],
			[
				"t (in view 2)",
				"Cycle orphan scope: Attachments → Notes → All",
			],
			["/", "Live filter in current view (Esc clears filter)"],
			["i", "Open file and reference info modal"],
			["p or Space", "Quick preview modal (image, PDF, or text excerpt)"],
			["o", "Open selected file in a new Obsidian tab"],
			["f", "Reveal in system file manager (desktop)"],
			[
				"d",
				"Smart delete (moves to .trash/<path> with optional attachment cascade)",
			],
			["r / ? / q", "Rescan vault / Keyboard help / Close tab"],
		] as Array<[string, string]>,

		// Modals: Preview
		previewTitle: (pathStr: string, sizeStr: string) =>
			`Preview: ${pathStr} (${sizeStr})`,
		previewFolderDesc: (count: number) =>
			`Folder with ${count} direct entries.`,
		previewTruncated: "… [truncated]",
		previewEmptyText: "(Empty)",
		previewReadError: "Could not read file.",
		previewUnsupported: (ext: string, sizeStr: string) =>
			`No direct preview for file type ".${ext || "unknown"}" (${sizeStr}). Press "o" to open in Obsidian or "f" to reveal in file manager.`,
		previewCloseBtn: "Close (Space / p / Esc)",

		// Modals: Smart Delete
		deleteTitle: (name: string) => `Confirm deletion: ${name}`,
		deletePath: (relPath: string) => `Path: ${relPath}`,
		deleteWarnBacklinks: (count: number) =>
			`⚠ Warning: Still referenced by ${count} active note(s)!`,
		deleteMoreItems: (count: number) => `… and ${count} more`,
		deleteCascadeCheckbox: (count: number, sizeStr: string) =>
			` [Key a] Also delete ${count} exclusive attachment(s) (${sizeStr})`,
		deleteSharedProtected: (count: number) =>
			`ℹ ${count} shared attachment(s) remain protected because they are used by other notes.`,
		deletePermanentCheckbox: (trashRoot: string) =>
			` [Key x] Delete permanently instead of moving to "${trashRoot}/"`,
		deleteAlreadyInTrashWarn:
			"Item is already inside the trash folder (.trash/) and will be deleted permanently.",
		deleteScopeSummary: (sizeStr: string) => `Reclaimable: ${sizeStr}`,
		deleteCancelBtn: "Cancel (n / Esc)",
		deleteConfirmPermanentBtn: "Delete permanently (y / Enter)",
		deleteConfirmTrashBtn: "Move to .trash (y / Enter)",
	},
	de: {
		ribbonTooltip: "Speicheranalyse öffnen",
		cmdOpenDiskUsage: "Vault-Speicheranalyse öffnen",
		cmdOpenOrphans: "Verwaiste Dateien (Orphans) nach Größe zeigen",
		cmdAnalyzeActiveFolder: "Ordner der aktiven Notiz analysieren",
		menuAnalyzeInObdu: "Speicherverbrauch analysieren",
		viewDisplayText: "Speicheranalyse",

		// Settings
		settingSizeModeName: "Standard-Größenmodus",
		settingSizeModeDesc:
			"Physisch zeigt die echte Dateigröße vor Ort; Logisch rechnet verlinkte lokale Attachments bilanzneutral ihren Notizen zu (jederzeit per Taste m umschaltbar).",
		settingSizeModePhysical: "Physisch (wie klassisches ncdu)",
		settingSizeModeLogical: "Logisch (inkl. referenzierter Attachments)",
		settingShowHiddenName: "System- & Dot-Ordner beim Start anzeigen",
		settingShowHiddenDesc:
			"Zeigt Konfigurations-, .trash- und .git-Ordner beim Speicherverbrauch an (jederzeit per Taste . oder e umschaltbar).",
		settingBarStyleName: "Standard-Balkenstil",
		settingBarStyleDesc:
			"Darstellung der Fortschrittsbalken (per Taste g umschaltbar).",
		settingBarStyleBoth: "Prozent + [#####]-Balken",
		settingBarStyleBar: "Nur [#####]-Balken",
		settingBarStylePercent: "Nur Prozent",
		settingBarStyleNone: "Ausgeblendet",

		// Empty reasons & badges
		emptyZeroBytes: "0 Bytes" as EmptyReason,
		emptyWhitespace: "Nur Leerzeichen" as EmptyReason,
		emptyFrontmatter: "Nur Frontmatter" as EmptyReason,
		emptyFolder: "Leerer Ordner" as EmptyReason,
		badgeEmptyDir: "leer",
		badgeBookmarked: "bookmarked",
		badgeOrphan: "orphan",
		badgeAttributedTo: (name: string) => `zugeordnet → ${name}`,

		// Trash & errors
		errInvalidTarget: "Ungültiger oder geschützter Zielpfad.",
		errInvalidPath: "Ungültiger Pfad.",
		errUnknown: "Unbekannter Fehler",

		// View loading & empty
		loadingTitle: "Vault wird gescannt…",
		loadingSub: "Dateibaum, Attachments und Referenzen werden analysiert.",
		emptyListState: "Keine Einträge in dieser Ansicht.",

		// Topbar & tabs
		topBarTitle:
			"obdu 0.1.0 ~ Pfeiltasten / j k zum Navigieren, ? für Hilfe",
		pillLogical: "[m] LOGISCH (inkl. Att.)",
		pillPhysical: "[m] PHYSISCH",
		pillBytes: "[a] BYTES",
		pillBlocks: "[a] BLÖCKE",
		pillDotfilesOn: "[.] DOTFILES: AN",
		pillDotfilesOff: "[.] DOTFILES: AUS",
		tabTree: "[1] Dateibaum",
		tabOrphans: (count: number) => `[2] Orphans (${count})`,
		tabLargest: "[3] Größte",
		tabIssues: "[4] Probleme",
		scopeFilter: (scope: "attachments" | "notes" | "all") =>
			`[t] Filter: ${
				scope === "attachments"
					? "Anhänge"
					: scope === "notes"
						? "Notizen"
						: "Alle"
			}`,

		// Touchbar
		touchBack: "← Zurück",
		touchOpen: "↵ Öffnen",
		touchInfo: "i Info",
		touchPreview: "p Vorschau",
		touchTab: "o Tab",
		touchDelete: "d Löschen",

		// Filterbar & footer
		filterPlaceholder:
			"Filter (Enter = Fokus zurück in Liste, Esc = Filter löschen)…",
		footerStats: (
			totalSize: string,
			orphanCount: number,
			orphanSize: string,
			sortKey: string,
			arrow: string
		) =>
			` Gesamt: ${totalSize} | Orphans: ${orphanCount} (${orphanSize}) | Sort: ${sortKey}${arrow}`,
		footerHints:
			"[Enter] Öffnen  [Backspace] Zurück  [c] Anzahl  [i] Info  [p] Vorschau  [o] Obsidian  [d] Löschen  [?] Hilfe",

		// Location descriptions
		locOrphans: "Verwaiste Dateien (Orphans)",
		locLargest: "Größte Dateien im Vault",
		locIssues: "Kaputte Links & Leere Elemente",
		locNoteInspection: "[Notiz-Inspektion]",
		locAttachmentRefs: "[Attachment-Referenzen]",

		// Tree drill-down rows
		rowNoteSelfLabel: (name: string) => `[Notiztext] ${name}`,
		rowNoteSelfBadge: "Enter = in Obsidian öffnen",
		rowNoteAttachmentLabel: (name: string) => `[Anhang] ${name}`,
		rowNoteAttachmentSharedBadge: (
			owners: number,
			fullSize: string,
			relPath: string
		) => `shared (${owners}x, gesamt ${fullSize}) · ${relPath}`,
		rowExternalLabel: (label: string) => `[Extern] ${label}`,
		rowExternalWebMedia: "Web-Medien",
		rowExternalZeroBytes: (tag: string) => `${tag} (0 B lokal)`,
		rowOutgoingNoteLabel: (relPath: string) =>
			`→ Verlinkte Notiz: ${relPath}`,
		rowOutgoingNoteBadge: "Ausgehender Link",
		rowBacklinkNoteLabel: (relPath: string) => `← Backlink von: ${relPath}`,
		rowBacklinkNoteBadge: "Eingehender Link",
		rowBrokenLinkLabel: (target: string) => `! Fehlendes Ziel: ${target}`,
		rowBrokenLinkBadge: "Kaputter Link",
		rowAttachmentSelfLabel: (relPath: string) => `[Datei] ${relPath}`,
		rowAttachmentOrphanBadge: "ORPHAN – von keiner Notiz eingebunden",
		rowAttachmentReferencedBadge: (count: number) =>
			`Eingebunden in ${count} Notiz(en)`,
		rowAttachmentOwnerLabel: (relPath: string) =>
			`← Verwendet in: ${relPath}`,
		rowAttachmentOwnerBadge: "Enter = zur Notiz springen",
		rowDiagnosticBrokenLabel: (target: string) =>
			`! Kaputter Link: „${target}“`,
		rowDiagnosticBrokenBadge: (count: number, names: string) =>
			`in ${count} Notiz(en): ${names}`,

		// Notices
		noticeSystemOrTrashFile: (relPath: string) =>
			`„${relPath}“ ist eine System-/Papierkorb-Datei außerhalb des aktiven Obsidian-Index (nutze „p“ für Vorschau oder „f“ für Dateimanager).`,
		noticeShowInFolderDesktopOnly:
			"Im Dateimanager zeigen wird nur auf Desktop unterstützt.",
		noticeDeleteFailed: (err: string) => `Löschen fehlgeschlagen: ${err}`,
		noticeDeletedPermanently: (name: string) =>
			`„${name}“ endgültig gelöscht.`,
		noticeMovedToTrash: (name: string) =>
			`„${name}“ in .trash verschoben.`,

		// Modals: Info
		infoTitle: (name: string) => `Datei- & Referenz-Info: ${name}`,
		infoVaultPath: "Vault-Pfad:",
		infoType: "Typ:",
		infoPhysicalSize: "Physische Größe:",
		infoBlockSize: "Block-Größe (4 KiB):",
		infoLogicalSize: "Logische Gesamtgröße:",
		infoModifiedAt: "Geändert am:",
		infoBookmarked: "Lesezeichen:",
		infoBookmarkedVal: "Ja (vor Orphan-Warnung geschützt)",
		infoEmptyStatus: "Leer-Status:",
		infoLocalAttachments: "Lokale Attachments:",
		infoExternalMedia: "Externe Medien / Drive:",
		infoNoteRefs: "Notiz-Referenzen:",
		infoNoteRefsVal: (outCount: number, inCount: number) =>
			`${outCount} ausgehend (→), ${inCount} eingehend (←)`,
		infoBrokenLinks: "Kaputte Links (!):",
		infoRefs: "Referenzen:",
		infoRefsOrphanVal: "0 Notizen (ORPHAN – verwaiste Datei)",
		infoUsedIn: (count: number) => `Verwendet in (${count}):`,
		infoCloseBtn: "Schließen (Esc / i)",
		kindSystemDir: "System-/Dot-Ordner",
		kindDir: "Ordner",
		kindNote: (ext: string) => `Notiz (.${ext})`,
		kindAttachment: (ext: string) => `Attachment (.${ext || "bin"})`,
		kindSystemFile: "Systemdatei",

		// Modals: Help
		helpTitle: "Tastatursteuerung (ncdu-Stil)",
		helpCloseBtn: "Schließen (? / Esc)",
		helpBindings: [
			[
				"↑ / ↓ oder k / j",
				"Zeile hoch / runter (auch PgUp, PgDn, Home, End)",
			],
			[
				"Enter / → / l",
				"Öffnen: Ordner, Notiz-Referenzen oder Attachment-Verwender",
			],
			["← / h / Backspace", "Eine Ebene zurück in der Navigationshistorie"],
			[
				"m oder Tab",
				"Größenmodus: Physisch ↔ Logisch (inkl. Attachments, bilanzneutral)",
			],
			["a", "Apparent Size (Bytes) ↔ Disk-Blöcke (4 KiB)"],
			[
				". oder e",
				"System-/Dot-Ordner (.trash, .git etc.) ein-/ausblenden",
			],
			["c", "Spalte für Elementanzahl pro Ordner ein-/ausblenden"],
			[
				"s / n / C / M",
				"Sortieren nach Größe, Name, Anzahl, Änderungsdatum (erneut = umkehren)",
			],
			[
				"g",
				"Balkenstil wechseln ([% + Balken] / [Balken] / [%] / Aus)",
			],
			[
				"1 / 2 / 3 / 4",
				"Ansicht: 1 Baum · 2 Orphans · 3 Größte Dateien · 4 Kaputte Links & Leer",
			],
			[
				"t (in Ansicht 2)",
				"Orphan-Filter umschalten: Anhänge → Notizen → Alle",
			],
			["/", "Live-Filter in aktueller Ansicht (Esc leert Filter)"],
			["i", "Datei- & Referenz-Info-Popup öffnen"],
			["p oder Space", "Schnellvorschau (Bild, PDF oder Textauszug)"],
			["o", "Ausgewählte Datei in neuem Obsidian-Tab öffnen"],
			["f", "Im System-Dateimanager / Finder anzeigen (Desktop)"],
			["d", "Smart Delete (.trash/<Pfad>, inkl. Attachment-Kaskade)"],
			["r / ? / q", "Vault neu scannen / Hilfe / Tab schließen"],
		] as Array<[string, string]>,

		// Modals: Preview
		previewTitle: (pathStr: string, sizeStr: string) =>
			`Vorschau: ${pathStr} (${sizeStr})`,
		previewFolderDesc: (count: number) =>
			`Ordner mit ${count} direkten Einträgen.`,
		previewTruncated: "… [gekürzt]",
		previewEmptyText: "(Leer)",
		previewReadError: "Datei konnte nicht gelesen werden.",
		previewUnsupported: (ext: string, sizeStr: string) =>
			`Keine direkte Vorschau für Dateityp „.${ext || "unbekannt"}“ (${sizeStr}). Drücke „o“ zum Öffnen in Obsidian oder „f“ für den Dateimanager.`,
		previewCloseBtn: "Schließen (Space / p / Esc)",

		// Modals: Smart Delete
		deleteTitle: (name: string) => `Löschen bestätigen: ${name}`,
		deletePath: (relPath: string) => `Pfad: ${relPath}`,
		deleteWarnBacklinks: (count: number) =>
			`⚠ Warnung: Wird noch von ${count} aktiven Notiz(en) referenziert!`,
		deleteMoreItems: (count: number) => `… sowie ${count} weitere`,
		deleteCascadeCheckbox: (count: number, sizeStr: string) =>
			` [Taste a] ${count} exklusive Attachment(s) (${sizeStr}) gleich mitlöschen`,
		deleteSharedProtected: (count: number) =>
			`ℹ ${count} geteilte(s) Attachment(s) bleiben geschützt, da sie noch in anderen Notizen verwendet werden.`,
		deletePermanentCheckbox: (trashRoot: string) =>
			` [Taste x] Endgültig löschen statt sicher in „${trashRoot}/“ verschieben`,
		deleteAlreadyInTrashWarn:
			"Eintrag liegt bereits im Papierkorb (.trash/) und wird endgültig gelöscht.",
		deleteScopeSummary: (sizeStr: string) => `Umfang: ${sizeStr}`,
		deleteCancelBtn: "Abbrechen (n / Esc)",
		deleteConfirmPermanentBtn: "Endgültig löschen (y / Enter)",
		deleteConfirmTrashBtn: "In .trash verschieben (y / Enter)",
	},
} as const;

export function i18n() {
	return STRINGS[getObduLocale()];
}
