import { type Component, Container, Markdown, type MarkdownTheme, Spacer, visibleWidth } from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function stripAnsi(value: string): string {
	return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function isBlankLine(value: string): boolean {
	return stripAnsi(value).trim().length === 0;
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && isBlankLine(lines[start] ?? "")) start++;
	while (end > start && isBlankLine(lines[end - 1] ?? "")) end--;
	return lines.slice(start, end);
}

class UserMessageBlock implements Component {
	constructor(private child: Component) {}

	private applyBackground(line: string, width: number): string {
		const paddingNeeded = Math.max(0, width - visibleWidth(line));
		return theme.bg("userMessageBg", line + " ".repeat(paddingNeeded));
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const lines = trimBlankEdges(this.child.render(innerWidth));
		let seenFirstVisible = false;
		return lines.map((line) => {
			if (!seenFirstVisible && !isBlankLine(line)) {
				seenFirstVisible = true;
				return this.applyBackground(`${theme.fg("accent", ">")} ${line}`, width);
			}
			if (!seenFirstVisible) return this.applyBackground(line, width);
			return isBlankLine(line) ? this.applyBackground("", width) : this.applyBackground(`  ${line}`, width);
		});
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	handleInput?(data: string): void {
		this.child.handleInput?.(data);
	}
}

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.addChild(new Spacer(1));
		this.addChild(
			new UserMessageBlock(
				new Markdown(text, 0, 0, markdownTheme, {
					color: (value: string) => theme.fg("userMessageText", value),
				}),
			),
		);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = lines[lines.length - 1] + OSC133_ZONE_END + OSC133_ZONE_FINAL;
		return lines;
	}
}
