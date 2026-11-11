import type { WidgetApi } from '@edgestation/sdk';

/** The board to show. `site` is the root URL of Jira, with no slash at the end. */
export interface BoardRef {
	site: string;
	id: string;
}

export interface Column {
	name: string;
	/** The ids of the statuses in the column. */
	statuses: string[];
}

export interface Issue {
	key: string;
	summary: string;
	/** A status id. */
	status: string;
	/** The display name of the assignee, or `null` if nobody has the issue. */
	assignee: string | null;
}

export interface Sprint {
	name: string;
	/** The end date in ms since the epoch, or `null` if the sprint has no end date. */
	end: number | null;
}

export interface Board {
	name: string;
	columns: Column[];
	/** The active sprints, usually one. Empty if the board has no active sprint. */
	sprints: Sprint[];
	issues: Issue[];
}

export interface Details {
	key: string;
	summary: string;
	type: string;
	status: string;
	priority: string | null;
	assignee: string | null;
	reporter: string | null;
	/** The description as HTML that Jira makes, or `null` if the issue has none. */
	description: string | null;
}

/** An error that Jira sent back. `status` is the HTTP status, 0 if the widget found the error. */
export class JiraError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** The text of an error, also for a rejection that is not an `Error`. */
export const messageOf = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/**
 * Finds the board in the address of a board page, or returns `null`. Jira Cloud has
 * `.../jira/software/projects/KEY/boards/1`. Data Center has `.../secure/RapidBoard.jspa?rapidView=1`,
 * and it can sit below a path such as `/jira`.
 */
export function parseBoard(address: string): BoardRef | null {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const id = url.pathname.match(/\/boards\/(\d+)/)?.[1] ?? url.searchParams.get('rapidView');
	if (!id || !/^\d+$/.test(id)) return null;
	const root = url.pathname.match(/^(.*?)\/(?:secure|jira\/software)\//)?.[1] ?? '';
	return { site: url.origin + root, id };
}

/**
 * Jira Cloud wants the email and an API token (Basic). Data Center and Server want a
 * personal acess token alone (Bearer).
 */
export function authorization(email: string, token: string) {
	if (!email) return `Bearer ${token}`;
	const bytes = new TextEncoder().encode(`${email}:${token}`);
	return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

interface BoardConfiguration {
	name: string;
	columnConfig: { columns: { name: string; statuses: { id: string }[] }[] };
}

interface SprintData {
	id: number;
	name: string;
	endDate?: string;
}

interface IssueData {
	key: string;
	fields: {
		summary: string;
		status: { id: string; name: string };
		assignee: { displayName: string } | null;
		issuetype?: { name: string };
		priority?: { name: string } | null;
		reporter?: { displayName: string } | null;
	};
	renderedFields?: { description?: string | null };
}

interface Transition {
	id: string;
	to: { id: string };
}

async function reason(response: Response) {
	try {
		const body = await response.json();
		const all = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {}), body.message];
		const first = all.find((message) => typeof message === 'string' && message);
		if (first) return first as string;
	} catch {
		// The body is not JSON. The status tells enough.
	}
	return `Jira answered ${response.status}`;
}

export type Jira = ReturnType<typeof connect>;

/** A client for one Jira site. Each call goes through `api.fetch`, so CORS does not apply. */
export function connect(api: WidgetApi, site: string, email: string, token: string) {
	const headers = {
		Accept: 'application/json',
		Authorization: authorization(email, token),
		// Without this header, Jira refuses a POST that has an Origin (its XSRF check).
		'X-Atlassian-Token': 'no-check'
	};

	async function call<T>(path: string, body?: unknown): Promise<T> {
		const response = await api.fetch(
			site + path,
			body === undefined
				? { headers }
				: {
						method: 'POST',
						headers: { ...headers, 'Content-Type': 'application/json' },
						body: JSON.stringify(body)
					}
		);
		if (!response.ok) throw new JiraError(response.status, await reason(response));
		return response.status === 204 ? (undefined as T) : response.json();
	}

	// The columns change seldom. The widget reads them once for each mount.
	let configuration: Promise<BoardConfiguration> | undefined;

	/** Reads the columns of board `id`, and the issues of its active sprints in the board order. */
	async function board(id: string): Promise<Board> {
		const base = `/rest/agile/1.0/board/${id}`;
		configuration ??= call<BoardConfiguration>(`${base}/configuration`).catch((error) => {
			configuration = undefined;
			throw error;
		});
		const [config, active] = await Promise.all([
			configuration,
			call<{ values: SprintData[] }>(`${base}/sprint?state=active`)
		]);
		const issues = new Map<string, Issue>();
		for (const sprint of active.values) {
			for (let start = 0; ;) {
				const page = await call<{ issues: IssueData[]; total: number }>(
					`${base}/sprint/${sprint.id}/issue?fields=summary,status,assignee&maxResults=100&startAt=${start}`
				);
				for (const { key, fields } of page.issues) {
					issues.set(key, {
						key,
						summary: fields.summary,
						status: fields.status.id,
						assignee: fields.assignee?.displayName ?? null
					});
				}
				start += page.issues.length;
				if (!page.issues.length || start >= page.total) break;
			}
		}
		return {
			name: config.name,
			columns: config.columnConfig.columns.map((column) => ({
				name: column.name,
				statuses: column.statuses.map((status) => status.id)
			})),
			sprints: active.values.map((sprint) => ({
				name: sprint.name,
				end: sprint.endDate ? Date.parse(sprint.endDate) : null
			})),
			issues: [...issues.values()]
		};
	}

	/**
	 * Moves issue `key` to `column` with the first transition that goes to a status of the
	 * column. Returns that status id. A transition with a screen of required fields fails, and
	 * Jira's message tells why.
	 */
	async function move(key: string, column: Column): Promise<string> {
		const path = `/rest/api/2/issue/${key}/transitions`;
		const { transitions } = await call<{ transitions: Transition[] }>(path);
		const transition = transitions.find((t) => column.statuses.includes(t.to.id));
		if (!transition) throw new JiraError(0, `No transition goes to ${column.name}`);
		await call(path, { transition: { id: transition.id } });
		return transition.to.id;
	}

	async function details(key: string): Promise<Details> {
		const { fields, renderedFields } = await call<IssueData>(
			`/rest/api/2/issue/${key}?fields=summary,issuetype,status,priority,assignee,reporter,description&expand=renderedFields`
		);
		return {
			key,
			summary: fields.summary,
			type: fields.issuetype?.name ?? '',
			status: fields.status.name,
			priority: fields.priority?.name ?? null,
			assignee: fields.assignee?.displayName ?? null,
			reporter: fields.reporter?.displayName ?? null,
			description: renderedFields?.description || null
		};
	}

	return { site, board, move, details };
}
