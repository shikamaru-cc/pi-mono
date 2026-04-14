import { Loader, truncateToWidth } from "@mariozechner/pi-tui";

function stripAnsi(value: string): string {
	return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function stripLeadingSpaces(value: string): string {
	let index = 0;
	while (index < value.length && value[index] === " ") {
		index++;
	}
	return value.slice(index);
}

export class StatusLoader extends Loader {
	override render(width: number): string[] {
		const lines = super.render(width);
		return lines.map((line, index) => {
			if (index === 0 || stripAnsi(line).trim().length === 0) {
				return line;
			}
			return truncateToWidth(stripLeadingSpaces(line), width, "");
		});
	}
}
