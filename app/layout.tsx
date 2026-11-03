import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/store';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'PI Admin' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppProvider><Shell>{children}</Shell></AppProvider>
      </body>
    </html>
  );
}
