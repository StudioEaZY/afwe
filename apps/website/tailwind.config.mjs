/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#faf7f0',   // primary canvas
          100: '#f4efe4',  // paper surface
          200: '#eae2d3',  // elevated container
          300: '#ded4c2',  // interactive hover
          400: '#c5b8a0',  // high-contrast border
          500: '#948770',  // muted icon stroke
          600: '#575043',  // WCAG AA body muted (5.8:1)
          700: '#3c362c',  // WCAG AAA secondary text (9.5:1)
          800: '#231f18',  // WCAG AAA deep body (14.2:1)
          900: '#14120e',  // WCAG AAA ink black (17.5:1)
        },
        obsidian: {
          950: '#0a0c0f',  // master dark canvas
          900: '#12151c',  // dark surface card
          850: '#181c26',  // dark elevated surface
          800: '#222836',  // dark interactive button
          700: '#343c4f',  // high-contrast dark border
          600: '#4c566e',  // dark muted icons
          400: '#a3adbe',  // WCAG AA dark secondary text (6.5:1)
          300: '#ccd4e0',  // WCAG AAA dark primary body (11.0:1)
          200: '#e4e8f0',  // WCAG AAA dark heading (15.0:1)
          100: '#f5f7fa',  // WCAG AAA crisp white-slate (18.2:1)
        },
        afwe: {
          commit: '#16a34a',
          stage: '#d97706',
          redo: '#dc2626',
          inferred: '#ea580c',
          pinned: '#4f46e5',
          unmapped: '#64748b',
          advisory: '#0891b2',
        }
      },
      fontFamily: {
        serif: ['Newsreader', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Geist Mono', 'Fira Code', 'Consolas', 'monospace'],
        display: ['Newsreader', 'Georgia', 'serif'],
      }
    },
  },
  plugins: [],
}
