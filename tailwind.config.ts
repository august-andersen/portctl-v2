import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f7fafc',
          100: '#eef3f8',
          200: '#dfe8f1',
          300: '#c6d3e1',
          400: '#9bacbf',
          500: '#738396',
          600: '#4c5d72',
          700: '#243248',
          800: '#142030',
          900: '#0d1118',
          950: '#050506',
        },
      },
      fontFamily: {
        sans: ['Avenir Next', 'Segoe UI', 'sans-serif'],
        mono: ['SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
};

export default config;
