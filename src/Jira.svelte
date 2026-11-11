<script lang="ts">
	import type { WidgetProps } from '@edgestation/sdk';
	import { SvelteSet } from 'svelte/reactivity';
	import BoardView from './Board.svelte';
	import IssueDetails from './Details.svelte';
	import {
		connect,
		JiraError,
		messageOf,
		parseBoard,
		type Board,
		type Column,
		type Issue
	} from './jira.ts';

	let props: WidgetProps = $props();
	// `api` does not change. A changed setting mounts the widget again.
	// svelte-ignore state_referenced_locally
	const { api } = props;
	const address = api.settings.board.trim();
	const email = api.settings.email.trim();
	const token = api.settings.token.trim();
	const ref = address ? parseBoard(address) : null;
	const jira = ref && token ? connect(api, ref.site, email, token) : null;

	let board = $state.raw<Board>();
	/** The last load failed. A board from before stays on the screen. */
	let failure = $state.raw<unknown>();
	/** The keys of the issues that move now. */
	const moving = new SvelteSet<string>();
	/** The key of the issue whose details show. */
	let open = $state<string>();
	/** Why the last move failed. It goes away after a few seconds. */
	let notice = $state<string>();
	let hideNotice: (() => void) | undefined;
	let busy = false;

	// A load during a move could put the card back in its old column for a moment.
	const refresh = api.guard(async () => {
		if (!jira || busy || moving.size) return;
		busy = true;
		try {
			board = await api.loading(jira.board(ref!.id));
			failure = undefined;
		} catch (error) {
			console.warn('Jira:', error);
			failure = error;
		} finally {
			busy = false;
		}
	});
	api.every(60_000, refresh);
	refresh();

	const place = (key: string, status: string) => {
		if (board) {
			const issues = board.issues.map((i) => (i.key === key ? { ...i, status } : i));
			board = { ...board, issues };
		}
	};

	/** Shows the card in `column` at once, and puts it back if Jira refuses the move. */
	const move = api.guard(async (issue: Issue, column: Column) => {
		moving.add(issue.key);
		hideNotice?.();
		notice = undefined;
		if (column.statuses[0]) place(issue.key, column.statuses[0]);
		try {
			place(issue.key, await jira!.move(issue.key, column));
		} catch (error) {
			place(issue.key, issue.status);
			notice = `${issue.key}: ${messageOf(error)}`;
			hideNotice = api.after(6000, () => (notice = undefined));
		} finally {
			moving.delete(issue.key);
		}
	});

	/** The title and the hint for a load that failed before the first board. */
	function explain(error: unknown): [string, string] {
		if (!(error instanceof JiraError)) {
			return ["Jira can't be reached", 'Trying again every minute.'];
		}
		if (error.status === 401) {
			return [
				'Jira refused the token',
				email
					? 'Check the email and the API token.'
					: 'Check the token. Jira Cloud also needs the email.'
			];
		}
		if (error.status === 404) return ['Board not found', error.message];
		return ["Can't show the board", error.message];
	}
</script>

{#snippet message(title: string, hint?: string)}
	<div class="message">
		<p class="title">{title}</p>
		{#if hint}<p class="hint">{hint}</p>{/if}
	</div>
{/snippet}

<!-- `el` is the size container, so its padding cannot use cqh or cqw. Put the layout in it. -->
<div class="jira">
	{#if !address}
		{@render message(
			'No board yet',
			"Paste the board's address in Settings → Pages, by clicking this widget."
		)}
	{:else if !ref}
		{@render message('Board address not recognized', address)}
	{:else if !token}
		{@render message('No token yet', 'Set the token in Settings → Pages, by clicking this widget.')}
	{:else if !board}
		<!-- Until the first board comes, the app shows dots for `api.loading`. -->
		{#if failure}
			{@const [title, hint] = explain(failure)}
			{@render message(title, hint)}
		{/if}
	{:else}
		<!-- The details have no background of their own, so the board hides under them. It stays
		     mounted, so its columns keep their scroll. -->
		<div class="view" class:covered={open}>
			<BoardView
				{api}
				{board}
				{moving}
				offline={!!failure}
				onmove={move}
				onopen={(key) => (open = key)}
			/>
		</div>
		{#if notice}
			<p class="notice" role="alert">{notice}</p>
		{/if}
		{#if open && jira}
			{#key open}
				<IssueDetails {api} {jira} key={open} onclose={() => (open = undefined)} />
			{/key}
		{/if}
	{/if}
</div>

<style>
	.jira {
		position: relative;
		height: 100%;
		overflow: hidden;
		/* The text scales with the cell, and stays readable in a small cell. */
		font-size: clamp(10px, min(2.6cqh, 1.3cqw), 18px);
	}

	.view {
		height: 100%;
	}

	.covered {
		visibility: hidden;
	}

	/* The board and the details use these buttons. */
	:where(.jira) :global(button) {
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: inherit;
		cursor: pointer;
	}

	.message {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3cqh;
		height: 100%;
		padding: 0 6cqw;
		text-align: center;
	}

	.message p {
		max-width: 100%;
		margin: 0;
		overflow-wrap: anywhere;
		color: var(--muted-foreground);
	}

	.title {
		font-size: min(8cqh, 6cqw);
		font-weight: 600;
	}

	.hint {
		font-size: min(5cqh, 4cqw);
	}

	.notice {
		position: absolute;
		right: 0.75em;
		bottom: 0.75em;
		left: 0.75em;
		margin: 0;
		padding: 0.6em 0.9em;
		border-radius: var(--radius);
		background: color-mix(in oklch, var(--destructive) 30%, var(--card));
		color: var(--card-foreground);
		pointer-events: none;
	}
</style>
