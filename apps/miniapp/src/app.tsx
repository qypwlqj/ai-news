import type { PropsWithChildren } from 'react';
import './app.css';

if (process.env.TARO_ENV === 'h5') void import('./h5.css');

export default function App({ children }: PropsWithChildren) {
  return children;
}
