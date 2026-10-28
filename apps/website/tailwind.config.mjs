/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Official Light Mode Brand Tokens
        paper: {
          DEFAULT: '#eef4f4',
          50: '#F7FAFA',
          100: '#eef4f4',
          200: '#E2ECEC',
          300: '#D4E2E2',
        },
        graphite: {
          DEFAULT: '#292D2B',
          900: '#1A1D1B',
          800: '#292D2B',
          700: '#3D4340',
          600: '#525A56',
        },
        survey: {
          DEFAULT: '#758477',
          light: '#8D9B8F',
          dark: '#5C6B5E',
          50: '#F3F6F4',
          100: '#E2E8E4',
          500: '#758477',
          600: '#5F6F61',
          700: '#4A574C',
        },
        stone: {
          DEFAULT: '#C7C4BB',
          light: '#DDD9D0',
          dark: '#A8A49B',
          300: '#DDD9D0',
          400: '#C7C4BB',
          500: '#B0ACA2',
        },
        // Existing Extended Parchment & Obsidian tokens
        parchment: {
          50: '#F7FAFA',
          100: '#eef4f4',
          200: '#E2ECEC',
          300: '#D4E2E2',
          400: '#BDCCC4',
          500: '#8E9E95',
          600: '#525A56',
          700: '#3D4340',
          800: '#292D2B',
          900: '#1A1D1B',
        },
        obsidian: {
          950: '#0E1110',
          900: '#141816',
          850: '#1B211E',
          800: '#242C28',
          700: '#333D38',
          600: '#47544E',
          400: '#8E9E95',
          300: '#BDCCC4',
          200: '#DDE6E2',
          100: '#F5F8F6',
        },
        afwe: {
          commit: '#15803D',
          stage: '#B45309',
          redo: '#B91C1C',
          inferred: '#C2410C',
          pinned: '#4338CA',
          unmapped: '#64748B',
          advisory: '#0E7490',
        }
      },
      fontFamily: {
        serif: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Geist Mono', 'Fira Code', 'Consolas', 'monospace'],
        display: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
