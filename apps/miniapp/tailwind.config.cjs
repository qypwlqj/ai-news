module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    spacing: {
      0: '0px',
      1: '8px',
      2: '16px',
      3: '24px',
      4: '32px',
      5: '40px',
      6: '48px',
      8: '64px',
    },
    extend: {
      colors: {
        paper: '#f7f8f2',
        ink: '#203e31',
        muted: '#707c6b',
        moss: '#668951',
        line: '#e5e9df',
        cream: '#e9efdb',
      },
      borderRadius: { card: '1.25rem' },
    },
  },
  plugins: [],
};
