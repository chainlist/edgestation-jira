<script lang="ts" module>
	/** The time in ms that the user holds a card before it follows the finger. */
	const HOLD_MS = 400;
	/** The finger movement in px that changes a hold into a scroll or a page swipe. */
	const SLOP_PX = 8;
	const DAY_MS = 86_400_000;

	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((word) => word[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
</script>

<script lang="ts">
	import type { WidgetApi } from '@edgestation/sdk';
	import type { SvelteSet } from 'svelte/reactivity';
	import type { Board, Column, Issue } from './jira.ts';

	interface Props {
		api: WidgetApi;
		board: Board;
		moving: SvelteSet<string>;
		/** The last load failed, so the board can be old. */
		offline: boolean;
		onmove: (issue: Issue, column: Column) => void;
		onopen: (key: string) => void;
	}

	let { api, board, moving, offline, onmove, onopen }: Props = $props();

	/** A card that the finger holds. It is picked up after `HOLD_MS`. */
	interface Hold {
		pointer: number;
		x: number;
		y: number;
		cancel: () => void;
	}

	/** A card that follows the finger. Positions are in px from the top left of the board. */
	interface Drag {
		pointer: number;
		issue: Issue;
		from: number;
		/** The column under the finger. */
		over: number;
		x: number;
		y: number;
		/** Where the finger holds the card, from its top left corner. */
		dx: number;
		dy: number;
		width: number;
		height: number;
	}

	let root: HTMLElement;
	const columnEls: HTMLElement[] = [];
	let hold: Hold | undefined;
	let drag = $state<Drag>();
	/** True if a hold picked up the card. Then the click at the end of the hold opens nothing. */
	let held = false;

	const lanes = $derived(
		board.columns.map((column) =>
			board.issues.filter((issue) => column.statuses.includes(issue.status))
		)
	);

	const title = $derived(board.sprints.map((sprint) => sprint.name).join(' · ') || board.name);

	const left = $derived.by(() => {
		if (!board.sprints.length) return 'No active sprint';
		const end = board.sprints.find((sprint) => sprint.end !== null)?.end;
		if (end == null) return '';
		const days = Math.ceil((end - Date.now()) / DAY_MS);
		return days < 0
			? 'Ended'
			: days === 0
				? 'Ends today'
				: days === 1
					? '1 day left'
					: `${days} days left`;
	});

	function press(event: PointerEvent, issue: Issue, from: number) {
		if (hold || drag || !event.isPrimary || event.button !== 0 || moving.has(issue.key)) return;
		held = false;
		const card = event.currentTarget as HTMLElement;
		const { pointerId: pointer, clientX: x, clientY: y } = event;
		const cancel = api.after(HOLD_MS, () => {
			hold = undefined;
			held = true;
			const box = card.getBoundingClientRect();
			const area = root.getBoundingClientRect();
			drag = {
				pointer,
				issue,
				from,
				over: from,
				x: x - area.left,
				y: y - area.top,
				dx: x - box.left,
				dy: y - box.top,
				width: box.width,
				height: box.height
			};
			root.setPointerCapture(pointer);
		});
		hold = { pointer, x, y, cancel };
	}

	function release() {
		hold?.cancel();
		hold = undefined;
	}

	function move(event: PointerEvent) {
		if (hold?.pointer === event.pointerId) {
			// A move before the hold ends is a scroll or a page swipe. It is not a drag.
			if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > SLOP_PX) release();
			return;
		}
		if (event.pointerId !== drag?.pointer) return;
		// The page does not get the drag, so it does not swipe.
		event.stopPropagation();
		const area = root.getBoundingClientRect();
		const over = columnEls.findIndex((column) => {
			const box = column.getBoundingClientRect();
			return event.clientX >= box.left && event.clientX < box.right;
		});
		drag = {
			...drag,
			x: event.clientX - area.left,
			y: event.clientY - area.top,
			over: over < 0 ? drag.over : over
		};
	}

	/** Ends a hold or a drag. Only a lift of the finger moves the card. A cancel puts it back. */
	function end(event: PointerEvent) {
		release();
		if (event.pointerId !== drag?.pointer) return;
		const { issue, from, over } = drag;
		drag = undefined;
		if (event.type === 'pointerup' && over !== from) onmove(issue, board.columns[over]);
	}

	/**
	 * A touch that moves a card must not scroll the column. Else the browser takes the touch
	 * and cancels the drag. Svelte adds touchmove listeners as passive, so add this one here.
	 */
	function noScroll(element: HTMLElement) {
		const stop = (event: TouchEvent) => {
			if (drag && event.cancelable) event.preventDefault();
		};
		element.addEventListener('touchmove', stop, { passive: false });
		return () => element.removeEventListener('touchmove', stop);
	}
</script>

{#snippet card(issue: Issue)}
	<span class="summary">{issue.summary}</span>
	<span class="meta">
		<span class="key">{issue.key}</span>
		{#if issue.assignee}
			<span class="avatar" title={issue.assignee}>{initials(issue.assignee)}</span>
		{/if}
	</span>
{/snippet}

<!-- The hold and drag are touch shortcuts for a move. Tap opens the issue. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="board"
	bind:this={root}
	{@attach noScroll}
	onpointermove={move}
	onpointerup={end}
	onpointercancel={end}
	onlostpointercapture={end}
	oncontextmenu={(event) => event.preventDefault()}
>
	<header>
		<span class="sprint">{title}</span>
		{#if offline}<span class="offline">Offline</span>{/if}
		<span class="left">{left}</span>
	</header>
	<div class="columns">
		{#each board.columns as column, i}
			<section
				class="column"
				class:target={drag && drag.over === i && drag.over !== drag.from}
				bind:this={columnEls[i]}
			>
				<h2>
					<span class="name">{column.name}</span>
					<span class="count">{lanes[i].length}</span>
				</h2>
				<div class="scroll">
					<ul {@attach (list) => api.scrollbars(list)}>
						{#each lanes[i] as issue (issue.key)}
							<li>
								<button
									class="card"
									class:lifted={drag?.issue.key === issue.key}
									class:moving={moving.has(issue.key)}
									onpointerdown={(event) => press(event, issue, i)}
									onclick={() => !held && onopen(issue.key)}
								>
									{@render card(issue)}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			</section>
		{/each}
	</div>
	{#if drag}
		<div
			class="card ghost"
			style:left="{drag.x - drag.dx}px"
			style:top="{drag.y - drag.dy}px"
			style:width="{drag.width}px"
			style:height="{drag.height}px"
		>
			{@render card(drag.issue)}
		</div>
	{/if}
</div>

<style>
	.board {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.6em;
		height: 100%;
		padding: 0.75em;
		box-sizing: border-box;
		user-select: none;
		-webkit-touch-callout: none;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.75em;
		padding: 0 0.25em;
	}

	.sprint {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.offline {
		color: var(--destructive);
	}

	.left {
		flex: none;
		color: var(--muted-foreground);
	}

	.columns {
		display: flex;
		flex: 1;
		gap: 0.6em;
		min-height: 0;
	}

	.column {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		border-radius: var(--radius);
		background: var(--muted);
		transition: box-shadow 0.15s;
	}

	.column.target {
		box-shadow: inset 0 0 0 2px var(--primary);
	}

	h2 {
		display: flex;
		gap: 0.5em;
		margin: 0;
		padding: 0.6em 0.7em 0.4em;
		font-size: 0.8em;
		font-weight: 600;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scroll {
		flex: 1;
		min-height: 0;
	}

	ul {
		height: 100%;
		margin: 0;
		padding: 0 0.5em 0.5em;
		list-style: none;
		/* The page takes a sideways touch for a swipe. The column scrolls up and down. */
		touch-action: pan-y;
	}

	li + li {
		margin-top: 0.5em;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.5em;
		width: 100%;
		padding: 0.6em 0.7em;
		box-sizing: border-box;
		border-radius: calc(var(--radius) * 0.75);
		background: var(--card);
		color: var(--card-foreground);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
		transition: opacity 0.15s;
	}

	.summary {
		display: -webkit-box;
		overflow: hidden;
		line-height: 1.3;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}

	.meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5em;
	}

	.key {
		font-size: 0.8em;
		color: var(--muted-foreground);
	}

	.avatar {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.8em;
		aspect-ratio: 1;
		border-radius: 50%;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 0.7em;
		font-weight: 600;
	}

	.card.lifted {
		opacity: 0.3;
	}

	.card.moving {
		opacity: 0.6;
	}

	.ghost {
		position: absolute;
		z-index: 1;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
		pointer-events: none;
		transform: rotate(2deg);
	}
</style>
