import type { AssistantMessage } from "@mariozechner/pi-ai";
import { type Component, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

function stripAnsi(value: string): string {
	return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function isBlankLine(value: string): boolean {
	return stripAnsi(value).trim().length === 0;
}

function trimLeadingBlankLines(lines: string[]): string[] {
	let start = 0;
	while (start < lines.length && isBlankLine(lines[start] ?? "")) start++;
	return lines.slice(start);
}

class AssistantReplyBlock implements Component {
	constructor(
		private child: Component,
		private showBullet: boolean,
	) {}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const lines = trimLeadingBlankLines(this.child.render(innerWidth));
		let seenFirstVisible = false;
		return lines.map((line) => {
			if (!seenFirstVisible && !isBlankLine(line)) {
				seenFirstVisible = true;
				return `${this.showBullet ? theme.fg("accent", "●") : " "} ${line}`;
			}
			if (!seenFirstVisible) return line;
			return isBlankLine(line) ? "" : `  ${line}`;
		});
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	handleInput?(data: string): void {
		this.child.handleInput?.(data);
	}
}

class ThinkingBlock implements Component {
	private title: Text;

	constructor(
		private titleLabel: string,
		private child?: Component,
	) {
		this.title = new Text("", 0, 0);
	}

	render(width: number): string[] {
		this.title.setText(theme.fg("thinkingText", this.titleLabel));
		const titleLines = this.title.render(width);
		if (!this.child) {
			return titleLines;
		}

		const innerWidth = Math.max(1, width - 2);
		const bodyLines = trimLeadingBlankLines(this.child.render(innerWidth)).map((line) => {
			return isBlankLine(line) ? "" : `  ${line}`;
		});
		return [...titleLines, "", ...bodyLines];
	}

	invalidate(): void {
		this.title.invalidate?.();
		this.child?.invalidate?.();
	}

	handleInput?(data: string): void {
		this.child?.handleInput?.(data);
	}
}

function hasVisibleAssistantContent(message: AssistantMessage): boolean {
	return message.content.some((content) => {
		return (
			(content.type === "text" && content.text.trim().length > 0) ||
			(content.type === "thinking" && content.thinking.trim().length > 0)
		);
	});
}

function hasVisibleAssistantContentAfter(message: AssistantMessage, index: number): boolean {
	return message.content.slice(index + 1).some((content) => {
		return (
			(content.type === "text" && content.text.trim().length > 0) ||
			(content.type === "thinking" && content.thinking.trim().length > 0)
		);
	});
}

function getThinkingTitle(hiddenThinkingLabel: string, hideThinkingBlock: boolean): string {
	if (hideThinkingBlock && hiddenThinkingLabel.trim() && hiddenThinkingLabel !== "Thinking...") {
		return hiddenThinkingLabel.trim();
	}
	return "○ Thinking";
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private lastMessage?: AssistantMessage;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;
		this.contentContainer.clear();

		if (hasVisibleAssistantContent(message)) {
			this.contentContainer.addChild(new Spacer(1));
		}

		let usedBullet = false;

		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				this.contentContainer.addChild(
					new AssistantReplyBlock(new Markdown(content.text.trim(), 0, 0, this.markdownTheme), !usedBullet),
				);
				usedBullet = true;
				if (hasVisibleAssistantContentAfter(message, i)) {
					this.contentContainer.addChild(new Spacer(1));
				}
			} else if (content.type === "thinking" && content.thinking.trim()) {
				const thinkingTitle = getThinkingTitle(this.hiddenThinkingLabel, this.hideThinkingBlock);
				if (this.hideThinkingBlock) {
					this.contentContainer.addChild(new ThinkingBlock(thinkingTitle));
				} else {
					this.contentContainer.addChild(
						new ThinkingBlock(
							thinkingTitle,
							new Markdown(content.thinking.trim(), 0, 0, this.markdownTheme, {
								color: (text: string) => theme.fg("thinkingText", text),
								italic: true,
							}),
						),
					);
				}
				if (hasVisibleAssistantContentAfter(message, i)) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		const hasToolCalls = message.content.some((content) => content.type === "toolCall");
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				if (hasVisibleAssistantContent(message)) {
					this.contentContainer.addChild(new Spacer(1));
				}
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), 0, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				if (hasVisibleAssistantContent(message)) {
					this.contentContainer.addChild(new Spacer(1));
				}
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 0, 0));
			}
		}
	}
}
