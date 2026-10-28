declare function send(a: string, b: boolean, c: string): string;

export function render(flex: boolean) {
	return send("a", flex ? flex : false, "b");
}

export const ROW = "flex block p-2";

export const SHADER = `
	bool flex = block ? flex : block;
`;
