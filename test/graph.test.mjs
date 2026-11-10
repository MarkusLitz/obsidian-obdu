import test from "node:test";
import assert from "node:assert/strict";
import esbuild from "esbuild";

async function loadTsModule(entryPoint) {
	const result = await esbuild.build({
		entryPoints: [entryPoint],
		bundle: true,
		write: false,
		format: "esm",
		target: "es2021",
	});
	const code = result.outputFiles[0].text;
	const dataUrl = `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
	return import(dataUrl);
}

const { parseNoteContent, setLocaleOverride, i18n } =
	await loadTsModule("src/parser.ts");
const { buildVaultGraph, getNodeFlag, getNodeBadge, recomputeDisplaySizes } =
	await loadTsModule("src/graph.ts");
const { isSafeVaultTarget, buildDeletePlan, ObduTrashService } =
	await loadTsModule("src/trash.ts");

test("parseNoteContent masks fenced code blocks and detects frontmatter tasks", () => {
	const setupDoc = [
		"# Custom Scripts",
		"```css",
		"/* Syntax: ![[file.pdf|small]] */",
		"```",
		"Inline `![[ignored.png]]` example.",
		"Real embed: ![[Recipe-Dish-image32.png|492]]",
	].join("\n");

	const res = parseNoteContent(setupDoc, "md");
	assert.deepEqual(res.localTargets, ["Recipe-Dish-image32.png"]);
	assert.equal(res.emptyReason, "");

	const activeTaskNote = [
		"---",
		"tasks:",
		"  - id: tp-123",
		"    title: Review project roadmap",
		"    status: open",
		"---",
		"",
	].join("\n");
	const taskRes = parseNoteContent(activeTaskNote, "md");
	assert.equal(taskRes.hasActiveTasks, true);
	assert.equal(taskRes.emptyReason, "");

	setLocaleOverride("en");
	const emptyFrontmatterNote = ["---", "tasks: []", "---", ""].join("\n");
	const emptyRes = parseNoteContent(emptyFrontmatterNote, "md");
	assert.equal(emptyRes.hasActiveTasks, false);
	assert.equal(emptyRes.emptyReason, "Frontmatter only");

	setLocaleOverride("de");
	const emptyResDe = parseNoteContent(emptyFrontmatterNote, "md");
	assert.equal(emptyResDe.emptyReason, "Nur Frontmatter");
	assert.equal(i18n().cmdOpenDiskUsage, "Vault-Speicheranalyse öffnen");

	setLocaleOverride(null);
});

test("parseNoteContent deduplicates Google Drive embeds and keeps descriptive label", () => {
	const logbookDoc = [
		"**[📁 Receipt-2026-0004.pdf](https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=drivesdk)**",
		'<iframe src="https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview"></iframe>',
		"[Regular Website](https://example.org/docs/overview)",
		"![External Image|280x400](https://example.com/banner.jpg)",
	].join("\n");

	const res = parseNoteContent(logbookDoc, "md");
	assert.equal(res.externalRefs.length, 2);
	assert.equal(res.externalRefs[0].provider, "gdrive");
	assert.equal(res.externalRefs[0].label, "Receipt-2026-0004.pdf");
	assert.equal(res.externalRefs[1].provider, "web");
});

