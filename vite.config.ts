import { widget } from '@edgestation/sdk/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// `emitCss: false` keeps each component's styles in its JavaScript: Svelte adds them to the
// widget's shadow root when it mounts, so there is no CSS file.
export default defineConfig({ plugins: [svelte({ emitCss: false }), widget()] });
