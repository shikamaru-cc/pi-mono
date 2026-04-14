import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Container, Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import { getLanguageFromPath, highlightCode } from "../../modes/interactive/theme/theme.js";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToCwd } from "./path-utils.js";
import { invalidArgText, normalizeDisplayText, replaceTabs, shortenPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}

function countContentLines(fileContent: string): number {
	if (fileContent.length === 0) {
		return 0;
	}
	return normalizeDisplayText(fileContent).split("\n").length;
}

function formatWriteCall(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const rawPath = str(args?.file_path ?? args?.path);
	const fileContent = str(args?.content);
	const path = rawPath !== null ? shortenPath(rawPath) : null;
	const invalidArg = invalidArgText(theme);
	const lineCount = fileContent === null ? null : countContentLines(fileContent);
	const lineCountText =
		lineCount === null ? "" : theme.fg("muted", ` (${lineCount} ${lineCount === 1 ? "line" : "lines"})`);
	let text = `${theme.fg("toolTitle", theme.bold("write"))} ${path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...")}${lineCountText}`;

	if (fileContent === null) {
		text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
	}

	return text;
}

function formatWritePreview(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	const fileContent = str(args?.content);
	if (fileContent === null || !fileContent) {
		return undefined;
	}
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	const renderedLines = lang
		? highlightCode(replaceTabs(normalizeDisplayText(fileContent)), lang)
		: normalizeDisplayText(fileContent).split("\n");
	const lines = trimTrailingEmptyLines(renderedLines);
	const totalLines = lines.length;
	const maxLines = options.expanded ? lines.length : 10;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;
	let text = displayLines.map((line) => (lang ? line : theme.fg("toolOutput", replaceTabs(line)))).join("\n");
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines, ${totalLines} total,`)} ${keyHint("app.tools.expand", "to expand")})`;
	}
	return text;
}

function formatWriteResult(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	result: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean },
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string | undefined {
	const preview = formatWritePreview(args, options, theme);
	const output = result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
	const status = result.isError && output ? theme.fg("error", output) : undefined;
	if (!preview && !status) {
		return undefined;
	}
	if (!preview) {
		return `\n${status}`;
	}
	if (!status) {
		return `\n${preview}`;
	}
	return `\n${preview}\n\n${status}`;
}

export function createWriteToolDefinition(
	cwd: string,
	options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, undefined> {
	const ops = options?.operations ?? defaultWriteOperations;
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: "Create or overwrite files",
		promptGuidelines: ["Use write only for new files or complete rewrites."],
		parameters: writeSchema,
		async execute(
			_toolCallId,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const absolutePath = resolveToCwd(path, cwd);
			const dir = dirname(absolutePath);
			return withFileMutationQueue(
				absolutePath,
				() =>
					new Promise<{ content: Array<{ type: "text"; text: string }>; details: undefined }>(
						(resolve, reject) => {
							if (signal?.aborted) {
								reject(new Error("Operation aborted"));
								return;
							}
							let aborted = false;
							const onAbort = () => {
								aborted = true;
								reject(new Error("Operation aborted"));
							};
							signal?.addEventListener("abort", onAbort, { once: true });
							(async () => {
								try {
									// Create parent directories if needed.
									await ops.mkdir(dir);
									if (aborted) return;
									// Write the file contents.
									await ops.writeFile(absolutePath, content);
									if (aborted) return;
									signal?.removeEventListener("abort", onAbort);
									resolve({
										content: [
											{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` },
										],
										details: undefined,
									});
								} catch (error: any) {
									signal?.removeEventListener("abort", onAbort);
									if (!aborted) reject(error);
								}
							})();
						},
					),
			);
		},
		renderCall(args, theme, context) {
			const renderArgs = args as { path?: string; file_path?: string; content?: string } | undefined;
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			component.setText(formatWriteCall(renderArgs, theme));
			return component;
		},
		renderResult(result, options, theme, context) {
			const output = formatWriteResult(
				context.args as { path?: string; file_path?: string; content?: string } | undefined,
				{ ...result, isError: context.isError },
				options,
				theme,
			);
			if (!output) {
				const component = (context.lastComponent as Container | undefined) ?? new Container();
				component.clear();
				return component;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(output);
			return text;
		},
	};
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
	return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}

/** Default write tool using process.cwd() for backwards compatibility. */
export const writeToolDefinition = createWriteToolDefinition(process.cwd());
export const writeTool = createWriteTool(process.cwd());
