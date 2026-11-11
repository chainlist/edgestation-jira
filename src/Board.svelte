<script lang="ts" module>
	/**
	 * The movement in px before a pressed card lifts. A smaller movement is a click. The page
	 * swipe waits for 10 px, so the card lifts first.
	 */
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

	/** A card that is pressed, but has not moved more than `SLOP_PX`. */
	interface Press {
		pointer: number;
		issue: Issue;
		from: number;
		card: HTMLElement;
		x: number;
		y: number;
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
	let pressed: Press | undefined;
	let drag = $state<Drag>();
	/** True if the press lifted the card. Then the click at the end of the drag opens nothing. */
	let dragged = false;

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
		if (pressed || drag || !event.isPrimary || event.button !== 0 || moving.has(issue.key)) return;
		dragged = false;
		const card = event.currentTarget as HTMLElement;
		pressed = { pointer: event.pointerId, issue, from, card, x: event.clientX, y: event.clientY };
	}

	/** Makes the pressed card follow the pointer, from the point where the press started. */
	function lift({ pointer, issue, from, card, x, y }: Press) {
		const box = card.getBoundingClientRect();
		drag = {
			pointer,
			issue,
			from,
			over: from,
			x: 0,
			y: 0,
			dx: x - box.left,
			dy: y - box.top,
			width: box.width,
			height: box.height
		};
		dragged = true;
		root.setPointerCapture(pointer);
	}

	function move(event: PointerEvent) {
		if (pressed?.pointer === event.pointerId) {
			const dx = event.clientX - pressed.x;
			const dy = event.clientY - pressed.y;
			if (Math.hypot(dx, dy) <= SLOP_PX) return;
			// A finger that goes up or down scrolls the column. A mouse has the wheel for that.
			if (event.pointerType !== 'mouse' && Math.abs(dy) > Math.abs(dx)) {
				pressed = undefined;
				return;
			}
			lift(pressed);
			pressed = undefined;
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

	/** Ends a press or a drag. Only a lift of the finger moves the card. A cancel puts it back. */
	function end(event: PointerEvent) {
		// A touch starts with an implicit capture on the pressed element. When the board takes the
		// capture, that element gets a lostpointercapture, and it bubbles up to here. It is no end.
		if (event.type === 'lostpointercapture' && event.target !== root) return;
		if (pressed?.pointer === event.pointerId) pressed = undefined;
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

<!-- The drag is a touch shortcut for a move. Tap opens the issue. -->
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
									onclick={() => !dragged && onopen(issue.key)}
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
		/* The app draws the widget card with the opacity and blur of the theme. A tint of the
		   text color keeps them visible, in a light and a dark theme. */
		background: color-mix(in oklch, var(--card-foreground) 5%, transparent);
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
		background: color-mix(in oklch, var(--card-foreground) 8%, transparent);
		color: var(--card-foreground);
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
		/* The card in the hand is solid, so the lanes under it do not show through its text. */
		background: var(--card);
		outline: 2px solid var(--primary);
		outline-offset: -2px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
		pointer-events: none;
		transform: rotate(2deg);
	}
</style>
