import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // --- ClawCommerce 品牌核心色系 ---
        brand: {
          bg: '#0F172A',
          surface: '#1E293B',
          primary: '#C66A28',
          accent: '#E5A93D',
          bronze: '#9C4A22',
          danger: '#7A2A18',
        },
        // --- 兼容 Shadcn UI 底层语义化变量 ---
        border: 'hsl(var(--border) / 0.1)',
        input: 'hsl(var(--input))',
        ring: '#C66A28',
        background: '#0F172A',
        foreground: '#F8FAFC',
        primary: {
          DEFAULT: '#C66A28',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#1E293B',
          foreground: '#F8FAFC',
        },
        muted: {
          DEFAULT: '#334155',
          foreground: '#94A3B8',
        },
        card: {
          DEFAULT: '#1E293B',
          foreground: '#F8FAFC',
        },
      },
      backgroundImage: {
        'gradient-claw': 'linear-gradient(135deg, #7A2A18 0%, #C66A28 50%, #E5A93D 100%)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-fast': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-fast': 'pulse-fast 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
