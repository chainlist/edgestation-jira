<script lang="ts">
	import type { WidgetApi } from '@edgestation/sdk';
	import { messageOf, type Details, type Jira } from './jira.ts';

	interface Props {
		api: WidgetApi;
		jira: Jira;
		key: string;
		onclose: () => void;
	}

	let props: Props = $props();
	// The board mounts a new panel for each issue, so the props do not change.
	// svelte-ignore state_referenced_locally
	const { api, jira, key, onclose } = props;

	let details = $state.raw<Details>();
	let failure = $state<string>();

	api.guard(async () => {
		try {
			details = await jira.details(key);
		} catch (error) {
			failure = messageOf(error);
		}
	})();

	/**
	 * Jira's HTML goes in a sandboxed frame with no scripts, so it cannot reach the app. The
	 * frame does not get the theme variables, so give it the colors that they have here.
	 */
	function page(frame: HTMLIFrameElement, html: string) {
		const style = getComputedStyle(frame);
		const color = (name: string) => style.getPropertyValue(name);
		return `<!doctype html><base href="${jira.site}/" target="_blank"><style>
			html { scrollbar-width: thin; scrollbar-color: ${color('--muted-foreground')} transparent; }
			body { margin: 0; font: ${style.fontSize}/1.5 ${style.fontFamily}; color: ${color('--card-foreground')}; overflow-wrap: anywhere; }
			a { color: ${color('--primary')}; }
			img { max-width: 100%; height: auto; }
			pre, code { white-space: pre-wrap; font-size: 0.9em; }
			table { border-collapse: collapse; }
			th, td { border: 1px solid ${color('--border')}; padding: 0.2em 0.4em; }
			body > :first-child { margin-top: 0; }
		</style>${html}`;
	}

	const fields = $derived(
		details
			? [
					['Assignee', details.assignee ?? 'Unassigned'],
					['Reporter', details.reporter ?? 'None'],
					['Priority', details.priority ?? 'None']
				]
			: []
	);
</script>

<div class="details" role="dialog" aria-label={key}>
	<header>
		<span class="key">{details?.type ? `${details.type} · ${key}` : key}</span>
		{#if details}<span class="status">{details.status}</span>{/if}
		<button class="close" aria-label="Close" onclick={onclose}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
		</button>
	</header>
	{#if details}
		<h2>{details.summary}</h2>
		<dl>
			{#each fields as [label, value] (label)}
				<div>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			{/each}
		</dl>
		{#if details.description}
			<iframe
				title="Description"
				sandbox=""
				{@attach (frame) => {
					frame.srcdoc = page(frame, details!.description!);
				}}
			></iframe>
		{:else}
			<p class="empty">No description</p>
		{/if}
	{:else}
		<p class="empty">{failure ?? '…'}</p>
	{/if}
</div>

<style>
	.details {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.75em;
		padding: 1em 1.25em;
		box-sizing: border-box;
		background: var(--card);
		color: var(--card-foreground);
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.75em;
	}

	.key {
		color: var(--muted-foreground);
	}

	.status {
		padding: 0.15em 0.6em;
		border-radius: 999px;
		background: var(--secondary);
		color: var(--secondary-foreground);
		font-size: 0.8em;
		font-weight: 600;
		text-transform: uppercase;
	}

	.close {
		display: grid;
		place-items: center;
		width: 2.4em;
		aspect-ratio: 1;
		margin-left: auto;
		border-radius: 50%;
	}

	.close:active {
		background: var(--muted);
	}

	.close svg {
		width: 60%;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	h2 {
		margin: 0;
		font-size: 1.3em;
		line-height: 1.25;
	}

	dl {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4em 2em;
		margin: 0;
	}

	dt {
		font-size: 0.8em;
		color: var(--muted-foreground);
	}

	dd {
		margin: 0;
	}

	iframe {
		flex: 1;
		min-height: 0;
		border: none;
		color-scheme: normal;
	}

	.empty {
		margin: 0;
		color: var(--muted-foreground);
	}
</style>
