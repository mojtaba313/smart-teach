/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        vazir: ['Vazirmatn', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // Semantic tokens — defined as RGB triplets in src/index.css so a
        // theme swap only has to override the variables.
        canvas: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--elev) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        hairline: 'rgb(var(--line) / <alpha-value>)',
        'hairline-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        'brand-soft': 'rgb(var(--brand-soft) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        scene: 'rgb(var(--scene) / <alpha-value>)',
        'scene-grid': 'rgb(var(--scene-grid) / <alpha-value>)',
        'scene-ink': 'rgb(var(--scene-ink) / <alpha-value>)',
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow-color) / 0.45)',
        lift: '0 2px 6px -1px rgb(var(--shadow-color) / 0.5), 0 14px 32px -18px rgb(var(--shadow-color))',
        pop: '0 12px 40px -12px rgb(var(--shadow-color) / 0.9), 0 0 0 1px rgb(var(--line))',
        'inset-top': 'inset 0 1px 0 rgb(255 255 255 / 0.06)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--brand) / 0.45)' },
          '100%': { boxShadow: '0 0 0 12px rgb(var(--brand) / 0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.18s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
}