test("buildVaultGraph conserves exact bytes between physical and logical modes including shared & ./_resources", () => {
	const entries = [
		{
			relPath: "Recipes/Pasta.md",
			name: "Pasta.md",
			isDir: false,
			apparentBytes: 2720,
			diskBytes: 4096,
			mtime: 1000,
			content: "Delicious!\n![[Pasta-image32.png]]",
		},
		{
			relPath: "Recipes/Attachments/Pasta/Pasta-image32.png",
			name: "Pasta-image32.png",
			isDir: false,
			apparentBytes: 100_000,
			diskBytes: 102_400,
			mtime: 1000,
		},
		{
			relPath: "Archive/Vacation Album.md",
			name: "Vacation Album.md",
			isDir: false,
			apparentBytes: 306,
			diskBytes: 4096,
			mtime: 1000,
			content:
				"![[./_resources/Vacation_Album.resources/photo.jpeg]]\n![[shared.png]]",
		},
		{
			relPath: "Tasks/NoteB.md",
			name: "NoteB.md",
			isDir: false,
			apparentBytes: 500,
			diskBytes: 4096,
			mtime: 1000,
			content: "![[shared.png]]\n![[missing-file.png]]",
		},
		{
			relPath: "Archive/_resources/Vacation_Album.resources/photo.jpeg",
			name: "photo.jpeg",
			isDir: false,
			apparentBytes: 50_000,
			diskBytes: 53_248,
			mtime: 1000,
		},
		{
			relPath: "Attachments/shared.png",
			name: "shared.png",
			isDir: false,
			apparentBytes: 1001,
			diskBytes: 4096,
			mtime: 1000,
		},
		{
			relPath: "Attachments/orphan.png",
			name: "orphan.png",
			isDir: false,
			apparentBytes: 77_777,
			diskBytes: 81_920,
			mtime: 1000,
		},
		{
			relPath: ".trash/OldNote.md",
			name: "OldNote.md",
			isDir: false,
			apparentBytes: 900,
			diskBytes: 4096,
			mtime: 1000,
			content: "![[orphan.png]]",
		},
	];

	const graph = buildVaultGraph("SampleVault", entries, new Set());

	assert.equal(graph.totalPhysicalBytes, graph.totalLogicalBytes);

	recomputeDisplaySizes(graph.root, graph.allFiles, "physical", "apparent", false);
	const physNoHidden = graph.root.displayBytes;
	recomputeDisplaySizes(graph.root, graph.allFiles, "logical", "apparent", false);
	const logNoHidden = graph.root.displayBytes;
	assert.equal(physNoHidden, logNoHidden);

	const orphan = graph.nodesByPath.get("Attachments/orphan.png");
	assert.ok(orphan);
	assert.equal(getNodeFlag(orphan), "O");
	assert.equal(orphan.displayBytes, 77_777);

	const shared = graph.nodesByPath.get("Attachments/shared.png");
	assert.ok(shared);
	assert.equal(getNodeFlag(shared), "S");
	assert.equal(shared.displayBytes, 0);

	const album = graph.nodesByPath.get("Archive/Vacation Album.md");
	const noteB = graph.nodesByPath.get("Tasks/NoteB.md");
	assert.equal(album.displayBytes, 306 + 50_000 + 501);
	assert.equal(noteB.displayBytes, 500 + 500);
	assert.equal(getNodeFlag(noteB), "!");
});

test("multi-folder vault verification with bookmarks, code-block masking, and frontmatter tasks", () => {
	const entries = [
		{
			relPath: "Recipes/Mediterranean Dish.md",
			name: "Mediterranean Dish.md",
			isDir: false,
			apparentBytes: 1800,
			diskBytes: 4096,
			mtime: 1000,
			content: "# Dish\n![[Dish-photo.png|400]]",
		},
		{
			relPath: "Recipes/Attachments/Mediterranean Dish/Dish-photo.png",
			name: "Dish-photo.png",
			isDir: false,
			apparentBytes: 64_000,
			diskBytes: 65_536,
			mtime: 1000,
		},
		{
			relPath: "Archive/Obsidian Setup Guide.md",
			name: "Obsidian Setup Guide.md",
			isDir: false,
			apparentBytes: 2400,
			diskBytes: 4096,
			mtime: 1000,
			content: [
				"# Setup Guide",
				"```markdown",
				"Example embed: ![[non-existent-example.pdf]]",
				"```",
				"Inline `[[also-ignored]]` snippet.",
			].join("\n"),
		},
		{
			relPath: "Tasks/Recurring Tasks.md",
			name: "Recurring Tasks.md",
			isDir: false,
			apparentBytes: 512,
			diskBytes: 4096,
			mtime: 1000,
			content: [
				"---",
				"tasks:",
				"  - id: task-1",
				"    title: Weekly backup",
				"---",
				"",
			].join("\n"),
		},
		{
			relPath: "Attachments/bookmarked-diagram.png",
			name: "bookmarked-diagram.png",
			isDir: false,
			apparentBytes: 12_345,
			diskBytes: 16_384,
			mtime: 1000,
		},
	];

	const graph = buildVaultGraph(
		"SampleVault",
		entries,
		new Set(["Attachments/bookmarked-diagram.png"])
	);
	assert.equal(graph.totalPhysicalBytes, graph.totalLogicalBytes);

	const dish = graph.nodesByPath.get("Recipes/Mediterranean Dish.md");
	assert.ok(dish);
	assert.equal(dish.outgoingAttachments.length, 1);
	assert.equal(dish.brokenLinks.length, 0);

	const setup = graph.nodesByPath.get("Archive/Obsidian Setup Guide.md");
	assert.ok(setup);
	assert.equal(setup.brokenLinks.length, 0);

	const recurring = graph.nodesByPath.get("Tasks/Recurring Tasks.md");
	assert.ok(recurring);
	assert.equal(recurring.emptyReason, "");

	const bookmarked = graph.nodesByPath.get("Attachments/bookmarked-diagram.png");
	assert.ok(bookmarked);
	assert.equal(getNodeFlag(bookmarked), " ");
	assert.equal(getNodeBadge(bookmarked, "physical"), "bookmarked");
	assert.equal(graph.orphanAttachmentCount, 0);
});

