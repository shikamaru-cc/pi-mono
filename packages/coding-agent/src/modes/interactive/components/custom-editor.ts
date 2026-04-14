import { Editor, type EditorOptions, type EditorTheme, type TUI, truncateToWidth } from "@mariozechner/pi-tui";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.js";

function stripAnsi(value: string): string {
	return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function isBorderLine(value: string): boolean {
	return stripAnsi(value).includes("─");
}

function stripLeadingSpaces(value: string, count: number): string {
	let remaining = count;
	let index = 0;
	while (remaining > 0 && index < value.length && value[index] === " ") {
		index++;
		remaining--;
	}
	return value.slice(index);
}

/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor {
	private static readonly FIRST_LINE_PREFIX = "> ";
	private static readonly CONTINUATION_PREFIX = "  ";

	private keybindings: KeybindingsManager;
	public actionHandlers: Map<AppKeybinding, () => void> = new Map();

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length < 3) {
			return lines;
		}

		let bottomBorderIndex = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			if (isBorderLine(lines[i] ?? "")) {
				bottomBorderIndex = i;
				break;
			}
		}
		if (bottomBorderIndex <= 0) {
			return lines;
		}

		const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
		const effectivePadding = Math.min(this.getPaddingX(), maxPadding);
		let isFirstEditorLine = true;

		for (let i = 1; i < lines.length; i++) {
			if (i === bottomBorderIndex) {
				continue;
			}
			const prefix = isFirstEditorLine ? CustomEditor.FIRST_LINE_PREFIX : CustomEditor.CONTINUATION_PREFIX;
			const strippedLine = stripLeadingSpaces(lines[i] ?? "", effectivePadding);
			lines[i] = truncateToWidth(`${prefix}${strippedLine}`, width, "");
			isFirstEditorLine = false;
		}

		return lines;
	}

	handleInput(data: string): void {
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		// Check for paste image keybinding
		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}

		// Check app keybindings first

		// Escape/interrupt - only if autocomplete is NOT active
		if (this.keybindings.matches(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				// Use dynamic onEscape if set, otherwise registered handler
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			// Let parent handle escape for autocomplete cancellation
			super.handleInput(data);
			return;
		}

		// Exit (Ctrl+D) - only when editor is empty
		if (this.keybindings.matches(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
			// Fall through to editor handling for delete-char-forward when not empty
		}

		// Check all other app actions
		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
				handler();
				return;
			}
		}

		// Pass to parent for editor handling
		super.handleInput(data);
	}
}
