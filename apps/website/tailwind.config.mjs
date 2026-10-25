/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#fdfcfb',
          100: '#fbfaf7',
          200: '#f4efe6',
          300: '#eadeca',
          400: '#e5ded1',
          500: '#d6cebf',
          600: '#9c9484',
          700: '#6e6758',
          800: '#423d32',
          900: '#1f242e',
        },
        obsidian: {
          950: '#0c0e12',
          900: '#13161c',
          850: '#181c24',
          800: '#202530',
          700: '#262c38',
          600: '#3a4254',
          400: '#8a94a6',
          200: '#cbd5e1',
          100: '#f1f3f7',
        },
        afwe: {
          commit: '#10b981',
          stage: '#f59e0b',
          redo: '#ef4444',
          inferred: '#f97316',
          pinned: '#6366f1',
          unmapped: '#94a3b8',
          advisory: '#06b6d4',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Geist Mono', 'Fira Code', 'Consolas', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