test("Smart Delete enforces path boundaries, cascades exclusive attachments to .trash, and protects shared & root folders", async () => {
	assert.equal(isSafeVaultTarget(""), false);
	assert.equal(isSafeVaultTarget("."), false);
	assert.equal(isSafeVaultTarget(".obsidian"), false);
	assert.equal(isSafeVaultTarget("../etc/passwd"), false);
	assert.equal(isSafeVaultTarget("Tasks/../../secret"), false);
	assert.equal(isSafeVaultTarget("Tasks\\evil.md"), false);
	assert.equal(isSafeVaultTarget("Tasks/Valid.md"), true);

	const entries = [
		{
			relPath: "Tasks/TargetNote.md",
			name: "TargetNote.md",
			isDir: false,
			apparentBytes: 400,
			diskBytes: 4096,
			mtime: 1000,
			content: "![[exclusive.png]]\n![[shared.png]]",
		},
		{
			relPath: "Tasks/OtherNote.md",
			name: "OtherNote.md",
			isDir: false,
			apparentBytes: 300,
			diskBytes: 4096,
			mtime: 1000,
			content: "Links to [[TargetNote]] and embeds ![[shared.png]]",
		},
		{
			relPath: "Attachments/TargetNote/exclusive.png",
			name: "exclusive.png",
			isDir: false,
			apparentBytes: 10_000,
			diskBytes: 12_288,
			mtime: 1000,
		},
		{
			relPath: "Attachments/shared.png",
			name: "shared.png",
			isDir: false,
			apparentBytes: 5_000,
			diskBytes: 8_192,
			mtime: 1000,
		},
	];

	const graph = buildVaultGraph("TestVault", entries, new Set());
	const target = graph.nodesByPath.get("Tasks/TargetNote.md");
	const plan = buildDeletePlan(target);

	assert.equal(plan.exclusiveAttachments.length, 1);
	assert.equal(plan.exclusiveAttachments[0].relPath, "Attachments/TargetNote/exclusive.png");
	assert.equal(plan.sharedAttachments.length, 1);
	assert.equal(plan.sharedAttachments[0].relPath, "Attachments/shared.png");
	assert.equal(plan.incomingBacklinks.length, 1);
	assert.equal(plan.incomingBacklinks[0].relPath, "Tasks/OtherNote.md");
	assert.equal(plan.reclaimableBytesTargetOnly, 400);
	assert.equal(plan.reclaimableBytesWithAttachments, 10_400);

	// Mock DataAdapter to verify .trash/<relPath> move & empty per-note folder cleanup
	const files = new Set([
		"Tasks/TargetNote.md",
		"Tasks/OtherNote.md",
		"Attachments/TargetNote/exclusive.png",
		"Attachments/shared.png",
	]);
	const dirs = new Set(["Tasks", "Attachments", "Attachments/TargetNote"]);

	const mockAdapter = {
		async exists(p) {
			return files.has(p) || dirs.has(p);
		},
		async mkdir(p) {
			dirs.add(p);
		},
		async rename(from, to) {
			files.delete(from);
			files.add(to);
		},
		async remove(p) {
			files.delete(p);
		},
		async rmdir(p) {
			dirs.delete(p);
		},
		async list(dir) {
			const prefix = `${dir}/`;
			return {
				files: [...files].filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/")),
				folders: [...dirs].filter((d) => d.startsWith(prefix) && !d.slice(prefix.length).includes("/")),
			};
		},
	};

	const service = new ObduTrashService({ vault: { adapter: mockAdapter } });
	const res = await service.executeDelete(plan, {
		permanent: false,
		includeExclusiveAttachments: true,
	});
	assert.equal(res.ok, true);

	// Relative .trash paths created
	assert.equal(files.has(".trash/Tasks/TargetNote.md"), true);
	assert.equal(files.has(".trash/Attachments/TargetNote/exclusive.png"), true);
	// Shared attachment remains untouched
	assert.equal(files.has("Attachments/shared.png"), true);
	// Empty Attachments/TargetNote cleaned up, root Attachments preserved!
	assert.equal(dirs.has("Attachments/TargetNote"), false);
	assert.equal(dirs.has("Attachments"), true);
});
